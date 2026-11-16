/**
 * Per-call request context for backend providers.
 *
 * Providers are singletons, so a request stored on the provider instance is
 * shared by every call in flight: a call that awaits can resume and read the
 * request of whichever call ran `initRequest` last. The server instead enters an
 * `AsyncLocalStorage` context for the whole of each HTTP call, and
 * `BackendProvider.request` reads it from there.
 *
 * - `http`: a call that came in over HTTP. `request` carries the session
 *   (`request.linkedAuth`) as the auth provider put it there.
 * - `system`: work with no user behind it — boot, scheduled jobs, lazy provider
 *   loading, and backend-to-backend calls made outside any request.
 * - `delegated`: work done for a known user by something acting on their
 *   behalf, outside that user's request (see `runAsDelegate`). It has a user
 *   and no request. Unlike `system`, it is never trusted: the generic query
 *   plane checks it as it checks an `http` call.
 *
 * Server-only (it imports `node:async_hooks`).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { ServerCallError } from './ServerCallError.js';

/** Who is acting for the user of a delegated call. */
export interface CallDelegate {
  /** A stable identity of the delegate, e.g. the IRI of its connection record. */
  id: string;
  /** A name to show or log. */
  label?: string;
  /** How it reaches the server, e.g. a protocol name. */
  via?: string;
}

export type CallContext =
  | { kind: 'http'; request: any; response: any }
  | { kind: 'system'; reason?: string }
  | {
      kind: 'delegated';
      userAccount: any;
      delegate: CallDelegate;
      /** The same shape a request's `linkedAuth` has, plus the delegate. */
      linkedAuth: { userAccount: any; delegate: CallDelegate };
    };

const STORAGE_KEY = Symbol.for('@_linked/server-utils:callContext');

// Shared through globalThis so that two copies of this module (a nested
// install, or a source and a built copy under Vite) still see one context.
function storage(): AsyncLocalStorage<CallContext> {
  const g = globalThis as any;
  if (!g[STORAGE_KEY]) {
    Object.defineProperty(g, STORAGE_KEY, {
      value: new AsyncLocalStorage<CallContext>(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return g[STORAGE_KEY];
}

/** The context of the call currently running, or undefined outside any call. */
export function getCallContext(): CallContext | undefined {
  return storage().getStore();
}

/** Run `fn` (and everything it awaits or schedules) in `ctx`. */
export function runWithCallContext<T>(ctx: CallContext, fn: () => T): T {
  return storage().run(ctx, fn);
}

const REQUEST_CONTEXT_KEY = Symbol.for('@_linked/server-utils:requestCallContext');

/**
 * The http context of one HTTP request: created on first use and kept on the
 * request object, so every layer that enters it for this request (the server's
 * first middleware, a provider route, the RPC dispatcher) shares one context
 * object. A value a provider stores in the context (see
 * `BackendProvider.request`) therefore lasts exactly as long as the request.
 */
export function httpCallContext(request: any, response: any): CallContext {
  const existing = request && request[REQUEST_CONTEXT_KEY];
  if (existing && existing.kind === 'http' && existing.request === request) {
    if (response && !existing.response) existing.response = response;
    return existing;
  }
  const ctx: CallContext = { kind: 'http', request, response };
  if (request && typeof request === 'object') {
    Object.defineProperty(request, REQUEST_CONTEXT_KEY, {
      value: ctx,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  }
  return ctx;
}

/**
 * Run `fn` in the http context of `request` (see `httpCallContext`). Used by the
 * server for every request it receives, so no handler runs without a context.
 */
export function runInHttpContext<T>(request: any, response: any, fn: () => T): T {
  return runWithCallContext(httpCallContext(request, response), fn);
}

/**
 * Run `fn` with no user behind it. Wrap long-lived work started from inside a
 * request (a job, a timer, a queue consumer) in this, or it keeps running as
 * that request's user.
 */
export function runAsSystem<T>(fn: () => T, reason?: string): T {
  return runWithCallContext({ kind: 'system', reason }, fn);
}

/**
 * Run `fn` (and everything it awaits or schedules) for `userAccount`, as
 * `delegate` acting on that user's behalf. Use it for work that is done for a
 * known user but does not happen inside that user's request: `requireSessionUser()`
 * returns `userAccount`, `currentDelegate()` returns the delegate, and there is
 * no request or response.
 *
 * The caller is responsible for having established that the delegate may act
 * for this user (for example by checking a credential). A delegated call is
 * not trusted the way `system` work is: the generic query plane applies the
 * store rules to it.
 */
export function runAsDelegate<T>(userAccount: any, delegate: CallDelegate, fn: () => T): T {
  if (userAccount === undefined || userAccount === null) {
    throw new TypeError('runAsDelegate: a user account is required');
  }
  if (!delegate || typeof delegate.id !== 'string' || !delegate.id) {
    throw new TypeError('runAsDelegate: a delegate with an id is required');
  }
  const frozen: CallDelegate = Object.freeze({
    id: delegate.id,
    ...(delegate.label !== undefined ? { label: delegate.label } : {}),
    ...(delegate.via !== undefined ? { via: delegate.via } : {}),
  });
  return runWithCallContext(
    {
      kind: 'delegated',
      userAccount,
      delegate: frozen,
      linkedAuth: Object.freeze({ userAccount, delegate: frozen }),
    },
    fn
  );
}

/** Who is acting for the user of the current call, if it is a delegated call. */
export function currentDelegate(): CallDelegate | undefined {
  const ctx = getCallContext();
  return ctx?.kind === 'delegated' ? ctx.delegate : undefined;
}

/** The HTTP request of the current call, if it is an HTTP call. */
export function currentRequest(): any | undefined {
  const ctx = getCallContext();
  return ctx?.kind === 'http' ? ctx.request : undefined;
}

/** The HTTP response of the current call, if it is an HTTP call. */
export function currentResponse(): any | undefined {
  const ctx = getCallContext();
  return ctx?.kind === 'http' ? ctx.response : undefined;
}

/**
 * The signed-in user's account for the current call.
 *
 * - delegated call: the user the delegate acts for.
 * - HTTP call without a session: throws a `ServerCallError` with status 401.
 * - system context (or no context at all): throws a plain `Error`. There is no
 *   user to take; a caller that acts for a user has to pass one explicitly.
 */
export function requireSessionUser(): any {
  const ctx = getCallContext();
  if (ctx?.kind === 'delegated') return ctx.userAccount;
  if (!ctx || ctx.kind !== 'http') {
    const where = !ctx
      ? 'a call outside any request'
      : 'a system context' + ((ctx as any).reason ? ` (${(ctx as any).reason})` : '');
    throw new Error(
      `requireSessionUser: there is no user in ${where}; pass the user explicitly`
    );
  }
  const userAccount = ctx.request?.linkedAuth?.userAccount;
  if (!userAccount) {
    throw new ServerCallError(401, 'Authentication required');
  }
  return userAccount;
}
