import { Shape } from '@_linked/core/shapes/Shape';
export declare class Lincd_API_Client extends Shape {
    static targetClass: import("@_linked/core/utils/NodeReference").NodeReferenceValue;
    static getFromURI(uri: string): Lincd_API_Client;
    selectQuery<ResultType>(query: unknown): Promise<ResultType>;
    updateQuery<ResultType>(query: unknown): Promise<ResultType>;
    createQuery<ResultType>(query: unknown): Promise<ResultType>;
    deleteQuery<ResultType>(query: unknown): Promise<ResultType>;
    selectRaw<ResultType>(query: string): Promise<ResultType>;
    private call;
}
