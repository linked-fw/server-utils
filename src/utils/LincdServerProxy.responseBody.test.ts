// `@_linked/core` is ESM-only with an `import`-conditional export map, which
// jest's CJS resolver cannot follow. `Shape` is only used for an `instanceof`
// check on paths this test does not take, so a virtual stub is enough.
jest.mock(
  '@_linked/core/shapes/Shape',
  () => ({ Shape: class Shape {} }),
  { virtual: true }
);

import { LincdServerProxy } from './LincdServerProxy';

/**
 * A 200 whose body is not JSON must surface the body's content.
 *
 * The bug it exists for: the ok-branch did `res.json().catch(… res.text() …)`.
 * `json()` has already consumed the stream, so the `text()` meant to report the
 * payload threw `body stream already read` — the diagnostic destroyed exactly
 * the evidence it was written to produce, and the real message never reached
 * anyone.
 */
describe('fetchBackend response body handling', () => {
  const realFetch = global.fetch;
  let warnings: string[];
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnings = [];
    warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation((...args: any[]) => {
        warnings.push(args.map((a) => String(a)).join(' '));
      });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    global.fetch = realFetch;
  });

  function respondWith(body: string, init?: ResponseInit) {
    global.fetch = jest.fn(async () => new Response(body, init)) as any;
  }

  const call = (proxy: LincdServerProxy) =>
    (proxy as any).fetchBackend('http://localhost/call/x', '{}');

  it('surfaces the body of a non-JSON 200 instead of throwing', async () => {
    respondWith('Authentication is required for drafts', { status: 200 });
    const proxy = new LincdServerProxy('http://localhost');

    await expect(call(proxy)).resolves.toBeUndefined();

    const joined = warnings.join('\n');
    // browsers say "body stream already read", undici "Body has already been read"
    expect(joined).not.toMatch(/already (been )?read/i);
    expect(joined).toContain('Authentication is required for drafts');
  });

  it('surfaces the body of a malformed JSON 200', async () => {
    respondWith('{"error": "boom"', { status: 200 });
    const proxy = new LincdServerProxy('http://localhost');

    await call(proxy);

    const joined = warnings.join('\n');
    expect(joined).not.toMatch(/already (been )?read/i);
    expect(joined).toContain('{"error": "boom"');
  });

  it('still parses a well-formed JSON 200', async () => {
    respondWith(JSON.stringify({ hello: 'world' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const proxy = new LincdServerProxy('http://localhost');

    await expect(call(proxy)).resolves.toEqual({ hello: 'world' });
  });
});
