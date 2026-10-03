// Runs against the build output: `npm run build && npm test`.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addNodeShapeToShapeClass,
  getNodeShape,
  registerNodeShape,
} from '@_linked/core/utils/ShapeClass';
import { Shape } from '@_linked/core/shapes/Shape';
import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import {
  checkQueryAccess,
  collectClientIds,
  collectQueryTargets,
  getStoreAccess,
  withAccess,
} from '../lib/esm/utils/QueryAccess.js';
import { runAsSystem, runWithCallContext } from '../lib/esm/utils/CallContext.js';

const NS = 'https://linked.cm/shape/qa-test/';
const Thing = NS + 'Thing';
const Person = NS + 'Person';
const Secret = NS + 'Secret';
const SubSecret = NS + 'SubSecret';
const Account = NS + 'Account';

const Cls = (name) => 'http://ex/class/' + name;
registerNodeShape({ id: Thing, targetClass: { id: Cls('Thing') }, propertyShapes: [{ id: Thing + '/name', label: 'name', path: { id: 'http://ex/name' } }] });
registerNodeShape({ id: Secret, targetClass: { id: Cls('Secret') }, propertyShapes: [{ id: Secret + '/token', label: 'token', path: { id: 'http://ex/token' } }] });
registerNodeShape({
  id: SubSecret,
  targetClass: { id: Cls('SubSecret') },
  extends: { id: Secret },
  propertyShapes: [{ id: SubSecret + '/extra', label: 'extra', path: { id: 'http://ex/extra' } }],
});
registerNodeShape({ id: Account, targetClass: { id: Cls('Account') }, extends: { id: Thing }, propertyShapes: [] });
registerNodeShape({
  id: Person,
  targetClass: { id: Cls('Person') },
  extends: { id: Thing },
  propertyShapes: [
    { id: Person + '/secret', label: 'secret', path: { id: 'http://ex/secret' }, valueShape: { id: Secret } },
    { id: Person + '/account', label: 'account', path: { id: 'http://ex/account' }, valueShape: { id: Account } },
    { id: Person + '/friends', label: 'friends', path: { id: 'http://ex/friend' }, valueShape: { id: Person } },
  ],
});

// Shape classes, so LinkedStorage can route these shapes the way it routes
// decorated ones (by class, through the prototype chain).
class ThingShape extends Shape {}
class PersonShape extends ThingShape {}
class AccountShape extends ThingShape {}
class SecretShape extends Shape {}
class SubSecretShape extends SecretShape {}
for (const [id, cls] of [
  [Thing, ThingShape],
  [Person, PersonShape],
  [Account, AccountShape],
  [Secret, SecretShape],
  [SubSecret, SubSecretShape],
]) {
  const nodeShape = getNodeShape({ id });
  addNodeShapeToShapeClass(nodeShape, cls);
  // what the decorator sets on a shape class
  Object.defineProperty(cls, 'shape', { value: nodeShape, configurable: true });
}

