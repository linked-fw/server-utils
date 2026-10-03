// Runs against the build output: `npm run build && npm test`.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerNodeShape } from '@_linked/core/utils/ShapeClass';
import {
  checkQueryAccess,
  collectMutationNodes,
  collectQueryTargets,
  getProtectedClassIds,
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

const Cls = (name) => 'http://ex/class/' + name;
registerNodeShape({ id: Secret, targetClass: { id: Cls('Secret') }, propertyShapes: [{ id: Secret + '/token', label: 'token', path: { id: 'http://ex/token' } }] });
registerNodeShape({
  id: SubSecret,
  targetClass: { id: Cls('SubSecret') },
  extends: { id: Secret },
  propertyShapes: [{ id: SubSecret + '/extra', label: 'extra', path: { id: 'http://ex/extra' } }],
});
registerNodeShape({ id: Account, targetClass: { id: Cls('Account') }, propertyShapes: [] });
registerNodeShape({
  id: Person,
  targetClass: { id: Cls('Person') },
  propertyShapes: [
    { id: Person + '/vault', label: 'vault', path: { id: 'http://ex/vault' }, valueShape: { id: Secret }, contains: true },
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
  const noProtectedNodes = async () => false;
  const check = (ir, operation = 'select', mode = 'warn', probeProtectedNodes = noProtectedNodes) =>
    checkQueryAccess({ operation, query: {}, ir, mode, probeProtectedNodes });

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

  it('refuses a query that could not be analysed, in every mode', async () => {
    quiet();
    assert.equal(await statusOf(runWithCallContext(signedIn, () => check(undefined))), 400);
    assert.equal(await statusOf(runWithCallContext(signedIn, () => check(undefined, 'select', 'enforce'))), 400);
  });

  it('refuses an operation that does not match the query kind', async () => {
    quiet();
    const run = (ir, op) => runWithCallContext(signedIn, () => check(ir, op));
    assert.equal(await statusOf(run(deleteAccount, 'select')), 400);
    assert.equal(await statusOf(run(selectName, 'delete')), 400);
    assert.equal(await statusOf(run(createNestedAccount, 'update')), 400);
    assert.equal(await statusOf(run({ kind: 'count', root: selectName.root }, 'select')), 'ok');
    assert.equal(await statusOf(run({ kind: 'delete_all', shape: Person }, 'delete')), 'ok');
  });

  it('refuses anonymous mutations in every mode', async () => {
    quiet();
    const anon = (ir, op, mode) => runWithCallContext(http(), () => check(ir, op, mode));
    assert.equal(await statusOf(anon(updateLinkAccount, 'update', 'warn')), 401);
    assert.equal(await statusOf(anon(createNestedAccount, 'create', 'warn')), 401);
    assert.equal(await statusOf(anon({ kind: 'delete', shape: Person, ids: [{ id: 'http://ex/p' }] }, 'delete', 'warn')), 401);
    // reads stay a warning in warn mode
    assert.equal(await statusOf(anon(selectName, 'select', 'warn')), 'ok');
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

const createWithId = (id) => ({ kind: 'create', shape: Person, data: { shape: Person, id, fields: [] } });
const updateName = (id) => ({
  kind: 'update',
  shape: Person,
  id,
  data: { shape: Person, fields: [{ property: Person + '/name', value: 'x' }] },
});

describe('collectMutationNodes', () => {
  it('names targets, client ids, owned references and scans', () => {
    assert.deepEqual(collectMutationNodes(createWithId('http://ex/s1')).clientIds, ['http://ex/s1']);
    assert.deepEqual(collectMutationNodes(createNestedAccount).clientIds, []);
    const nestedId = {
      kind: 'update',
      shape: Person,
      id: 'http://ex/p1',
      data: { shape: Person, fields: [{ property: Person + '/secret', value: { shape: Secret, id: 'http://ex/s1', fields: [] } }] },
    };
    assert.deepEqual(collectMutationNodes(nestedId).clientIds, ['http://ex/s1']);
    assert.deepEqual(collectMutationNodes(updateName('http://ex/p1')), {
      clientIds: [],
      ids: ['http://ex/p1'],
      ownerIds: [],
      scanShapes: [],
    });
    // a reference is not a write, unless the property owns its values
    assert.deepEqual(collectMutationNodes(updateLinkAccount).ids, ['http://ex/p1']);
    const setVault = {
      kind: 'update',
      shape: Person,
      id: 'http://ex/p1',
      data: { shape: Person, fields: [{ property: Person + '/vault', value: { remove: [{ id: 'http://ex/s9' }] } }] },
    };
    const vault = collectMutationNodes(setVault);
    assert.deepEqual(vault.ids.sort(), ['http://ex/p1', 'http://ex/s9']);
    assert.deepEqual(vault.ownerIds, ['http://ex/p1']);
    // deleting a shape that owns values cascades
    assert.deepEqual(collectMutationNodes({ kind: 'delete', shape: Person, ids: [{ id: 'http://ex/p1' }] }).ownerIds, ['http://ex/p1']);
    assert.deepEqual(collectMutationNodes({ kind: 'delete_where', shape: Person, where: {}, wherePatterns: [] }).scanShapes, [Person]);
  });
});

describe('protected nodes', () => {
  const run = (ir, op, probe) =>
    runWithCallContext(signedIn, () => checkQueryAccess({ operation: op, query: {}, ir, mode: 'warn', probeProtectedNodes: probe }));

  it('lists the classes of protected shapes and of the shapes that extend them', () => {
    registerProtectedShapes([Secret], { deny: 'write', owner: 'test' });
    assert.deepEqual([...getProtectedClassIds()].sort(), [Cls('Secret'), Cls('SubSecret')].sort());
  });

  it('refuses a create that chooses its id, with or without protected shapes', async () => {
    quiet();
    assert.equal(await statusOf(run(createWithId('http://ex/s1'), 'create', async () => false)), 403);
    assert.equal(await statusOf(run(createNestedAccount, 'create', async () => false)), 'ok');
  });

  it('asks about every target and refuses when a protected node would be written', async () => {
    quiet();
    registerProtectedShapes([Secret], { deny: 'write', owner: 'test' });
    const checks = [];
    const probe = async (c) => {
      checks.push(c);
      return c.ids.includes('http://ex/secret1');
    };
    assert.equal(await statusOf(run(updateName('http://ex/secret1'), 'update', probe)), 403);
    assert.equal(await statusOf(run({ kind: 'delete', shape: Person, ids: [{ id: 'http://ex/secret1' }] }, 'delete', probe)), 403);
    assert.equal(await statusOf(run(updateName('http://ex/p1'), 'update', probe)), 'ok');
    assert.equal(checks[0].shape, Person);
    assert.deepEqual(checks[0].classes.sort(), [Cls('Secret'), Cls('SubSecret')].sort());
    assert.deepEqual(checks[1].ownerIds, ['http://ex/secret1']);
    assert.deepEqual(checks[1].containsPredicates, ['http://ex/vault']);
  });

  it('passes the target class of a where/all mutation', async () => {
    quiet();
    registerProtectedShapes([Secret], { deny: 'write', owner: 'test' });
    let seen;
    const probe = async (c) => ((seen = c), false);
    assert.equal(await statusOf(run({ kind: 'delete_all', shape: Person }, 'delete', probe)), 'ok');
    assert.deepEqual(seen.scanClasses, [Cls('Person')]);
  });

  it('fails closed without a probe, when the probe throws, or on a non-boolean answer', async () => {
    quiet();
    registerProtectedShapes([Secret], { deny: 'write', owner: 'test' });
    assert.equal(await statusOf(run(updateName('http://ex/p1'), 'update', undefined)), 403);
    assert.equal(await statusOf(run(updateName('http://ex/p1'), 'update', async () => { throw new Error('down'); })), 403);
    assert.equal(await statusOf(run(updateName('http://ex/p1'), 'update', async () => undefined)), 403);
  });

  it('skips the lookup when nothing is protected', async () => {
    let asked = false;
    assert.equal(await statusOf(run(updateName('http://ex/p1'), 'update', async () => ((asked = true), true))), 'ok');
    assert.equal(asked, false);
  });
});

describe('raw queries', () => {
  const raw = (ctx, mode = 'warn', rawQueries) =>
    runWithCallContext(ctx, () =>
      checkQueryAccess({ operation: 'select', query: 'SELECT * WHERE { ?s ?p ?o }', ir: undefined, raw: true, mode, endpoint: 'api/select-raw', rawQueries })
    );

  for (const mode of ['warn', 'enforce']) {
    it(`run for a signed-in session by default (${mode})`, async () => {
      assert.equal(await statusOf(raw(signedIn, mode)), 'ok');
      assert.equal(await statusOf(raw(signedIn, mode, 'session')), 'ok');
    });

    it(`need a session (${mode})`, async () => {
      assert.equal(await statusOf(raw(http(), mode)), 401);
      assert.equal(await statusOf(raw(http(), mode, 'session')), 401);
    });

    it(`are refused when turned off, session or not (${mode})`, async () => {
      quiet();
      assert.equal(await statusOf(raw(signedIn, mode, 'off')), 403);
      assert.equal(await statusOf(raw(http(), mode, 'off')), 403);
    });

    it(`are refused for an unknown rawQueries value (${mode})`, async () => {
      quiet();
      assert.equal(await statusOf(raw(signedIn, mode, 'open')), 403);
    });
  }

  it('are not checked outside a request', async () => {
    assert.equal(await statusOf(runAsSystem(() => checkQueryAccess({ operation: 'select', query: 'ASK {}', ir: undefined, raw: true, mode: 'enforce', rawQueries: 'off' }))), 'ok');
  });
});
