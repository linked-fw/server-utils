// `@_linked/core` is ESM-only with an `import`-conditional export map, which
// jest's CJS resolver cannot follow. `Shape` is only used for an `instanceof`
// check, so a virtual stub is enough.
jest.mock(
  '@_linked/core/shapes/Shape',
  () => ({ Shape: class Shape {} }),
  { virtual: true }
);

import { LincdServerProxy } from './LincdServerProxy';

/**
 * `LincdServerProxy.setAuthHandler` — the supported way for an auth package to
 * refresh a session around `Server.call`, instead of wrapping the private
 * `fetchWithRetry`.
 */
describe('LincdServerProxy.setAuthHandler', () => {
  const realFetch = global.fetch;
  let warnSpy: jest.SpyInstance;
  let sent: { url: string; headers: Record<string, string> }[];

  // respond with the given statuses in order (the last one repeats)
  function respondWith(...statuses: number[]) {
    sent = [];
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, headers: { ...(init.headers as any) } });
      // a retry loop must fail the test, not hang it
      if (sent.length > 5) throw new Error('retry loop');
      const status = statuses[Math.min(sent.length - 1, statuses.length - 1)];
      return new Response(JSON.stringify({ n: sent.length }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
  }

  const proxy = () => new LincdServerProxy('http://localhost');
  const setAuthHandler = (handler: any) =>
    (LincdServerProxy as any).setAuthHandler(handler);

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    LincdServerProxy.addDefaultHeaders({ Authorization: 'Bearer old' });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    global.fetch = realFetch;
    if (typeof (LincdServerProxy as any).setAuthHandler === 'function') {
      setAuthHandler(null);
    }
    LincdServerProxy.removeDefaultHeaders('Authorization');
  });

  it('is a static function', () => {
    expect(typeof (LincdServerProxy as any).setAuthHandler).toBe('function');
  });

  it('calls beforeRequest before sending, and sends the headers it set', async () => {
    respondWith(200);
    const beforeRequest = jest.fn(async (url: string, init: RequestInit) => {
      expect(sent).toHaveLength(0);
      expect(url).toBe('http://localhost/call/pkg/m');
      expect((init as any).method).toBe('POST');
      LincdServerProxy.addDefaultHeaders({ Authorization: 'Bearer new' });
    });
    setAuthHandler({ beforeRequest });

    await expect(proxy().call('pkg', 'm')).resolves.toEqual({ n: 1 });
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.Authorization).toBe('Bearer new');
  });

  it('on a 401 asks onUnauthorized, then retries once with refreshed default headers', async () => {
    respondWith(401, 200);
    const onUnauthorized = jest.fn(async (url: string, res: Response) => {
      expect(res.status).toBe(401);
      LincdServerProxy.addDefaultHeaders({ Authorization: 'Bearer new' });
      return true;
    });
    const unauthenticated = jest.fn();
    LincdServerProxy.registerActionHandler(
      LincdServerProxy.UNAUTHENTICATED_ACTION,
      unauthenticated
    );
    setAuthHandler({ onUnauthorized });

    await expect(proxy().call('pkg', 'm')).resolves.toEqual({ n: 2 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized.mock.calls[0][0]).toBe('http://localhost/call/pkg/m');
    expect(sent.map((s) => s.headers.Authorization)).toEqual([
      'Bearer old',
      'Bearer new',
    ]);
    // the call succeeded in the end, so nobody is told the user is signed out
    expect(unauthenticated).not.toHaveBeenCalled();
    LincdServerProxy.actionHandlers.delete(
      LincdServerProxy.UNAUTHENTICATED_ACTION
    );
  });

  it('does not retry when onUnauthorized returns false', async () => {
    respondWith(401, 200);
    const onUnauthorized = jest.fn(() => false);
    setAuthHandler({ onUnauthorized });

    await expect(proxy().call('pkg', 'm')).rejects.toThrow(/Not authenticated: 401/);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it('retries at most once: a second 401 goes to the caller', async () => {
    respondWith(401);
    const onUnauthorized = jest.fn(() => true);
    setAuthHandler({ onUnauthorized });

    await expect(proxy().call('pkg', 'm')).rejects.toThrow(/Not authenticated: 401/);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
  });

  it('does not ask onUnauthorized for a 403', async () => {
    respondWith(403, 200);
    const onUnauthorized = jest.fn(() => true);
    setAuthHandler({ onUnauthorized });

    await expect(proxy().call('pkg', 'm')).rejects.toThrow(/Not authenticated: 403/);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it('retries without asking when the default headers changed while the call was in flight', async () => {
    // another call refreshed the session after this one was sent
    sent = [];
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, headers: { ...(init.headers as any) } });
      if (sent.length === 1) {
        LincdServerProxy.addDefaultHeaders({ Authorization: 'Bearer new' });
        return new Response('{}', { status: 401 });
      }
      return new Response('{"ok":true}', { status: 200 });
    }) as any;
    const onUnauthorized = jest.fn(() => false);
    setAuthHandler({ onUnauthorized });

    await expect(proxy().call('pkg', 'm')).resolves.toEqual({ ok: true });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(sent.map((s) => s.headers.Authorization)).toEqual([
      'Bearer old',
      'Bearer new',
    ]);
  });

  it('a throwing hook does not break the call', async () => {
    respondWith(401);
    setAuthHandler({
      beforeRequest: () => {
        throw new Error('refresh failed');
      },
      onUnauthorized: async () => {
        throw new Error('refresh failed');
      },
    });

    await expect(proxy().call('pkg', 'm')).rejects.toThrow(/Not authenticated: 401/);
    expect(sent).toHaveLength(1);
  });

  describe('callCustomShapeMethod', () => {
    class Thing {
      static shape = { id: 'https://example.org/shape/Thing' };
      static packageName = 'pkg';
    }

    it('sends the default headers (but not the JSON content type) and goes through the hook', async () => {
      respondWith(401, 200);
      const beforeRequest = jest.fn();
      const onUnauthorized = jest.fn(() => {
        LincdServerProxy.addDefaultHeaders({ Authorization: 'Bearer new' });
        return true;
      });
      setAuthHandler({ beforeRequest, onUnauthorized });

      const result = await proxy().callCustomShapeMethod(
        Thing as any,
        'POST',
        'upload',
        'body',
        { 'X-Custom': '1' }
      );

      expect(result).toEqual({ n: 2 });
      expect(beforeRequest).toHaveBeenCalledTimes(1);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(sent[0].url).toContain('/call/pkg/Thing/upload?shapeURI=');
      expect(sent.map((s) => s.headers.Authorization)).toEqual([
        'Bearer old',
        'Bearer new',
      ]);
      expect(sent[1].headers['X-Custom']).toBe('1');
      // the body may be FormData, which needs the browser to set its own boundary
      expect(sent[0].headers['Content-Type']).toBeUndefined();
    });

    it('lets the caller override a default header', async () => {
      respondWith(200);
      await proxy().callCustomShapeMethod(Thing as any, 'POST', 'm', 'b', {
        Authorization: 'Bearer explicit',
      });
      expect(sent[0].headers.Authorization).toBe('Bearer explicit');
    });
  });

  describe('without a handler', () => {
    it('does not retry a 401', async () => {
      respondWith(401, 200);
      await expect(proxy().call('pkg', 'm')).rejects.toThrow(/Not authenticated: 401/);
      expect(sent).toHaveLength(1);
    });

    it('still retries a 503 as before', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      try {
        respondWith(503, 200);
        const result = proxy().call('pkg', 'm');
        await jest.advanceTimersByTimeAsync(300);
        await expect(result).resolves.toEqual({ n: 2 });
        expect(sent).toHaveLength(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
