import { BackendProvider } from './BackendProvider';

/**
 * Covers the guard `registerRoute` puts around every handler it registers.
 *
 * The bug it exists for: Express 4 ignores the promise an `async` handler
 * returns, so a rejection reached no error handler and nothing wrote to the
 * response — the request hung until the client timed out, with nothing in the
 * log. These tests pin both halves of the guard (throw → 500 + log, hang →
 * a named warning) and the attribution rule that keeps a hanging route from
 * being reported once per upstream `use` layer.
 */

/** Minimal stand-in for the express app BackendProvider is constructed with. */
class FakeApp {
  _router = { stack: [] as any[] };
  registered: Record<string, any[]> = {};

  private record(method: string, path: string, handlers: any[]) {
    this.registered[`${method} ${path}`] = handlers;
    for (const h of handlers) this._router.stack.push({ handler: h });
  }
  get = (path: string, ...h: any[]) => this.record('get', path, h);
  post = (path: string, ...h: any[]) => this.record('post', path, h);
  use = (path: string, ...h: any[]) => this.record('use', path, h);
}

/** `registerRoute`/`disposeRoutes` are protected — expose them for the test. */
class TestProvider extends BackendProvider {
  register(method: string, path: string, ...handlers: any[]) {
    return (this as any).registerRoute(method, path, ...handlers);
  }
  dispose() {
    return (this as any).disposeRoutes();
  }
}

function makeRes() {
  const listeners: Record<string, Array<() => void>> = {};
  const res: any = {
    headersSent: false,
    statusCode: undefined as number | undefined,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res.body = body;
      res.headersSent = true;
      res.emit('finish');
      return res;
    },
    on(event: string, fn: () => void) {
      (listeners[event] ||= []).push(fn);
      return res;
    },
    emit(event: string) {
      (listeners[event] || []).forEach((fn) => fn());
    },
  };
  return res;
}

const makeReq = (url = '/some/url') => ({ originalUrl: url });

/** Register one handler and hand back the wrapper express actually received. */
function registerAndGet(
  app: FakeApp,
  provider: TestProvider,
  method: string,
  path: string,
  handler: any
) {
  provider.register(method, path, handler);
  return app.registered[`${method} ${path}`][0];
}

