import {
  currentRequest,
  getCallContext,
  requireSessionUser,
  runAsSystem,
  runWithCallContext,
} from './CallContext.js';
import { BackendProvider } from './BackendProvider.js';
import { ServerCallError } from './ServerCallError.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const http = (request: any, response: any = {}) =>
  ({ kind: 'http', request, response }) as const;

afterEach(() => jest.restoreAllMocks());

describe('CallContext', () => {
  it('is undefined outside any call', () => {
    expect(getCallContext()).toBeUndefined();
    expect(currentRequest()).toBeUndefined();
  });

  it('keeps two interleaved async calls apart', async () => {
    const reqA = { linkedAuth: { userAccount: 'a' } };
    const reqB = { linkedAuth: { userAccount: 'b' } };
    const seen: string[] = [];
    const call = (req: any, delays: number[]) =>
      runWithCallContext(http(req), async () => {
        for (const d of delays) {
          await tick(d);
          seen.push(`${req.linkedAuth.userAccount}:${currentRequest().linkedAuth.userAccount}`);
        }
      });
    await Promise.all([call(reqA, [5, 0, 10]), call(reqB, [0, 10, 0])]);
    expect(seen).toHaveLength(6);
    for (const entry of seen) {
      const [expected, actual] = entry.split(':');
      expect(actual).toBe(expected);
    }
  });

  it('runAsSystem has no request, even inside an http call', async () => {
    await runWithCallContext(http({ linkedAuth: { userAccount: 'a' } }), async () => {
      await runAsSystem(async () => {
        await tick();
        expect(getCallContext()).toEqual({ kind: 'system', reason: 'job' });
        expect(currentRequest()).toBeUndefined();
      }, 'job');
      expect(currentRequest().linkedAuth.userAccount).toBe('a');
    });
  });

  it('shares one storage between module copies via globalThis', () => {
    const storage = (globalThis as any)[Symbol.for('@_linked/server-utils:callContext')];
    runWithCallContext(http({ x: 1 }), () => {
      expect(storage.getStore().request).toEqual({ x: 1 });
    });
  });

  describe('requireSessionUser', () => {
    it('returns the session user of an http call', () => {
      runWithCallContext(http({ linkedAuth: { userAccount: { id: 'u' } } }), () => {
        expect(requireSessionUser()).toEqual({ id: 'u' });
      });
    });

    it('throws a 401 ServerCallError for an http call without a session', () => {
      runWithCallContext(http({}), () => {
        let thrown: any;
        try {
          requireSessionUser();
        } catch (e) {
          thrown = e;
        }
        expect(ServerCallError.is(thrown)).toBe(true);
        expect(thrown.status).toBe(401);
      });
    });

    it('throws a plain Error in system context and outside any call', () => {
      runAsSystem(() => {
        expect(() => requireSessionUser()).toThrow(/system context/);
      });
      expect(() => requireSessionUser()).toThrow(/outside any request/);
      try {
        runAsSystem(() => requireSessionUser());
      } catch (e) {
        expect(ServerCallError.is(e)).toBe(false);
      }
    });
  });
});

describe('BackendProvider request context', () => {
  class TestProvider extends BackendProvider {
    readRequest() {
      return this.request;
    }
    other() {
      return this.callOtherProvider<TestProvider>(TestProvider);
    }
  }

  it('reads request and response from the current call', () => {
    const provider = new TestProvider({}, {});
    const req = { id: 1 };
    const res = { id: 2 };
    expect(provider.request).toBeUndefined();
    runWithCallContext(http(req, res), () => {
      expect(provider.request).toBe(req);
      expect(provider.response).toBe(res);
    });
    expect(provider.request).toBeUndefined();
  });

  it('a singleton sees each interleaved call its own request', async () => {
    const provider = new TestProvider({}, {});
    const run = (req: any) =>
      runWithCallContext(http(req), async () => {
        await provider.initRequest(req, {});
        await tick(req.delay);
        return provider.readRequest();
      });
    const a = { delay: 10 };
    const b = { delay: 0 };
    const [ra, rb] = await Promise.all([run(a), run(b)]);
    expect(ra).toBe(a);
    expect(rb).toBe(b);
  });

  it('initRequest no longer writes shared state', () => {
    const provider = new TestProvider({}, {});
    provider.initRequest({ forged: true }, {});
    expect(provider.request).toBeUndefined();
  });

  it('assigning the context request is a silent no-op', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new TestProvider({}, {});
    const req = {};
    runWithCallContext(http(req), () => {
      provider.request = req;
      expect(provider.request).toBe(req);
    });
    expect(provider.request).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a legacy assignment pins the value on that instance and warns once per class', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    class LegacyProvider extends BackendProvider {}
    const p1 = new LegacyProvider({}, {});
    const p2 = new LegacyProvider({}, {});
    const pinned = { pinned: true };
    p1.request = pinned;
    p2.request = { other: true };
    expect(p1.request).toBe(pinned);
    runWithCallContext(http({ ctx: true }), () => {
      expect(p1.request).toBe(pinned);
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/LegacyProvider assigns this.request/);
    // an untouched instance still reads the context
    const p3 = new LegacyProvider({}, {});
    runWithCallContext(http({ ctx: 3 }), () => {
      expect(p3.request).toEqual({ ctx: 3 });
    });
  });

  it('callOtherProvider returns an instance on the same call context', () => {
    const provider = new TestProvider({ app: 1 }, { server: 1 });
    const req = {};
    runWithCallContext(http(req), () => {
      const other = provider.other();
      expect(other).not.toBe(provider);
      expect(other.request).toBe(req);
      expect(other.server).toEqual({ app: 1 });
    });
  });

  it('a provider route runs in the per-call context', async () => {
    let seen: any;
    class RouteProvider extends BackendProvider {
      register() {
        this.registerRoute('get', '/x', (req: any, res: any) => {
          seen = this.request;
          res.json({ ok: true });
        });
      }
    }
    let handler: any;
    const app: any = { get: (_p: string, h: any) => (handler = h) };
    new RouteProvider(app, {}).register();
    const req = { originalUrl: '/x' };
    const res: any = { on() {}, json() {}, status() { return res; } };
    await handler(req, res, () => {});
    expect(seen).toBe(req);
  });
});
