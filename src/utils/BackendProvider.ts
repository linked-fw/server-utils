import path from 'path';

export class BackendProvider {
  public request;
  public response;

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
    app[method](path, ...handlers);
    const after = router ? router.stack.length : before;
    for (let i = before; i < after; i++) {
      this._registeredLayers.push(router.stack[i]);
    }
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

  initRequest(request, response): Promise<void> | void {
    this.request = request;
    this.response = response;
  }

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
    //init and return a new instance of the given provider with the same request and response
    let authProvider = new provider(this.server, this.lincdServer);
    authProvider.request = this.request;
    authProvider.response = this.response;
    // authProvider.initRequest(this.request, this.response);
    return authProvider as S;
  }
}
