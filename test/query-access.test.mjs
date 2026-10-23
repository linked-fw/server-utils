// Runs against the build output: `npm run build && npm test`.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addNodeShapeToShapeClass,
  getNodeShape,
  registerNodeShape,
} from '@_linked/core/utils/ShapeClass';
import { Shape } from '@_linked/core/shapes/Shape';
import { ShapeCatalog } from '@_linked/core/utils/ShapeCatalog';
import { setOntologyHierarchy } from '@_linked/core/ontology/classHierarchy';
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

describe('bulk mutations', () => {
  // Thing ← Person, Account (Person and Account extend Thing); Secret ← SubSecret
  const deleteAll = (shape) => ({ kind: 'delete_all', shape });
  const deleteWhere = (shape) => ({
    kind: 'delete_where',
    shape,
    where: { kind: 'binary_expr', operator: '=', left: { kind: 'property_expr', sourceAlias: 'a0', property: Thing + '/name' }, right: { kind: 'literal_expr', value: 'x' } },
    wherePatterns: [],
  });
  const updateWhere = (shape) => ({
    kind: 'update_where',
    shape,
    data: { shape, fields: [{ property: Thing + '/name', value: 'y' }] },
  });
  const statusAndMessage = async (p) => {
    try {
      await p;
      return ['ok'];
    } catch (e) {
      return [e?.status ?? -1, e?.message];
    }
  };

  it('are refused for a caller not allowed on a sub-shape', async () => {
    quiet();
    pin(withAccess({ name: 'people' }, { write: 'none' }), PersonShape);
    assert.equal(await statusOf(check(signedIn, deleteAll(Thing), 'delete')), 403);
    assert.equal(await statusOf(check(signedIn, deleteWhere(Thing), 'delete')), 403);
    assert.equal(await statusOf(check(signedIn, updateWhere(Thing), 'update')), 403);
    // without a session the 401 comes first
    assert.equal(await statusOf(check(http(), deleteAll(Thing), 'delete')), 401);
  });

  it('let a function rule see the sub-shapes', async () => {
    quiet();
    const seen = [];
    withAccess(appStore, { write: (ctx) => (seen.push(ctx), !ctx.shapes.has(Person)) });
    for (const [ir, operation] of [
      [deleteAll(Thing), 'delete'],
      [deleteWhere(Thing), 'delete'],
      [updateWhere(Thing), 'update'],
    ]) {
      seen.length = 0;
      assert.equal(await statusOf(check(signedIn, ir, operation)), 403, ir.kind);
      assert.equal(seen.length, 1, ir.kind);
      for (const shape of [Thing, Person, Account]) assert.ok(seen[0].shapes.has(shape), `${ir.kind} ${shape}`);
      assert.ok(!seen[0].shapes.has(Secret), ir.kind);
    }
    // a leaf root reaches no other shape
    seen.length = 0;
    assert.equal(await statusOf(check(signedIn, deleteAll(Account), 'delete')), 'ok');
    assert.ok(!seen[0].shapes.has(Person));
  });

  it('are refused, not half-applied, when the sub-shapes live in another store', async () => {
    quiet();
    pin({ name: 'people' }, PersonShape);
    for (const [ir, operation] of [
      [deleteAll(Thing), 'delete'],
      [deleteWhere(Thing), 'delete'],
      [updateWhere(Thing), 'update'],
    ]) {
      const [status, message] = await statusAndMessage(check(signedIn, ir, operation));
      assert.equal(status, 409, ir.kind);
      assert.ok(message.startsWith('bulk-mutation-spans-stores: '), message);
      assert.ok(message.includes(Thing) && message.includes(Person), message);
    }
    // one store object per group counts, even with no rule on either
    LinkedStorage.unsetDatasetForShape(PersonShape);
    assert.equal(await statusOf(check(signedIn, deleteAll(Thing), 'delete')), 'ok');
  });

  it("ask a function rule on a sub-shape's own store", async () => {
    quiet();
    const seen = [];
    const people = withAccess({ name: 'people' }, { write: (ctx) => (seen.push(ctx), false) });
    pin(people, PersonShape);
    assert.equal(await statusOf(check(signedIn, deleteAll(Thing), 'delete')), 403);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].store, people);
    assert.ok(seen[0].shapes.has(Person));
  });

  it('check the access rules before the span', async () => {
    quiet();
    pin(withAccess({ name: 'people' }, { write: 'none' }), PersonShape);
    assert.equal(await statusOf(check(signedIn, deleteAll(Thing), 'delete')), 403);
  });

  it('leave a leaf shape as it was', async () => {
    quiet();
    pin(withAccess({ name: 'things' }, { write: 'none' }), ThingShape);
    pin({ name: 'people' }, PersonShape);
    // Person's own store decides; Thing's store is not reached
    assert.equal(await statusOf(check(signedIn, deleteAll(Person), 'delete')), 'ok');
    assert.equal(await statusOf(check(signedIn, deleteWhere(Person), 'delete')), 'ok');
    assert.equal(await statusOf(check(signedIn, deleteAll(Secret), 'delete')), 'ok');
  });

  it('follow the ontology hierarchy, not only the shape tree', async () => {
    quiet();
    pin(withAccess({ name: 'secrets' }, { write: 'none' }), SecretShape);
    assert.equal(await statusOf(check(signedIn, deleteAll(Thing), 'delete')), 'ok');
    setOntologyHierarchy([{ s: Cls('Secret'), o: Cls('Thing') }]);
    try {
      assert.equal(await statusOf(check(signedIn, deleteAll(Thing), 'delete')), 403);
      withAccess(LinkedStorage.getDatasetForShapeClass(SecretShape), {});
      const [status, message] = await statusAndMessage(check(signedIn, deleteAll(Thing), 'delete'));
      assert.equal(status, 409);
      assert.ok(message.includes(SubSecret), message);
    } finally {
      setOntologyHierarchy([]);
    }
  });

  it("resolve the sub-shapes in the query's shape catalog", async () => {
    quiet();
    const C = NS + 'cat/';
    const catalog = ShapeCatalog.from([
      { id: C + 'Item', targetClass: { id: Cls('CatItem') }, propertyShapes: [] },
      { id: C + 'Gadget', targetClass: { id: Cls('CatGadget') }, extends: { id: C + 'Item' }, propertyShapes: [] },
    ]);
    const ir = deleteAll(C + 'Item');
    Object.defineProperty(ir, 'catalog', { value: catalog, enumerable: false });
    const seen = [];
    withAccess(appStore, { write: (ctx) => (seen.push(ctx), true) });
    assert.equal(await statusOf(check(signedIn, ir, 'delete')), 'ok');
    assert.ok(seen[0].shapes.has(C + 'Gadget'));
    assert.ok(!seen[0].shapes.has(Person));
  });

  it('do not change selects and counts over a super shape', async () => {
    quiet();
    pin(withAccess({ name: 'people' }, { read: 'none' }), PersonShape);
    assert.equal(await statusOf(check(signedIn, scan(Thing))), 'ok');
    assert.equal(await statusOf(check(signedIn, { kind: 'count', root: scan(Thing).root })), 'ok');
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

describe('graph queries', () => {
  // record shapes, as core's NamedGraph and OntologyGraph: the sub-shape's
  // class extends the super shape's, so a pin of the super shape covers it
  const GraphRecord = NS + 'GraphRecord';
  const SubGraphRecord = NS + 'SubGraphRecord';
  registerNodeShape({ id: GraphRecord, targetClass: { id: Cls('GraphRecord') }, propertyShapes: [] });
  registerNodeShape({ id: SubGraphRecord, targetClass: { id: Cls('SubGraphRecord') }, extends: { id: GraphRecord }, propertyShapes: [] });
  class GraphRecordShape extends Shape {}
  class SubGraphRecordShape extends GraphRecordShape {}
  for (const [id, cls] of [
    [GraphRecord, GraphRecordShape],
    [SubGraphRecord, SubGraphRecordShape],
  ]) {
    const nodeShape = getNodeShape({ id });
    addNodeShapeToShapeClass(nodeShape, cls);
    Object.defineProperty(cls, 'shape', { value: nodeShape, configurable: true });
  }

  const G = 'https://linked.cm/pkg/qa-test/graph/ontology';
  const KINDS = ['graph_create', 'graph_replace', 'graph_patch', 'graph_drop'];
  const gq = (kind = 'graph_replace', recordClass = Cls('SubGraphRecord'), graph = G) => ({
    kind,
    graph,
    recordClass,
    ...(kind === 'graph_patch' ? { patch: { insert: { mediaType: 'text/turtle', text: '' } } } : {}),
    ...(kind === 'graph_create' || kind === 'graph_replace' ? { content: { mediaType: 'text/turtle', text: '' } } : {}),
  });
  const graphCheck = (ctx, ir, operation = 'graph', mode = 'enforce') =>
    runWithCallContext(ctx, () => checkQueryAccess({ operation, query: { sent: true }, ir, mode, endpoint: 'graphQuery' }));

  beforeEach(() => {
    LinkedStorage.unsetDatasetForShape(GraphRecordShape);
    LinkedStorage.unsetDatasetForShape(SubGraphRecordShape);
  });

  for (const mode of ['warn', 'enforce']) {
    it(`are refused without a graph rule, session or not (${mode})`, async () => {
      quiet();
      for (const kind of KINDS) {
        assert.equal(await statusOf(graphCheck(signedIn, gq(kind), 'graph', mode)), 403);
        assert.equal(await statusOf(graphCheck(http(), gq(kind), 'graph', mode)), 403);
      }
    });
  }

  it("are refused by a graph rule 'none'", async () => {
    quiet();
    withAccess(appStore, { graph: 'none' });
    assert.equal(await statusOf(graphCheck(signedIn, gq())), 403);
  });

  it('are not decided by read or write rules', async () => {
    quiet();
    withAccess(appStore, { read: () => true, write: () => true });
    assert.equal(await statusOf(graphCheck(signedIn, gq())), 403);
    withAccess(appStore, { read: 'session', write: 'session' });
    assert.equal(await statusOf(graphCheck(signedIn, gq())), 403);
  });

  it('are allowed by a graph rule that admits them, for every kind', async () => {
    withAccess(appStore, { graph: () => true });
    for (const kind of KINDS) {
      assert.equal(await statusOf(graphCheck(signedIn, gq(kind))), 'ok');
    }
  });

  it('give the rule the caller, the graph, the kind and the record class', async () => {
    const seen = [];
    withAccess(appStore, { graph: (ctx) => (seen.push(ctx), true) });
    const ir = gq('graph_drop');
    assert.equal(await statusOf(graphCheck(signedIn, ir)), 'ok');
    assert.equal(seen.length, 1);
    const ctx = seen[0];
    assert.equal(ctx.operation, 'graph');
    assert.equal(ctx.kind, 'graph_drop');
    assert.equal(ctx.graph, G);
    assert.equal(ctx.recordClass, Cls('SubGraphRecord'));
    assert.equal(ctx.store, appStore);
    assert.deepEqual(ctx.linkedAuth, { userAccount: { id: 'http://ex/me' } });
    assert.equal(ctx.request.linkedAuth, ctx.linkedAuth);
    assert.deepEqual(ctx.query, { sent: true });
    assert.equal(ctx.ir, ir);
  });

  it('let the rule decide by record class', async () => {
    quiet();
    withAccess(appStore, { graph: (ctx) => ctx.recordClass === Cls('SubGraphRecord') });
    assert.equal(await statusOf(graphCheck(signedIn, gq('graph_replace', Cls('SubGraphRecord')))), 'ok');
    assert.equal(await statusOf(graphCheck(signedIn, gq('graph_replace', Cls('GraphRecord')))), 403);
  });

  it('are refused when the rule refuses: 403, or 401 without a session', async () => {
    quiet();
    withAccess(appStore, { graph: async () => false });
    assert.equal(await statusOf(graphCheck(signedIn, gq())), 403);
    assert.equal(await statusOf(graphCheck(http(), gq())), 401);
  });

  it('pass a ServerCallError the rule throws, and refuse on any other error', async () => {
    quiet();
    withAccess(appStore, {
      graph: () => {
        throw Object.assign(new Error('busy'), { name: 'ServerCallError', status: 409 });
      },
    });
    assert.equal(await statusOf(graphCheck(signedIn, gq())), 409);
    withAccess(appStore, {
      graph: () => {
        throw new Error('boom');
      },
    });
    assert.equal(await statusOf(graphCheck(signedIn, gq())), 403);
  });

  it('ask the store the record shape routes to, through a pin of its super shape', async () => {
    quiet();
    const graphStore = { name: 'graphs' };
    const asked = [];
    pin(graphStore, GraphRecordShape);
    withAccess(appStore, { graph: () => (asked.push('app'), true) });
    withAccess(graphStore, { graph: (ctx) => (asked.push(ctx.store === graphStore ? 'graphs' : '?'), false) });
    assert.equal(await statusOf(graphCheck(signedIn, gq('graph_replace', Cls('SubGraphRecord')))), 403);
    assert.deepEqual(asked, ['graphs']);
  });

  it('ask the default store for a record class no shape targets', async () => {
    const asked = [];
    pin({ name: 'graphs' }, GraphRecordShape);
    withAccess(appStore, { graph: (ctx) => (asked.push(ctx.store), true) });
    assert.equal(await statusOf(graphCheck(signedIn, gq('graph_replace', 'http://ex/class/Unknown'))), 'ok');
    assert.deepEqual(asked, [appStore]);
  });

  it('are refused (400) on any other endpoint', async () => {
    quiet();
    withAccess(appStore, { read: () => true, write: () => true, graph: () => true });
    for (const operation of ['select', 'ask', 'create', 'update', 'delete']) {
      for (const kind of KINDS) {
        assert.equal(await statusOf(graphCheck(signedIn, gq(kind), operation)), 400, `${kind} on ${operation}`);
      }
    }
  });

  it('refuse (400) a shape query on the graph endpoint', async () => {
    quiet();
    withAccess(appStore, { read: () => true, write: () => true, graph: () => true });
    assert.equal(await statusOf(graphCheck(signedIn, scan(Thing))), 400);
    assert.equal(await statusOf(graphCheck(signedIn, deleteAccount)), 400);
  });

  it('refuse (400) a graph query without a graph or a record class, or that could not be read', async () => {
    quiet();
    withAccess(appStore, { graph: () => true });
    assert.equal(await statusOf(graphCheck(signedIn, { kind: 'graph_drop', recordClass: Cls('GraphRecord') })), 400);
    assert.equal(await statusOf(graphCheck(signedIn, { kind: 'graph_drop', graph: G })), 400);
    assert.equal(await statusOf(graphCheck(signedIn, { kind: 'graph_drop', graph: '', recordClass: Cls('GraphRecord') })), 400);
    assert.equal(await statusOf(graphCheck(signedIn, { kind: 'graph_drop', graph: G, recordClass: 7 })), 400);
    assert.equal(await statusOf(graphCheck(signedIn, undefined)), 400);
    assert.equal(await statusOf(graphCheck(http(), undefined)), 401);
  });

  it('are not checked outside a request', async () => {
    assert.equal(
      await statusOf(runAsSystem(() => checkQueryAccess({ operation: 'graph', query: {}, ir: gq(), mode: 'enforce' }))),
      'ok'
    );
  });

  it("withAccess takes a graph rule 'none' or a function, never 'session'", () => {
    const store = {};
    const rule = () => true;
    withAccess(store, { graph: rule });
    assert.equal(getStoreAccess(store).graph, rule);
    withAccess(store, { graph: 'none' });
    assert.equal(getStoreAccess(store).graph, 'none');
    assert.throws(() => withAccess(store, { graph: 'session' }), TypeError);
    assert.throws(() => withAccess(store, { graph: true }), TypeError);
  });
});
