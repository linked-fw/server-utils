import { Shape } from '@_linked/core/shapes/Shape';
import { linkedShape } from '../package.js';
import { serverUtils } from '../ontologies/server-utils.js';
type BuiltQuery = { build?: () => unknown };

function buildQueryObject<T>(query: T | BuiltQuery) {
  if (query && typeof (query as BuiltQuery).build === 'function') {
    return (query as BuiltQuery).build();
  }
  return query;
}

@linkedShape
export class Lincd_API_Client extends Shape {
  static targetClass = serverUtils.Lincd_API_Client;

  static getFromURI(uri: string) {
    return new this(uri);
  }

  selectQuery<ResultType>(query: unknown): Promise<ResultType> {
    return this.call('select', { query: buildQueryObject(query) });
  }

  updateQuery<ResultType>(query: unknown): Promise<ResultType> {
    return this.call('update', { query: buildQueryObject(query) });
  }

  createQuery<ResultType>(query: unknown): Promise<ResultType> {
    return this.call('create', { query: buildQueryObject(query) });
  }

  deleteQuery<ResultType>(query: unknown): Promise<ResultType> {
    return this.call('delete', { query: buildQueryObject(query) });
  }

  selectRaw<ResultType>(query: string): Promise<ResultType> {
    return this.call('select_raw', { query });
  }

  private async call<ResultType>(
    method: string,
    payload: Record<string, unknown>
  ): Promise<ResultType> {
    let body = JSON.stringify(payload);
    const res = await fetch(`${this.uri}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!res.ok) {
      console.warn('Could not complete API call: ' + res.statusText);
      throw new Error(`Could not complete API call: ${res.statusText}`);
    }

    return res.json();
  }
}
