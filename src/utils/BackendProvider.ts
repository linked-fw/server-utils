import path from 'path';
import { getCallContext, runWithCallContext } from './CallContext.js';

// Values assigned to `provider.request`/`provider.response` directly, per
// instance. Kept outside the instance so no class field can collide with the
// accessors below.
const legacyOverrides = new WeakMap<object, { request?: any; response?: any }>();
const warnedLegacyAssignment = new Set<string>();

function warnLegacyAssignment(provider: object, field: string) {
  const name = provider?.constructor?.name || 'BackendProvider';
  const key = name + '.' + field;
  if (warnedLegacyAssignment.has(key)) return;
  warnedLegacyAssignment.add(key);
  console.warn(
    `[linked] ${name} assigns this.${field}. Providers are shared by every ` +
      `call in flight, so an assigned ${field} leaks between users. Read ` +
      `this.${field} (it comes from the current call) instead of setting it.`
  );
}

export class BackendProvider {
  /**
   * The HTTP request of the call this provider is currently serving.
   *
   * Read from the per-call context (see CallContext), so concurrent calls each
   * see their own request even though the provider is a singleton. Undefined
   * outside an HTTP call (boot, jobs, backend-to-backend calls made outside a
   * request).
   *
   * Assigning it still works for existing code, but pins that value on this
   * instance for every later call, and warns once.
   */
  get request(): any {
    const override = legacyOverrides.get(this);
    if (override && 'request' in override) return override.request;
    const ctx = getCallContext();
    return ctx?.kind === 'http' ? ctx.request : undefined;
  }
  set request(value: any) {
    this.assignLegacy('request', value);
  }

  /** The HTTP response of the current call; see `request`. */
  get response(): any {
    const override = legacyOverrides.get(this);
    if (override && 'response' in override) return override.response;
    const ctx = getCallContext();
    return ctx?.kind === 'http' ? ctx.response : undefined;
  }
  set response(value: any) {
    this.assignLegacy('response', value);
  }

  private assignLegacy(field: 'request' | 'response', value: any) {
    const ctx = getCallContext();
    // `this.request = request` inside an initRequest override assigns what the
    // context already holds: nothing to pin.
    if (ctx?.kind === 'http' && ctx[field] === value) {
      const override = legacyOverrides.get(this);
      if (override) delete override[field];
      return;
    }
    warnLegacyAssignment(this, field);
    let override = legacyOverrides.get(this);
    if (!override) {
      override = {};
      legacyOverrides.set(this, override);
    }
    override[field] = value;
  }

  // Express router layers this provider added via `registerRoute`, tracked so
  // `disposeRoutes()` can remove them on an HMR reload. Vite re-runs a
  // provider's `setupBeforeControllers` on every backend source change; without
  // removing the previously-registered middleware first, each reload STACKS
  // another copy on the express app (duplicate cookie/jwt/session middleware,
  // leaked listeners). `this.server` is the express app (LinkedServer passes it
  // as the first constructor arg).
  private _registeredLayers: any[] = [];

  constructor(public server, public lincdServer) {}

  /**
   * Register an express route/middleware AND track it for HMR disposal.
   * `method` is any express app method (`'use' | 'get' | 'post' | ...`).
   *   registerRoute('use', '/', cookieParser())
   *   registerRoute('get', '/health', (req, res) => res.send('ok'))
   * The layers express appends to its router stack are captured so
   * `disposeRoutes()` can splice them back out on reload.
   */
  protected registerRoute(method: string, path: string, ...handlers): void {
    const app = this.server;
    const router = app && (app._router ?? app.router);
    const before = router ? router.stack.length : 0;
    app[method](path, ...handlers.map((h) => this.guardHandler(method, path, h)));
    const after = router ? router.stack.length : before;
    for (let i = before; i < after; i++) {
      this._registeredLayers.push(router.stack[i]);
    }
  }