describe('BackendProvider.registerRoute guard', () => {
  let app: FakeApp;
  let provider: TestProvider;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    app = new FakeApp();
    provider = new TestProvider(app, {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete process.env.LINKED_ROUTE_WARN_MS;
  });

  describe('rejections', () => {
    it('answers 500 instead of hanging when a route handler throws', async () => {
      const wrapped = registerAndGet(app, provider, 'get', '/boom', async () => {
        throw new Error('kaboom');
      });
      const res = makeRes();

      await wrapped(makeReq('/boom?x=1'), res, jest.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        error: 'internal server error',
        route: 'GET /boom',
      });
    });

    it('logs the failure with the route name and the stack', async () => {
      const err = new Error('kaboom');
      const wrapped = registerAndGet(app, provider, 'get', '/boom', async () => {
        throw err;
      });

      await wrapped(makeReq(), makeRes(), jest.fn());

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, detail] = errorSpy.mock.calls[0];
      expect(message).toContain('GET /boom failed');
      expect(detail).toBe(err.stack);
    });

    it('forwards to next(err) for middleware rather than sending JSON', async () => {
      const err = new Error('middleware blew up');
      const wrapped = registerAndGet(app, provider, 'use', '/', async () => {
        throw err;
      });
      const res = makeRes();
      const next = jest.fn();

      await wrapped(makeReq(), res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.statusCode).toBeUndefined();
      expect(res.body).toBeUndefined();
    });

    it('does not write again when the response has already been sent', async () => {
      const wrapped = registerAndGet(app, provider, 'get', '/late', async (_req, res) => {
        res.json({ ok: true });
        throw new Error('after responding');
      });
      const res = makeRes();

      await wrapped(makeReq(), res, jest.fn());

      expect(res.body).toEqual({ ok: true });
      expect(res.statusCode).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves a successful handler untouched', async () => {
      const wrapped = registerAndGet(app, provider, 'get', '/ok', async (_req, res) => {
        res.json({ ok: true });
      });
      const res = makeRes();

      await wrapped(makeReq(), res, jest.fn());

      expect(res.body).toEqual({ ok: true });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('what is left unwrapped', () => {
    it('passes arity-4 error middleware through untouched', () => {
      // Wrapping would change its arity and stop express recognising it as an
      // error handler.
      const errorMiddleware = (_err, _req, _res, _next) => {};
      const wrapped = registerAndGet(app, provider, 'use', '/', errorMiddleware);
      expect(wrapped).toBe(errorMiddleware);
    });

    it('passes non-function handlers through untouched', () => {
      const notAFunction = { some: 'object' } as any;
      const wrapped = registerAndGet(app, provider, 'use', '/', notAFunction);
      expect(wrapped).toBe(notAFunction);
    });

    it('keeps the original handler name for stack traces', () => {
      async function myHandler() {}
      const wrapped = registerAndGet(app, provider, 'get', '/named', myHandler);
      expect(wrapped.name).toBe('myHandler');
    });
  });

  describe('watchdog', () => {
    beforeEach(() => jest.useFakeTimers());

    it('warns, naming the route and url, when a route never responds', async () => {
      process.env.LINKED_ROUTE_WARN_MS = '1000';
      const wrapped = registerAndGet(app, provider, 'get', '/hang', async () => {
        await new Promise(() => {});
      });

      void wrapped(makeReq('/hang?a=b'), makeRes(), jest.fn());
      jest.advanceTimersByTime(1000);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [msg] = warnSpy.mock.calls[0];
      expect(msg).toContain('GET /hang has not responded after 1000ms');
      expect(msg).toContain('/hang?a=b');
    });

    it('stays quiet when the route responds in time', async () => {
      process.env.LINKED_ROUTE_WARN_MS = '1000';
      const wrapped = registerAndGet(app, provider, 'get', '/fast', async (_req, res) => {
        res.json({ ok: true });
      });

      await wrapped(makeReq(), makeRes(), jest.fn());
      jest.advanceTimersByTime(5000);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not report a hanging ROUTE once per upstream `use` layer', async () => {
      // Regression test. Middleware is done once it has called next(); if its
      // watchdog stayed armed until the response finished, every `use` layer
      // in the chain would warn about a route's hang, all labelled `USE /`.
      process.env.LINKED_ROUTE_WARN_MS = '1000';
      const middleware = registerAndGet(app, provider, 'use', '/', async (_req, _res, next) => {
        next();
      });

      const res = makeRes();
      await middleware(makeReq('/hang'), res, jest.fn());
      jest.advanceTimersByTime(5000);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('still warns when middleware itself never calls next', async () => {
      process.env.LINKED_ROUTE_WARN_MS = '1000';
      const middleware = registerAndGet(app, provider, 'use', '/', async () => {
        await new Promise(() => {});
      });

      void middleware(makeReq('/stuck'), makeRes(), jest.fn());
      jest.advanceTimersByTime(1000);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('USE / has not responded');
    });

    it('is disabled by LINKED_ROUTE_WARN_MS=0', async () => {
      process.env.LINKED_ROUTE_WARN_MS = '0';
      const wrapped = registerAndGet(app, provider, 'get', '/hang', async () => {
        await new Promise(() => {});
      });

      void wrapped(makeReq(), makeRes(), jest.fn());
      jest.advanceTimersByTime(60000);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('falls back to the default rather than silently disabling on a bad value', async () => {
      // Number('abc') is NaN, and `NaN > 0` is false — which would have turned
      // the watchdog off without saying so.
      process.env.LINKED_ROUTE_WARN_MS = 'not-a-number';
      const wrapped = registerAndGet(app, provider, 'get', '/hang', async () => {
        await new Promise(() => {});
      });

      void wrapped(makeReq(), makeRes(), jest.fn());
      jest.advanceTimersByTime(15000);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('after 15000ms');
    });
  });

  describe('HMR layer tracking still works through the wrapper', () => {
    it('tracks registered layers and disposeRoutes removes exactly those', () => {
      const other = { handler: 'someone elses layer' };
      app._router.stack.push(other);

      provider.register('get', '/a', async () => {});
      provider.register('get', '/b', async () => {});
      expect(app._router.stack).toHaveLength(3);

      provider.dispose();

      expect(app._router.stack).toEqual([other]);
    });
  });
});
