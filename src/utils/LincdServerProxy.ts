import { Shape } from '@_linked/core/shapes/Shape';
import type { NodeReferenceValue } from '@_linked/core/utils/NodeReference';
import { ServerCallError } from './ServerCallError.js';

export { ServerCallError } from './ServerCallError.js';

function getShapePackageNameFromUri(shapeURI: string) {
  const match = shapeURI.match(
    /^https:\/\/data\.lincd\.org\/module\/([^/]+)\/shape\//
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export interface CallConfig {
  method: string;
  headers?: any;
  setLoaded?: boolean;
  overwriteData?: boolean;
  /**
   * If true, it will not use the local server but instead force a fetch call, which will then resolve again to the backend
   * On a multicore set-up this may end up on a different worker
   */
  forceFetch?: boolean;
  /**
   * If true, a failed call rejects with a {@link ServerCallError} carrying the HTTP
   * `status` and the server's `{error}` message, instead of resolving `undefined`.
   * On the backend (local server path) a call that no provider handles rejects
   * with status 501 and a provider method that throws rejects with status 500.
   *
   * Defaults to false, which keeps the existing behaviour: a non-2xx response
   * logs a warning and resolves `undefined`.
   */
  rejectOnError?: boolean;
}

export type ActionHandler = (event: { preventDefault: () => void }) => void;

/**
 * Hooks an auth package registers with {@link LincdServerProxy.setAuthHandler} to keep a
 * session alive around server calls made over HTTP. server-utils knows nothing about tokens:
 * the handler changes the default headers (`addDefaultHeaders` / `removeDefaultHeaders`), and
 * the proxy builds each request's headers after the hook has run.
 */
export interface AuthHandler {
  /**
   * Called before every request is sent. `init` is a preview of the request — to change what
   * is sent, change the default headers; the request's headers are built after this resolves.
   * A typical use is refreshing an access token that has already expired.
   */
  beforeRequest?(url: string, init: RequestInit): Promise<void> | void;
  /**
   * Called when a request is answered with HTTP 401 (not 403). Resolve `true` to send the
   * request again, once, with the then-current default headers. The retried request's
   * response goes to the caller as is, so this is never called twice for one call.
   */
  onUnauthorized?(url: string, response: Response): Promise<boolean> | boolean;
}

function sameHeaders(a: Record<string, any>, b: Record<string, any>) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  );
}

function getShapeClass(shape: typeof Shape | Shape) {
  if (shape instanceof Shape) {
    return Object.getPrototypeOf(shape).constructor;
  }
  return shape;
}

function getInstanceNode(shape: Shape | typeof Shape): NodeReferenceValue {
  if (shape instanceof Shape && shape.id) {
    return { id: shape.id };
  }
  return null;
}

export class LincdServerProxy {
  /**
   * Use this key in a json response to trigger an action on the frontend.
   */
  static RESPONSE_ACTION_KEY: string = '__action';
  static actionHandlers: Map<string, ActionHandler[]> = new Map();
  /**
   * Is set by Server utility. Allows a LincdServer to bypass the proxy on the backend.
   */
  localServer: any;
  private rootUrl: string;

