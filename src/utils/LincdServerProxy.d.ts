import { Shape } from '@_linked/core/shapes/Shape';
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
     * If true, a failed call rejects with a `ServerCallError` carrying the HTTP
     * `status` and the server's `{error}` message, instead of resolving `undefined`.
     * On the backend (local server path) a call that no provider handles rejects
     * with status 501 and a provider method that throws rejects with status 500.
     */
    rejectOnError?: boolean;
}
export type ActionHandler = (event: {
    preventDefault: () => void;
}) => void;
export declare class LincdServerProxy {
    /**
     * Use this key in a json response to trigger an action on the frontend.
     */
    static RESPONSE_ACTION_KEY: string;
    static actionHandlers: Map<string, ActionHandler[]>;
    /**
     * Is set by Server utility. Allows a LincdServer to bypass the proxy on the backend.
     */
    localServer: any;
    private rootUrl;
    static defaultHeaders: {
        Accept: string;
        'Content-Type': string;
    };
    constructor(rootUrl: string | {
        id?: string;
    });
    static getFromURI(uri: string): LincdServerProxy;
    get uri(): string;
    /**
     * Default headers to be sent with every request
     *
     * @param headers
     */
    static addDefaultHeaders(headers: any): void;
    static registerActionHandler(actionName: string, handler: ActionHandler): void;
    /**
     * Create a response action object that can be returned by a server call to trigger an action on the frontend.
     * @param actionName
     * @param args
     */
    static createResponseAction(actionName: string, ...args: any[]): {
        [x: string]: string | any[];
        args: any[];
    };
    /**
     * Call a method on the server for this specific shape.
     * See the documentation on `Providers` to learn more about implementing server side methods for shapes.
     * @param shape
     * @param method
     * @param args
     */
    call(packageName: string, method: string | CallConfig, ...args: any[]): Promise<any>;
    call(shape: Shape | typeof Shape, method: string | CallConfig, ...args: any[]): Promise<any>;
    callCustomShapeMethod(shape: typeof Shape | Shape, method: 'GET' | 'POST' | 'PUT' | 'UPDATE', methodName: any, body: any, headers?: any): Promise<any>;
    customPost(route: any, ...args: any[]): Promise<any>;
    private callBackendMethod;
    private parseMethod;
    private callShapeMethod;
    private parseShape;
    private fetchBackend;
    handleResponseAction(action: any): boolean;
}