// IR as core's lower() produces it for these queries.
const scan = (shape) => ({ kind: 'select', root: { kind: 'shape_scan', shape, alias: 'a0' }, patterns: [], projection: [] });
// Person.select(p => p.name), `name` inherited from Thing
const selectName = {
  kind: 'select',
  root: { kind: 'shape_scan', shape: Person, alias: 'a0' },
  patterns: [],
  projection: [{ alias: 'a1', expression: { kind: 'property_expr', sourceAlias: 'a0', property: Thing + '/name' } }],
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

const originalWarn = console.warn;
let appStore;
beforeEach(() => {
  // a fresh, rule-less store for every test; the pins below are re-made too
  appStore = { name: 'app' };
  LinkedStorage.setDefaultDataset(appStore);
  for (const cls of [ThingShape, PersonShape, AccountShape, SecretShape, SubSecretShape]) {
    LinkedStorage.unsetDatasetForShape(cls);
  }
});
afterEach(() => {
  console.warn = originalWarn;
});
const quiet = () => {
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  return warnings;
};
const pin = (store, ...classes) => LinkedStorage.setDatasetForShapes(store, ...classes);
const check = (ctx, ir, operation = 'select', mode = 'enforce') =>
  runWithCallContext(ctx, () => checkQueryAccess({ operation, query: {}, ir, mode }));

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

describe('store access rules', () => {
  it('require a session when no rule is declared', async () => {
    assert.equal(await statusOf(check(signedIn, selectName)), 'ok');
    assert.equal(await statusOf(check(http(), selectName)), 401);
    assert.equal(await statusOf(check(signedIn, createNestedAccount, 'create')), 'ok');
    assert.equal(await statusOf(check(http(), createNestedAccount, 'create')), 401);
  });

  it('only warn about an anonymous read in warn mode, under the implicit default', async () => {
    const warnings = quiet();
    assert.equal(await statusOf(check(http(), selectName, 'select', 'warn')), 'ok');
    assert.ok(warnings.some((w) => w.includes('anonymous')));
    // mutations are refused in every mode
    assert.equal(await statusOf(check(http(), updateLinkAccount, 'update', 'warn')), 401);
    assert.equal(await statusOf(check(http(), deleteAccount, 'delete', 'warn')), 401);
    // a declared 'session' is enforced in warn mode too
    withAccess(appStore, { read: 'session' });
    assert.equal(await statusOf(check(http(), selectName, 'select', 'warn')), 401);
  });

  it("refuse with 'none', per operation", async () => {
    quiet();
    pin(withAccess({ name: 'secrets' }, { read: 'none', write: 'none' }), SecretShape);
    pin(withAccess({ name: 'accounts' }, { write: 'none' }), AccountShape);
    assert.equal(await statusOf(check(signedIn, scan(Secret))), 403);
    assert.equal(await statusOf(check(http(), scan(Secret), 'select', 'warn')), 403);
    assert.equal(await statusOf(check(signedIn, scan(Account))), 'ok');
    assert.equal(await statusOf(check(signedIn, deleteAccount, 'delete')), 403);
    // a sub shape routes to its super shape's store, and so gets its rule
    assert.equal(await statusOf(check(signedIn, scan(SubSecret))), 403);
  });

  it('let a function decide, with the query context', async () => {
    quiet();
    const seen = [];
    withAccess(appStore, {
      read: (ctx) => (seen.push(ctx), ctx.linkedAuth?.userAccount?.id === 'http://ex/me'),
      write: async () => false,
    });
    assert.equal(await statusOf(check(signedIn, selectName)), 'ok');
    assert.equal(seen[0].operation, 'select');
    assert.equal(seen[0].store, appStore);
    assert.equal(seen[0].ir, selectName);
    assert.ok(seen[0].shapes.has(Person));
    assert.ok(seen[0].propertyShapes.has(Thing + '/name'));
    assert.equal(await statusOf(check(http({ userAccount: { id: 'http://ex/other' } }), selectName)), 403);
    // false without a session is a 401
    assert.equal(await statusOf(check(http(), selectName)), 401);
    assert.equal(await statusOf(check(signedIn, updateLinkAccount, 'update')), 403);
    // a function may admit a caller without a session
    withAccess(appStore, { read: () => true });
    assert.equal(await statusOf(check(http(), selectName)), 'ok');
    assert.deepEqual(Object.keys(getStoreAccess(appStore)).sort(), ['read', 'write']);
  });

  it('pass on a status a function throws, and refuse on any other failure', async () => {
    quiet();
    withAccess(appStore, {
      read: () => {
        throw Object.assign(new Error('gone'), { name: 'ServerCallError', status: 410 });
      },
      write: () => {
        throw new Error('boom');
      },
    });
    assert.equal(await statusOf(check(signedIn, selectName)), 410);
    assert.equal(await statusOf(check(signedIn, updateLinkAccount, 'update')), 403);
  });

  it('must all be satisfied when a query maps to several stores', async () => {
    quiet();
    withAccess(appStore, { read: () => true });
    pin(withAccess({ name: 'secrets' }, { read: 'none' }), SecretShape);
    pin(withAccess({ name: 'accounts' }, { read: 'session', write: 'none' }), AccountShape);
    assert.equal(await statusOf(check(http(), selectName)), 'ok');
    // traversed into, and cast to a sub shape
    assert.equal(await statusOf(check(signedIn, selectNested)), 403);
    assert.equal(await statusOf(check(signedIn, selectCast)), 403);
    // a reference to an account maps the write to the accounts store too
    assert.equal(await statusOf(check(signedIn, updateLinkAccount, 'update')), 403);
    assert.equal(await statusOf(check(signedIn, createNestedAccount, 'create')), 403);
  });

  it('ignore a super shape that only owns an inherited property', async () => {
    quiet();
    pin(withAccess({ name: 'things' }, { read: 'none' }), ThingShape);
    pin({ name: 'people' }, PersonShape);
    // Person.name is owned by Thing, but the query runs on Person's store
    assert.equal(await statusOf(check(signedIn, selectName)), 'ok');
    // rooted at the super shape, its store decides
    assert.equal(await statusOf(check(signedIn, scan(Thing))), 403);
  });

  it('do not apply outside an http call (provider-internal queries)', async () => {
    pin(withAccess({ name: 'secrets' }, { read: 'none', write: 'none' }), SecretShape);
    const run = () => checkQueryAccess({ operation: 'select', query: {}, ir: scan(Secret), mode: 'enforce' });
    assert.equal(await statusOf(run()), 'ok');
    assert.equal(await statusOf(runAsSystem(run)), 'ok');
  });

  it('are validated when declared', () => {
    assert.throws(() => withAccess({}, { read: 'public' }), TypeError);
    assert.throws(() => withAccess(null, {}), TypeError);
    assert.equal(getStoreAccess({}), undefined);
  });
});

describe('checkQueryAccess', () => {
  it('refuses a query that could not be analysed, in every mode', async () => {
    quiet();
    assert.equal(await statusOf(check(signedIn, undefined, 'select', 'warn')), 400);
    assert.equal(await statusOf(check(signedIn, undefined, 'select', 'enforce')), 400);
  });

  it('refuses an operation that does not match the query kind', async () => {
    quiet();
    assert.equal(await statusOf(check(signedIn, deleteAccount, 'select')), 400);
    assert.equal(await statusOf(check(signedIn, selectName, 'delete')), 400);
    assert.equal(await statusOf(check(signedIn, createNestedAccount, 'update')), 400);
    assert.equal(await statusOf(check(signedIn, { kind: 'count', root: selectName.root }, 'select')), 'ok');
    assert.equal(await statusOf(check(signedIn, { kind: 'delete_all', shape: Person }, 'delete')), 'ok');
  });

  it('refuses a mutation that chooses the ids of new nodes', async () => {
    quiet();
    const createWithId = { kind: 'create', shape: Person, data: { shape: Person, id: 'http://ex/chosen', fields: [] } };
    assert.equal(await statusOf(check(signedIn, createWithId, 'create')), 403);
    const nested = {
      ...updateLinkAccount,
      data: { shape: Person, fields: [{ property: Person + '/account', value: { shape: Account, id: 'http://ex/acc9', fields: [] } }] },
    };
    assert.equal(await statusOf(check(signedIn, nested, 'update')), 403);
    assert.equal(await statusOf(check(signedIn, updateLinkAccount, 'update')), 'ok');
  });
});

describe('collectClientIds', () => {
  it('names created and nested node data, not references or update targets', () => {
    const nested = { shape: Account, id: 'http://ex/nested', fields: [] };
    assert.deepEqual(
      collectClientIds({ kind: 'create', data: { shape: Person, fields: [{ property: Person + '/account', value: [nested, { id: 'http://ex/ref' }] }] } }),
      ['http://ex/nested']
    );
    assert.deepEqual(collectClientIds({ ...updateLinkAccount, data: { ...updateLinkAccount.data, id: 'http://ex/p1' } }), []);
    assert.deepEqual(collectClientIds(deleteAccount), []);
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
