/**
 * The error a server call rejects with when the caller opts in with
 * `rejectOnError: true` (see `CallConfig`).
 *
 * `status` is the HTTP status of the failed response (e.g. 500 for a provider
 * method that threw, 501 for a call no provider handles). `message` is the
 * server's `{error}` message when it sent one, or the status text otherwise.
 *
 * A LinkedServer also throws it for backend-to-backend calls, so the `status`
 * is available on both the HTTP path and the local server path.
 */
export class ServerCallError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ServerCallError';
    this.status = status;
    if (options && 'cause' in options) {
      (this as any).cause = options.cause;
    }
  }

  /**
   * True for a `ServerCallError`, including one created by another copy of this
   * package (so it does not rely on `instanceof`).
   */
  static is(err: unknown): err is ServerCallError {
    return (
      !!err &&
      typeof err === 'object' &&
      (err as any).name === 'ServerCallError' &&
      typeof (err as any).status === 'number'
    );
  }
}
