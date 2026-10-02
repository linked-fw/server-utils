// Runs against the build output: `npm run build && npm test`.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSONParser } from '../lib/esm/utils/JSONParser.js';
import { ServerCallError } from '../lib/esm/utils/ServerCallError.js';

const originalWarn = console.warn;
afterEach(() => {
  console.warn = originalWarn;
});

describe('JSONParser on the RPC path', () => {
  it('drops __proto__ keys instead of setting the prototype', () => {
    const parsed = JSONParser.parse('{"a":1,"__proto__":{"polluted":true}}');
    assert.equal(parsed.a, 1);
    assert.equal(parsed.polluted, undefined);
    assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
    assert.equal({}.polluted, undefined);
  });

  it('drops nested __proto__ keys too', () => {
    const parsed = JSONParser.parse('{"args":[{"x":{"__proto__":{"isAdmin":true}}}]}');
    assert.equal(parsed.args[0].x.isAdmin, undefined);
    assert.equal(Object.getPrototypeOf(parsed.args[0].x), Object.prototype);
  });

  it("rejects a shape class marker with 'reject' (400)", () => {
    assert.throws(
      () => JSONParser.parseObject({ args: [{ __sc: 'http://x/Shape' }] }, { shapeClasses: 'reject' }),
      (err) => ServerCallError.is(err) && err.status === 400
    );
  });

  it('passes the option through collections', () => {
    assert.throws(
      () =>
        JSONParser.parseObject(
          { m: { __type: 'cm', entries: [['k', { __sc: 'http://x/S' }]] } },
          { shapeClasses: 'reject' }
        ),
      /Shape class/
    );
  });

  it("revives a shape class marker with 'warn', warning once per shape", () => {
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    const marker = { __sc: 'http://x/WarnedShape' };
    const out = JSONParser.parseObject({ args: [marker] }, { shapeClasses: 'warn' });
    JSONParser.parseObject({ args: [marker] }, { shapeClasses: 'warn' });
    assert.equal(typeof out.args[0], 'function');
    assert.equal(warnings.filter((w) => w.includes('revives the Shape class')).length, 1);
  });

  it('keeps reviving shape classes by default', () => {
    console.warn = () => {};
    const parsed = JSONParser.parseObject({ v: { __sc: 'http://x/Unknown' } });
    assert.equal(typeof parsed.v, 'function');
  });
});
