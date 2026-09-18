// Runs against the build output: `npm run build && npm test`.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LincdServerProxy } from '../lib/esm/utils/LincdServerProxy.js';
import { ServerCallError } from '../lib/esm/utils/ServerCallError.js';

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
});

function respondWith(status, body, statusText = '') {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : body, {
      status,
      statusText,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  console.warn = () => {};
  return calls;
}

const proxy = () => new LincdServerProxy('http://example.test');

describe('Server.call over HTTP with rejectOnError', () => {
  for (const [status, error] of [
    [500, 'internal server error'],
    [501, 'No provider for pkg/missing'],
  ]) {
    it(`rejects on ${status} with the status and the server's message`, async () => {
      respondWith(status, JSON.stringify({ error }));
      await assert.rejects(
        proxy().call('pkg', { method: 'missing', rejectOnError: true }),
        (err) => {
          assert.ok(err instanceof ServerCallError);
          assert.ok(err instanceof Error);
          assert.equal(err.status, status);
          assert.equal(err.message, error);
          return true;
        }
      );
    });
  }

  it('falls back to the status text when the body has no {error}', async () => {
    respondWith(500, '<html>oops</html>', 'Internal Server Error');
    await assert.rejects(
      proxy().call('pkg', { method: 'm', rejectOnError: true }),
      { name: 'ServerCallError', status: 500, message: 'Internal Server Error' }
    );
  });

  it('still resolves successful results, including null', async () => {
    respondWith(200, JSON.stringify({ value: 1 }));
    assert.deepEqual(
      await proxy().call('pkg', { method: 'm', rejectOnError: true }),
      { value: 1 }
    );
    respondWith(200, 'null');
    assert.equal(
      await proxy().call('pkg', { method: 'm', rejectOnError: true }),
      null
    );
  });

  it('sends the call to the same route as before', async () => {
    const calls = respondWith(200, 'null');
    await proxy().call('pkg', { method: 'm', rejectOnError: true }, 1, 2);
    assert.equal(calls[0].url, 'http://example.test/call/pkg/m');
    assert.equal(calls[0].init.body, JSON.stringify({ args: [1, 2] }));
  });
});

describe('Server.call over HTTP without the opt-in', () => {
  for (const status of [500, 501]) {
    it(`resolves undefined on ${status}`, async () => {
      respondWith(status, JSON.stringify({ error: 'boom' }));
      assert.equal(await proxy().call('pkg', 'm'), undefined);
      assert.equal(await proxy().call('pkg', { method: 'm' }), undefined);
    });
  }
});

describe('Server.call on the local server path', () => {
  function localProxy(impl) {
    const p = proxy();
    p.localServer = { callBackendMethod: impl, callShapeMethod: impl };
    console.warn = () => {};
    return p;
  }
  const noProvider = async () => {
    throw new ServerCallError(501, 'No provider for pkg/m');
  };
  const throwing = async () => {
    throw new Error('boom');
  };

  it('resolves undefined for an unmatched call by default', async () => {
    assert.equal(await localProxy(noProvider).call('pkg', 'm'), undefined);
  });

  it('rejects an unmatched call with 501 when opted in', async () => {
    await assert.rejects(
      localProxy(noProvider).call('pkg', { method: 'm', rejectOnError: true }),
      { name: 'ServerCallError', status: 501, message: 'No provider for pkg/m' }
    );
  });

  it('rethrows a provider error unchanged by default', async () => {
    await assert.rejects(localProxy(throwing).call('pkg', 'm'), (err) => {
      assert.equal(err.message, 'boom');
      assert.ok(!(err instanceof ServerCallError));
      return true;
    });
  });

  it('wraps a provider error as a 500 ServerCallError when opted in', async () => {
    await assert.rejects(
      localProxy(throwing).call('pkg', { method: 'm', rejectOnError: true }),
      (err) => {
        assert.ok(err instanceof ServerCallError);
        assert.equal(err.status, 500);
        assert.equal(err.message, 'boom');
        assert.equal(err.cause.message, 'boom');
        return true;
      }
    );
  });

  it('bypasses the local server with forceFetch', async () => {
    respondWith(501, JSON.stringify({ error: 'No provider for pkg/m' }));
    const p = proxy();
    p.localServer = {
      callBackendMethod: () => assert.fail('local server should be bypassed'),
    };
    await assert.rejects(
      p.call('pkg', { method: 'm', forceFetch: true, rejectOnError: true }),
      { status: 501 }
    );
  });
});