  static defaultHeaders = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };

  constructor(rootUrl: string | { id?: string }) {
    this.rootUrl = typeof rootUrl === 'string' ? rootUrl : rootUrl?.id || '';

    if (!this.rootUrl) {
      throw new Error('LincdServerProxy requires a root URL');
    }
  }

  static getFromURI(uri: string) {
    return new LincdServerProxy(uri);
  }

  get uri() {
    return this.rootUrl;
  }

  /**
   * Default headers to be sent with every request
   *
   * @param headers
   */
  static addDefaultHeaders(headers) {
    this.defaultHeaders = Object.assign(this.defaultHeaders, headers);
  }

  /**
   * Remove one or more default headers previously set via {@link addDefaultHeaders}.
   * Used by scoped request contexts (e.g. CN's DataRouting) to tear down their
   * headers on unmount so they don't leak into subsequent calls.
   *
   * @param names header names to remove
   */
  static removeDefaultHeaders(...names: string[]) {
    for (const name of names) {
      delete this.defaultHeaders[name];
    }
  }

  /**
   * The action dispatched when the server says the caller is not authenticated.
   *
   * Until now a 401/403 took the `else` branch below, which `console.warn`s and returns
   * `undefined` — so an expired session arrived at the caller as *no data*, indistinguishable
   * from "there is nothing here". That is how a signed-out user gets an empty page instead of a
   * sign-in screen, and how a failed call gets read as an empty result.
   *
   * It is dispatched through the existing action-handler registry rather than by navigating from
   * here: this file has no router, and a host that wants different behaviour (a modal, a silent
   * token refresh) registers its own handler and calls `preventDefault`.
   */
  static UNAUTHENTICATED_ACTION = 'unauthenticated';

  private static authHandler: AuthHandler | null = null;

  /**
   * Register the {@link AuthHandler} for every server call made over HTTP (`call`,
   * `customPost`, `callCustomShapeMethod`). There is one handler; setting another replaces it,
   * and `null` removes it. Calls made directly against the local server on the backend do not
   * go through it.
   */
  static setAuthHandler(handler: AuthHandler | null) {
    this.authHandler = handler || null;
  }

  static getAuthHandler(): AuthHandler | null {
    return this.authHandler;
  }

  static registerActionHandler(actionName: string, handler: ActionHandler) {
    const handlers = this.actionHandlers.get(actionName) || [];
    handlers.push(handler);
    this.actionHandlers.set(actionName, handlers);
  }

  /**
   * Create a response action object that can be returned by a server call to trigger an action on the frontend.
   * @param actionName
   * @param args
   */
  static createResponseAction(actionName: string, ...args: any[]) {
    const key: string = LincdServerProxy.RESPONSE_ACTION_KEY;
    //@ts-ignore
    return { [key]: actionName, args };
  }

  /**
   * Call a method on the server for this specific shape.
   * See the documentation on `Providers` to learn more about implementing server side methods for shapes.
   * @param shape
   * @param method
   * @param args
   */
  async call(
    packageName: string,
    method: string | CallConfig,
    ...args: any[]
  ): Promise<any>;
  async call(
    shape: Shape | typeof Shape,
    method: string | CallConfig,
    ...args: any[]
  ): Promise<any>;
  async call(
    shapeOrPackageName: Shape | typeof Shape | string,
    method: string | CallConfig,
    ...args: any[]
  ): Promise<any> {
    if (typeof shapeOrPackageName === 'string') {
      return this.callBackendMethod(shapeOrPackageName, method, args);
    } else {
      return this.callShapeMethod(shapeOrPackageName, method, args);
    }
  }

  callCustomShapeMethod(
    shape: typeof Shape | Shape,
    method: 'GET' | 'POST' | 'PUT' | 'UPDATE',
    methodName,
    body,
    headers?
  ): Promise<any> {
    let { shapeClass, packageName, shapeURI } = this.parseShape(shape);

    //NOTE: custom calls are not going straight to the localServer on nodejs, so that request.body is available.
    //They send the default headers (so they are authenticated like any other call) except the JSON
    //Content-Type: the body is often FormData, which needs the browser to set its own boundary.
    //Headers passed by the caller win. Transient failures are not retried, as before.
    return this.fetchWithAuth(
      `${this.rootUrl}/call/${packageName}/${shapeClass.name}/${methodName}?shapeURI=${shapeURI}`,
      () => {
        const { 'Content-Type': _contentType, ...defaults } =
          LincdServerProxy.defaultHeaders as Record<string, string>;
        return {
          method: method,
          headers: Object.assign({}, defaults, headers || {}),
          body,
        };
      },
      0
    )
      .then((res) => {
        if (res.ok) {
          return res.json();
        } else {
          if (res.status === 401 || res.status === 403) {
            this.handleResponseAction(LincdServerProxy.UNAUTHENTICATED_ACTION);
          }
          console.warn('Could not complete server call: ' + res.statusText);
          throw new Error(`Could not complete server call: ${res.statusText}`);
        }
      })
      .then((json) => {
        if (json.__action) {
          this.handleResponseAction(json.__action);
        }
        return json;
      })
      .catch((err) => {
        console.warn('Error during server call: ', err);
        throw err;
      });
  }

  async customPost(route, ...args: any[]): Promise<any> {
    let body = JSON.stringify(args);
    return this.fetchBackend(`${this.rootUrl}${route}`, body);
  }

  private async callBackendMethod(
    packageName: string,
    methodOrConfig: string | CallConfig,
    args: any[]
  ): Promise<any> {
    let [method, headers, setLoaded, overwriteData, rejectOnError] =
      this.parseMethod(methodOrConfig);
    //if this IS the backend
    if (
      this.localServer &&
      (typeof methodOrConfig == 'string' || !methodOrConfig.forceFetch)
    ) {
      //then call the server directly
      return this.callLocalServer(
        () => this.localServer.callBackendMethod(packageName, method, args),
        rejectOnError
      );
    } else {
      let body = JSON.stringify({ args });
      let root = this.rootUrl;
      return this.fetchBackend(
        `${root}/call/${packageName}/${method}`,
        body,
        headers,
        setLoaded,
        overwriteData,
        rejectOnError
      );
    }
  }

  private parseMethod(
    method: string | CallConfig
  ): [string, any?, boolean?, boolean?, boolean?] {
    if (typeof method === 'string') {
      return [method];
    } else {
      return [
        method.method,
        method.headers,
        method.setLoaded,
        method.overwriteData,
        method.rejectOnError === true,
      ];
    }
  }

  /**
   * Run a call against the local server (backend-to-backend) with the same error
   * semantics as the HTTP path:
   * - by default a call that no provider handles (a 501 `ServerCallError`)
   *   resolves `undefined`, as it did before; other errors reject as thrown.
   * - with `rejectOnError` every failure rejects with a `ServerCallError`;
   *   errors thrown by a provider method are wrapped with status 500.
   */
  private async callLocalServer(
    call: () => Promise<any>,
    rejectOnError: boolean = false
  ): Promise<any> {
    try {
      return await call();
    } catch (err) {
      if (ServerCallError.is(err)) {
        if (!rejectOnError && err.status === 501) {
          console.warn('Could not complete server call: ' + err.message);
          return undefined;
        }
        throw err;
      }
      if (rejectOnError) {
        throw new ServerCallError(
          500,
          (err as any)?.message || String(err),
          { cause: err }
        );
      }
      throw err;
    }
  }

  private async callShapeMethod(
    shape: Shape | typeof Shape,
    methodOrConfig: string | CallConfig,
    args: any[]
  ): Promise<any> {
    let [method, headers, setLoaded, overwriteData, rejectOnError] =
      this.parseMethod(methodOrConfig);

    let { shapeClass, shapeURI, packageName } = this.parseShape(shape);
    const instanceNode = getInstanceNode(shape);

    if (
      this.localServer &&
      (typeof methodOrConfig == 'string' || !methodOrConfig.forceFetch)
    ) {
      return this.callLocalServer(
        () =>
          this.localServer.callShapeMethod(
            packageName,
            method,
            shapeURI,
            instanceNode,
            args
          ),
        rejectOnError
      );
    }
    //SHACL Shapes are generated by using @linkedShape.
    //They are given a unique but deterministic temporary URI
    //We send that URI over to the server, which will have generated the same URI and thus recognise the shape
    let body = JSON.stringify({
      shapeURI,
      instanceNode,
      args,
    });
    let root = this.rootUrl;
    return this.fetchBackend(
      `${root}/call/${packageName}/${shapeClass.name}/${method}`,
      body,
      headers,
      setLoaded,
      overwriteData,
      rejectOnError
    );
  }

  private parseShape(shape: typeof Shape | Shape) {
    let shapeClass = getShapeClass(shape);
    let SHACL_Shape = shapeClass.shape;
    let shapeURI = SHACL_Shape?.id;
    // Prefer the package name set by linkedPackage() on the shape constructor
    // — this is the un-sanitized, module-resolvable form (e.g. '@_linked/server').
    // Fall back to parsing the URI for shapes registered before this hook existed
    // (legacy lincd-* packages whose sanitized form matches the module spec).
    let packageName =
      (shapeClass as any).packageName ||
      getShapePackageNameFromUri(shapeURI);

    return {
      shapeClass,
      SHACL_Shape,
      shapeURI,
      packageName,
    };
  }

  /**
   * `fetch` with retry-on-transient-failure. Retries ONLY connection-level
   * rejections and 502/503/504 (a dropped socket / gateway blip under load) with
   * exponential backoff — never 4xx or a plain 500 (the server processed the
   * request, so retrying a write could double-apply it). RDF writes here are
   * largely idempotent; exactly-once retry of writes needs idempotency keys —
   * see docs/backlog/032. Only the fetch is wrapped; response handling is
   * unchanged.
   */
  private async fetchWithRetry(
    url,
    init,
    retries: number = 2
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, init);
        if (
          res.ok ||
          ![502, 503, 504].includes(res.status) ||
          attempt >= retries
        ) {
          return res;
        }
      } catch (err) {
        if (attempt >= retries) throw err;
      }
      // exponential backoff: 300ms, 900ms
      await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt)));
    }
  }

  /**
   * Send a request through the registered {@link AuthHandler}, if any. `buildInit` is called
   * for each request actually sent, so a header changed by the handler (a refreshed token)
   * is picked up.
   *
   * A 401 is retried at most once, and only when the handler asks for it — or, without asking,
   * when the default headers changed while the request was in flight: another call refreshed
   * the session meanwhile, so the 401 is about headers that are already stale. The retry state
   * is local to this call, so concurrent calls cannot make each other loop; making concurrent
   * refreshes share one round trip is the handler's job.
   *
   * Without a handler this is exactly `fetchWithRetry`.
   */
  private async fetchWithAuth(
    url: string,
    buildInit: () => RequestInit,
    retries: number = 2
  ): Promise<Response> {
    const handler = LincdServerProxy.authHandler;
    if (!handler) {
      return this.fetchWithRetry(url, buildInit(), retries);
    }
    if (handler.beforeRequest) {
      try {
        await handler.beforeRequest(url, buildInit());
      } catch (err) {
        console.warn('Auth handler beforeRequest failed: ', err);
      }
    }
    const sentDefaults = { ...LincdServerProxy.defaultHeaders };
    const res = await this.fetchWithRetry(url, buildInit(), retries);
    if (res.status !== 401) {
      return res;
    }
    let retry = !sameHeaders(sentDefaults, LincdServerProxy.defaultHeaders);
    if (!retry && handler.onUnauthorized) {
      try {
        retry = (await handler.onUnauthorized(url, res)) === true;
      } catch (err) {
        console.warn('Auth handler onUnauthorized failed: ', err);
      }
    }
    return retry ? this.fetchWithRetry(url, buildInit(), retries) : res;
  }

  private async fetchBackend(
    url,
    body,
    headers?,
    setLoaded: boolean = false,
    overwriteData: boolean = false,
    rejectOnError: boolean = false
  ) {
    return this.fetchWithAuth(url, () => ({
      method: 'POST',
      headers: Object.assign(
        {},
        LincdServerProxy.defaultHeaders,
        headers || {}
      ),
      body,
    }))
      .then(async (res) => {
        if (res.ok) {
          // Read the body ONCE, as text, and parse that. `res.json()` consumes
          // the stream, so the `res.text()` that used to report an unparseable
          // payload threw `body stream already read` — the diagnostic destroyed
          // the very evidence it existed to surface, and the server's real
          // message never reached anyone.
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch (err) {
            console.warn('Could not parse JSON from response: ', err);
            console.warn('Response text: ', text);
            return undefined;
          }
        } else {
          if (res.status === 401 || res.status === 403) {
            this.handleResponseAction(LincdServerProxy.UNAUTHENTICATED_ACTION);
          }
          console.warn('Could not complete server call: ' + res.statusText);
          if (rejectOnError) {
            throw await this.toServerCallError(res);
          }
          /**
           * Without the opt-in, an AUTH failure still must not resolve as `undefined`.
           *
           * Returning nothing is what let a 401 read as an empty result all the way up into the
           * UI, where "no documents" and "we could not ask" render identically. Deliberately
           * narrowed to 401/403 rather than every non-ok status: this path has always resolved
           * `undefined` for 4xx/5xx and callers across every package are written against that,
           * so widening it here would turn each of them into an unhandled rejection. The other
           * statuses keep their existing (poor, but relied-upon) contract until someone audits
           * the callers.
           */
          if (res.status === 401 || res.status === 403) {
            throw new Error(
              `Not authenticated: ${res.status} ${res.statusText}`
            );
          }
        }
      })
      .then((json) => {
        //if instead of a normal data response the server returns an action, handle it
        if (json && json[LincdServerProxy.RESPONSE_ACTION_KEY]) {
          if (
            this.handleResponseAction(
              json[LincdServerProxy.RESPONSE_ACTION_KEY]
            )
          ) {
            return;
          }
        }
        return json;
      })
      .catch((err) => {
        if (!ServerCallError.is(err)) {
          console.warn('Error during server call: ', err);
        }
        throw err;
      });
  }

  /**
   * Build a ServerCallError from a non-2xx response, using the server's
   * `{error}` message when the body carries one.
   */
  private async toServerCallError(res: Response): Promise<ServerCallError> {
    let message: string;
    try {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json && typeof json.error === 'string') {
          message = json.error;
        }
      } catch {
        // not JSON, fall back to the status text
      }
    } catch {
      // body unreadable, fall back to the status text
    }
    return new ServerCallError(
      res.status,
      message || res.statusText || `Server call failed with status ${res.status}`
    );
  }

  handleResponseAction(action) {
    let preventdefault = false;
    const handlers = LincdServerProxy.actionHandlers.get(action) || [];
    handlers.forEach((handler) => {
      handler({ preventDefault: () => (preventdefault = true) });
    });
    return preventdefault;
  }
}
