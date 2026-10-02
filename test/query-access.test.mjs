// Runs against the build output: `npm run build && npm test`.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerNodeShape } from '@_linked/core/utils/ShapeClass';
import {
  checkQueryAccess,
  collectQueryTargets,
  getProtectedShapeIds,
  getQueryAuthorizers,
  registerProtectedShapes,
  registerQueryAuthorizer,
} from '../lib/esm/utils/QueryAccess.js';
import { runAsSystem, runWithCallContext } from '../lib/esm/utils/CallContext.js';

const NS = 'https://linked.cm/shape/qa-test/';
const Person = NS + 'Person';
const Secret = NS + 'Secret';
const SubSecret = NS + 'SubSecret';
const Account = NS + 'Account';

registerNodeShape({ id: Secret, propertyShapes: [{ id: Secret + '/token', label: 'token', path: { id: 'http://ex/token' } }] });
registerNodeShape({
  id: SubSecret,
  extends: { id: Secret },
  propertyShapes: [{ id: SubSecret + '/extra', label: 'extra', path: { id: 'http://ex/extra' } }],
});
registerNodeShape({ id: Account, propertyShapes: [] });
registerNodeShape({
  id: Person,
  propertyShapes: [
    { id: Person + '/name', label: 'name', path: { id: 'http://ex/name' } },
    { id: Person + '/secret', label: 'secret', path: { id: 'http://ex/secret' }, valueShape: { id: Secret } },
    { id: Person + '/account', label: 'account', path: { id: 'http://ex/account' }, valueShape: { id: Account } },
    { id: Person + '/friends', label: 'friends', path: { id: 'http://ex/friend' }, valueShape: { id: Person } },
  ],
});

// IR as core's lower() produces it for these queries.
const selectName = {
  kind: 'select',
  root: { kind: 'shape_scan', shape: Person, alias: 'a0' },
  patterns: [],
  projection: [{ alias: 'a1', expression: { kind: 'property_expr', sourceAlias: 'a0', property: Person + '/name' } }],
};
const selectNested = {
  kind: 'select',
  root: { kind: 'shape_scan', shape: Person, alias: 'a0' },
  patterns: [{ kind: 'traverse', from: 'a0', to: 'a1', property: Person + '/secret' }],
  projection: [{ alias: 'a2', expression: { kind: 'property_expr', sourceAlias: 'a1', property: Secret + '/token' } }],
};
// Person.select(p => p.friends.as(SubSecret).extra)
const selectCast = {
  kind: 'select',
  root: { kind: 'shape_scan', shape: Person, alias: 'a0' },
  patterns: [{ kind: 'traverse', from: 'a0', to: 'a1', property: Person + '/friends' }],
  projection: [{ alias: 'a1', expression: { kind: 'property_expr', sourceAlias: 'a1', property: SubSecret + '/extra' } }],
};
const updateLinkAccount = {
  kind: 'update',
  shape: Person,
  id: 'http://ex/p1',
  data: { shape: Person, fields: [{ property: Person + '/account', value: { id: 'http://ex/acc1' } }] },
};
const createNestedAccount = {
  kind: 'create',
  shape: Person,
  data: { shape: Person, fields: [{ property: Person + '/account', value: { shape: Account, fields: [] } }] },
};
const deleteAccount = { kind: 'delete', shape: Account, ids: [{ id: 'http://ex/acc1' }] };

const http = (linkedAuth) => ({ kind: 'http', request: { linkedAuth }, response: {} });
const signedIn = http({ userAccount: { id: 'http://ex/me' } });

async function statusOf(p) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e?.status ?? -1;
  }
}

const cleanups = [];
const originalWarn = console.warn;
afterEach(() => {
  console.warn = originalWarn;
  for (const owner of ['test', 'other']) {
    registerProtectedShapes([], { deny: 'all', owner });
    registerProtectedShapes([], { deny: 'write', owner });
  }
  for (const off of cleanups.splice(0)) off();
});
const quiet = () => {
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  return warnings;
};

describe('collectQueryTargets', () => {
  it('collects scanned shapes, property owners and value shapes', () => {
    const t = collectQueryTargets(selectNested);
    assert.deepEqual([...t.shapes].sort(), [Person, Secret].sort());
    assert.deepEqual([...t.propertyShapes].sort(), [Person + '/secret', Secret + '/token'].sort());
    assert.equal(t.writtenShapes.size, 0);
  });

  it('sees a cast through the cast-to shape owning the property', () => {
    assert.ok(collectQueryTargets(selectCast).shapes.has(SubSecret));
  });

  it('separates written shapes from referenced ones', () => {
    const link = collectQueryTargets(updateLinkAccount);
    assert.deepEqual([...link.writtenShapes], [Person]);
    assert.ok(link.shapes.has(Account));
    assert.ok(collectQueryTargets(createNestedAccount).writtenShapes.has(Account));
  });
});