  /**
   * Wrap a route handler so a rejected promise can't silently hang the request.
   *
   * We are on Express 4, which IGNORES the promise an `async` handler returns.
   * A rejection therefore reaches no error handler and nothing ever writes to
   * the response: the socket stays open until the client times out, with
   * nothing in the log. It looks like a dead endpoint, not a thrown error.
   * (LinkedServer's own `/call/*` and `/api/*` routes avoid this by going
   * through `handleErrorsJson`; provider routes had no equivalent.)
   *
   * Two guards:
   *  - the throw becomes a logged stack + a 500, or `next(err)` for middleware
   *    which may legitimately be serving something other than JSON;
   *  - a watchdog logs any request still unanswered after
   *    `LINKED_ROUTE_WARN_MS` (default 15s, `0` disables). It only WARNS — it
   *    never ends the response, because streaming endpoints (`/api/chat`) are
   *    expected to stay open. A handler that neither responds nor throws is
   *    invisible otherwise; this is what names it.
   *
   * Error-handling middleware is identified by arity 4 and left alone —
   * wrapping would change its arity and stop Express recognising it.
   */
  private guardHandler(method: string, routePath: string, handler): any {
    if (typeof handler !== 'function' || handler.length >= 4) return handler;

    const isMiddleware = method === 'use';
    const label = `${method.toUpperCase()} ${routePath}`;
    // A non-numeric override must not silently disable the watchdog.
    const configured = Number(process.env.LINKED_ROUTE_WARN_MS);
    const warnAfter = Number.isFinite(configured) ? configured : 15000;

    const guarded = async (req, res, next) => {
      let watchdog;
      if (warnAfter > 0) {
        watchdog = setTimeout(() => {
          console.warn(
            `[linked] ${label} has not responded after ${warnAfter}ms ` +
              `(${req?.originalUrl ?? routePath}). The handler neither ` +
              `responded nor threw — the request is hanging.`
          );
        }, warnAfter);
        watchdog.unref?.();
        // A route owns the response, so watch until the response actually
        // ends — that catches both "never settled" and "settled without
        // responding". Middleware only owns its own turn: it is done once it
        // has called next(), and staying armed until the response finishes
        // would make every `use` layer in the chain warn about a route's hang.
        if (!isMiddleware) {
          res.on('finish', () => clearTimeout(watchdog));
          res.on('close', () => clearTimeout(watchdog));
        }
      }
      try {
        // A route serves one HTTP call: give it the per-call context, so
        // `this.request` inside the provider is this request. Middleware is
        // left alone; it hands on to the rest of the chain.
        return await (isMiddleware
          ? handler(req, res, next)
          : runWithCallContext({ kind: 'http', request: req, response: res }, () =>
              handler(req, res, next)
            ));
      } catch (err) {
        clearTimeout(watchdog);
        console.error(
          `[linked] ${label} failed:`,
          err?.stack ?? err
        );
        if (res?.headersSent) return;
        if (isMiddleware) return next(err);
        res?.status(500).json({
          error: 'internal server error',
          route: label,
        });
      } finally {
        // Middleware is finished when its turn is: clearing here keeps a
        // hanging ROUTE from being reported once per upstream `use` layer.
        if (isMiddleware) clearTimeout(watchdog);
      }
    };
    // Keep the original name in stack traces and express debug output.
    Object.defineProperty(guarded, 'name', {
      value: handler.name || 'guardedHandler',
    });
    return guarded;
  }

  /**
   * Remove every route/middleware this provider registered via
   * `registerRoute`. Called from a provider's `dispose()` on HMR reload so
   * middleware doesn't accumulate across reloads. Idempotent.
   */
  protected disposeRoutes(): void {
    const app = this.server;
    const router = app && (app._router ?? app.router);
    if (router && this._registeredLayers.length) {
      const dropped = new Set(this._registeredLayers);
      router.stack = router.stack.filter((layer) => !dropped.has(layer));
    }
    this._registeredLayers = [];
  }

  /**
   * Each request, all providers are given the opportunity to provide data for the request.
   * For example, a provider that handles logins, may return data about the current user
   * This data will then be available on the frontend right upon initialisation
   */
  supplyDataForRequest(
    request,
    response,
    data: Record<string, any>
  ): Promise<void> | void {
    return null;
  }

  /**
   * Called for every HTTP call before the method runs. The base implementation
   * does nothing: the request is available as `this.request` from the per-call
   * context. Subclasses may still override it (and call `super`) to prepare
   * request-scoped data, such as reading a session onto `request`.
   */
  initRequest(request, response): Promise<void> | void {}

  setupBeforeControllers() {}
  setupBeforeCatchAllControllers() {}
  setupAfterControllers() {}

  protected async assignEnvPathToField(envKey, field) {
    let envValue = process.env[envKey];
    if (envValue) {
      if (envValue.indexOf('./') === 0) {
        envValue = path.resolve(process.cwd(), envValue);
      }
      try {
        //require the path defined in the environment variable. The specifier
        //is only known at runtime, so Vite cannot analyse it — that is intended.
        let envModule = await import(/* @vite-ignore */ envValue);
        //if the module has a default export, use that
        if (envModule.default) {
          this[field] = envModule.default;
        } else {
          //otherwise, use the first named export
          let keys = Object.getOwnPropertyNames(envModule).filter(
            (p) => p !== '__esModule'
          );
          if (keys.length > 0) {
            this[field] = envModule[keys[0]];
          } else {
            console.warn(
              process.env[envKey] + ' does not export a default or named export'
            );
          }
        }
      } catch (e) {
        console.error(
          'Error loading ' +
            process.env[envKey] +
            ' defined by environment variable ' +
            envKey,
          e
        );
      }
    }
  }
  protected callOtherProvider<S extends BackendProvider>(
    provider: typeof BackendProvider
  ): S {
    // A new instance of the given provider. It reads request and response from
    // the same per-call context as this one, so nothing is copied over.
    const other = new provider(this.server, this.lincdServer);
    const override = legacyOverrides.get(this);
    if (override) legacyOverrides.set(other, { ...override });
    return other as S;
  }
}
