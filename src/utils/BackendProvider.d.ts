/**
 * HAND-WRITTEN, and it shadows BackendProvider.ts rather than being emitted from it.
 *
 * That is why it drifts: it declared none of `registerRoute` / `disposeRoutes` while the source
 * had both, so every consumer saw a type that was missing methods the class actually has. It
 * failed `spa-fallback.test.ts` on main and the backend compile of any app using them.
 *
 * This file should be DELETED and the declaration emitted instead -- one of fifteen such files in
 * this package. That is tracked with the folder-compile sweep, because it is the same root cause:
 * declarations authored rather than emitted. See docs/plans/046 in the consuming app's repo.
 */
export declare class BackendProvider {
    server: any;
    lincdServer: any;
    request: any;
    response: any;
    constructor(server: any, lincdServer: any);
    /**
     * Each request, all providers are given the opportunity to provide data for the request.
     * For example, a provider that handles logins, may return data about the current user
     * This data will then be available on the frontend right upon initialisation
     */
    supplyDataForRequest(request: any, response: any, data: Record<string, any>): Promise<void> | void;
    initRequest(request: any, response: any): Promise<void> | void;
    setupBeforeControllers(): void;
    setupBeforeCatchAllControllers(): void;
    setupAfterControllers(): void;
    /**
     * Registers an Express route and tracks the layer it created, so
     * `disposeRoutes()` can splice it back out on an HMR reload.
     *
     *   registerRoute('use', '/', cookieParser())
     *   registerRoute('get', '/health', (req, res) => res.send('ok'))
     */
    protected registerRoute(method: string, path: string, ...handlers: any[]): void;
    /** Removes every route this provider added via `registerRoute`. */
    protected disposeRoutes(): void;
    protected assignEnvPathToField(envKey: any, field: any): Promise<void>;
    protected callOtherProvider<S extends BackendProvider>(provider: typeof BackendProvider): S;
}