describe('query access registry', () => {
  it('is idempotent per owner and mode', () => {
    registerProtectedShapes([Secret], { deny: 'all', owner: 'test' });
    registerProtectedShapes([Secret], { deny: 'all', owner: 'test' });
    registerProtectedShapes([Account], { deny: 'all', owner: 'test' });
    assert.deepEqual([...getProtectedShapeIds('all')], [Account]);
    registerProtectedShapes([Secret], { deny: 'all', owner: 'other' });
    assert.deepEqual([...getProtectedShapeIds('all')].sort(), [Account, Secret].sort());
    registerProtectedShapes([Person], { deny: 'write', owner: 'test' });
    assert.deepEqual([...getProtectedShapeIds('all')].sort(), [Account, Secret].sort());
    assert.deepEqual([...getProtectedShapeIds('write')], [Person]);
  });

  it('accepts shape classes by their node shape', () => {
    registerProtectedShapes([{ shape: { id: Secret } }], { deny: 'all', owner: 'test' });
    assert.deepEqual([...getProtectedShapeIds('all')], [Secret]);
  });

  it("replaces an owner's authorizer and unregisters only its own", () => {
    const a = () => {};
    const b = () => {};
    const offA = registerQueryAuthorizer(a, { owner: 'test' });
    const offB = registerQueryAuthorizer(b, { owner: 'test' });
    assert.deepEqual(getQueryAuthorizers().filter((f) => f === a || f === b), [b]);
    offA();
    assert.ok(getQueryAuthorizers().includes(b));
    offB();
    assert.ok(!getQueryAuthorizers().includes(b));
  });

  it('requires an owner', () => {
    assert.throws(() => registerProtectedShapes([Secret], { deny: 'all' }), /owner/);
    assert.throws(() => registerQueryAuthorizer(() => {}, {}), /owner/);
  });
});

describe('checkQueryAccess', () => {
  const check = (ir, operation = 'select', mode = 'warn') =>
    checkQueryAccess({ operation, query: {}, ir, mode });

  it('does nothing outside an http call', async () => {
    registerProtectedShapes([Person], { deny: 'all', owner: 'test' });
    assert.equal(await statusOf(check(selectName)), 'ok');
    assert.equal(await statusOf(runAsSystem(() => check(selectName))), 'ok');
  });

  it('warns about anonymous queries in warn mode and refuses them in enforce', async () => {
    const warnings = quiet();
    assert.equal(await statusOf(runWithCallContext(http(), () => check(selectName))), 'ok');
    assert.ok(warnings.some((w) => w.includes('anonymous')));
    assert.equal(await statusOf(runWithCallContext(http(), () => check(selectName, 'select', 'enforce'))), 401);
  });

  it("refuses deny:'all' shapes: traversed into, and cast to a sub shape", async () => {
    quiet();
    registerProtectedShapes([Secret], { deny: 'all', owner: 'test' });
    const run = (ir) => runWithCallContext(signedIn, () => check(ir));
    assert.equal(await statusOf(run(selectName)), 'ok');
    assert.equal(await statusOf(run(selectNested)), 403);
    assert.equal(await statusOf(run(selectCast)), 403);
    // anonymous in warn mode still gets the 403
    assert.equal(await statusOf(runWithCallContext(http(), () => check(selectNested))), 403);
  });

  it("refuses writes to deny:'write' shapes, but not reads or references", async () => {
    quiet();
    registerProtectedShapes([Account], { deny: 'write', owner: 'test' });
    const run = (ir, op) => runWithCallContext(signedIn, () => check(ir, op));
    assert.equal(await statusOf(run(updateLinkAccount, 'update')), 'ok');
    assert.equal(await statusOf(run(createNestedAccount, 'create')), 403);
    assert.equal(await statusOf(run(deleteAccount, 'delete')), 403);
    assert.equal(await statusOf(run({ kind: 'select', root: { kind: 'shape_scan', shape: Account } }, 'select')), 'ok');
  });

  it('refuses unanalysable queries only in enforce mode', async () => {
    quiet();
    assert.equal(await statusOf(runWithCallContext(signedIn, () => check(undefined))), 'ok');
    assert.equal(await statusOf(runWithCallContext(signedIn, () => check(undefined, 'select', 'enforce'))), 403);
  });

  it('runs the authorizers with the analysed targets', async () => {
    const seen = [];
    cleanups.push(
      registerQueryAuthorizer((ctx) => {
        seen.push(ctx);
        if (ctx.shapes.has(Secret)) throw Object.assign(new Error('no'), { status: 403 });
      }, { owner: 'test' })
    );
    assert.equal(await statusOf(runWithCallContext(signedIn, () => check(selectName))), 'ok');
    assert.equal(await statusOf(runWithCallContext(signedIn, () => check(selectNested))), 403);
    assert.equal(seen[0].operation, 'select');
    assert.equal(seen[0].linkedAuth.userAccount.id, 'http://ex/me');
    assert.ok(seen[0].propertyShapes.has(Person + '/name'));
  });
});
