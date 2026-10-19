import { sharedState } from '@_linked/core/utils/sharedState';

/**
 * Data the backend provides to the frontend. Shared by every copy of this module in the
 * runtime: `initFrontend` writes it through one copy and a component may read it through
 * another. See https://github.com/linked-fw/cli/blob/main/docs/architecture/shared-state-and-error-brands.md.
 */
const requestState = sharedState('@_linked/server-utils', 'RequestData', () => ({
  data: {} as any,
}));

/**
 * Get a certain key from the request data.
 * Request data is data provided by the backend to the frontend
 * @param key
 */
export function getRequestData(key?: string): any {
  return key ? requestState.data[key] : requestState.data;
}

/**
 * Sets the request data. Only to be used on frontend.
 * For backend code use request.frontendData instead.
 * @param key
 * @param value
 */
export function setRequestData(key, value?) {
  if (value && requestState.data) {
    requestState.data[key] = value;
  } else if (!value) {
    //single argument = overwrite the whole array
    requestState.data = key;
  }
}
