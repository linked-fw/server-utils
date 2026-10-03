/**
 * Who may run which query through the generic query plane.
 *
 * INTERIM ACCESS MODEL. This needs to be revised and rethought from the ground
 * up. Rules attach to whole stores and answer per operation (read or write),
 * which is coarse: a store a caller may write can be written anywhere, and the
 * rule cannot see what the query will match. It replaced the protected-shape
 * registry, query authorizers and protected-node probe because it is simpler to
 * declare and to reason about, not because it is the model we want to keep.
 *
 * The generic plane is the set of server endpoints that run a query the client
 * built (`/call/@_linked/server/*Query` and the `LincdAPI` `/api/*` routes).
 * Queries backend code runs itself (in a provider, through `LinkedStorage`)
 * never pass through here and are not affected by any rule.
 *
 * Rules are declared in the storage config (the app's
 * `linked.backend.storage.js`), on the stores it routes shapes to:
 *
 * ```js
 * const credentials = withAccess(new FusekiStore({endpoint}), {read: 'none', write: 'none'});
 * LinkedStorage.setDatasetForShapes(credentials, Password, RefreshToken);
 * ```
 *
 * - A rule is `'none'` (refused, 403), `'session'` (any signed-in session; 401
 *   without one) or a function that decides (`true` admits, `false` refuses;
 *   it may also throw a `ServerCallError` with its own status).
 * - A store without a rule, or without a rule for the operation, is
 *   `'session'`.
 * - Reads (`select`, `ask`) use `read`; mutations (`create`, `update`,
 *   `delete`) use `write`.
 * - A query is mapped to stores through the same shape→store routing
 *   `LinkedStorage` uses to run it: its root shape, every shape it writes, and
 *   every other shape it touches (traverses into, casts to, owns a property it
 *   uses), except a shape that only stands in as the super shape of another one
 *   in the query (the owner of an inherited property such as `name`). It must
 *   satisfy the rule of every store it maps to.
 * - Raw SPARQL (`/api/select-raw`) cannot be analysed, so store rules do not
 *   apply to it. The server's `rawQueries` setting decides instead: `'session'`
 *   (the default) runs it for any signed-in session, `'off'` refuses it.
 *
 * Rules live in a `WeakMap` keyed by the store object, held on `globalThis` so
 * duplicate copies of this module share it.
 */
import {
  getAllNodeShapes,
  getShapeClass,
  getSuperShapes,
  getRegistryVersion,
} from '@_linked/core/utils/ShapeClass';
import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import { getCallContext } from './CallContext.js';
import { ServerCallError } from './ServerCallError.js';

export type QueryOperation = 'select' | 'ask' | 'create' | 'update' | 'delete';

export interface QueryAccessContext {
  operation: QueryOperation;
  /** The query as the client sent it (DSL-JSON or a rehydrated builder). */
  query: unknown;
  /** The lowered IR of the query. */
  ir: unknown;
  /** Every node shape the query touches: scanned, written, traversed into, or owning a property it uses. */
  shapes: ReadonlySet<string>;
  /** Every property shape the query uses. */
  propertyShapes: ReadonlySet<string>;
  /** The store whose rule is being asked. */
  store: unknown;
  request: any;
  linkedAuth: any;
}

/** `true` admits the query, `false` refuses it (403, or 401 without a session). */
export type AccessFunction = (ctx: QueryAccessContext) => boolean | Promise<boolean>;

export type AccessRule = 'none' | 'session' | AccessFunction;

export interface StoreAccess {
  /** `select` and `ask`. Default `'session'`. */
  read?: AccessRule;
  /** `create`, `update` and `delete`. Default `'session'`. */
  write?: AccessRule;
}

/**
 * Who may run raw SPARQL on the generic plane: `'session'` any signed-in
 * session, `'off'` nobody.
 */
export type RawQueriesMode = 'off' | 'session';

const REGISTRY_KEY = Symbol.for('@_linked/server-utils:storeAccess');

function registry(): WeakMap<object, StoreAccess> {
  const g = globalThis as any;
  if (!g[REGISTRY_KEY]) {
    Object.defineProperty(g, REGISTRY_KEY, {
      value: new WeakMap<object, StoreAccess>(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return g[REGISTRY_KEY];
}

function assertRule(rule: unknown, name: string): asserts rule is AccessRule | undefined {
  if (rule === undefined || rule === 'none' || rule === 'session' || typeof rule === 'function') return;
  throw new TypeError(
    `withAccess: ${name} must be 'none', 'session' or a function, got ${JSON.stringify(rule)}`
  );
}

/**
 * Declare who may query `store` through the generic query plane, and return
 * the store (so it can wrap the store where the storage config creates it).
 * Declaring again replaces the earlier rule.
 *
 * Two groups of shapes that need different rules need two store objects. They
 * may point at the same dataset, but then a store a caller may write can write
 * the other group's nodes in that dataset too (by id): give a store write
 * access only when everything in its dataset may be written that way.
 */
export function withAccess<T extends object>(store: T, access: StoreAccess): T {
  if (!store || (typeof store !== 'object' && typeof store !== 'function')) {
    throw new TypeError('withAccess: expected a store');
  }
  if (!access || typeof access !== 'object') {
    throw new TypeError('withAccess: expected {read, write}');
  }
  assertRule(access.read, 'read');
  assertRule(access.write, 'write');
  registry().set(store, { read: access.read, write: access.write });
  return store;
}

/** The rule declared for a store with `withAccess`, if any. */
export function getStoreAccess(store: unknown): StoreAccess | undefined {
  if (!store || (typeof store !== 'object' && typeof store !== 'function')) return undefined;
  return registry().get(store as object);
}

// property-shape IRI -> {owner node shape, value node shape}
let propertyIndex: Map<string, { owner: string; value?: string }> | undefined;
let propertyIndexVersion = -1;

function getPropertyIndex() {
  const version = getRegistryVersion();
  if (!propertyIndex || version !== propertyIndexVersion) {
    propertyIndex = new Map();
    for (const [nodeShapeId, nodeShape] of getAllNodeShapes()) {
      for (const ps of nodeShape?.propertyShapes ?? []) {
        if (!ps?.id) continue;
        propertyIndex.set(ps.id, {
          owner: ps.parentNodeShape?.id ?? nodeShapeId,
          value: ps.valueShape?.id,
        });
      }
    }
    propertyIndexVersion = version;
  }
  return propertyIndex;
}

export interface QueryTargets {
  /** Every node shape the query touches. */
  shapes: Set<string>;
  /** Node shapes the query writes: the mutation's shape, nested node data, and the owners of written fields. */
  writtenShapes: Set<string>;
  propertyShapes: Set<string>;
}

/**
 * Collect the shapes and property shapes an IR touches.
 *
 * Walks the whole IR: every `shape` id is a scanned or written shape, every
 * `property` id a property shape, which is mapped to the shape that owns it and,
 * when it has one, the shape of its values. A cast (`p.friends.as(X).field`)
 * shows up as a property owned by `X`, so it is caught too.
 */
export function collectQueryTargets(ir: unknown): QueryTargets {
  const shapes = new Set<string>();
  const writtenShapes = new Set<string>();
  const propertyShapes = new Set<string>();
  const index = getPropertyIndex();
  const seen = new Set<object>();
  const isMutation =
    !!ir &&
    typeof ir === 'object' &&
    typeof (ir as any).kind === 'string' &&
    !['select', 'ask', 'count'].includes((ir as any).kind);

  const addProperty = (id: string, written: boolean) => {
    propertyShapes.add(id);
    let entry = index.get(id);
    if (!entry) {
      // Property shapes are named `<node shape>/<label>`. Only trust that when
      // the prefix is itself a registered node shape.
      const cut = id.lastIndexOf('/');
      const owner = cut > 0 ? id.substring(0, cut) : undefined;
      if (owner && getAllNodeShapes().has(owner)) entry = { owner };
    }
    if (entry) {
      shapes.add(entry.owner);
      if (written) writtenShapes.add(entry.owner);
      if (entry.value) shapes.add(entry.value);
    }
  };

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    // node data of a mutation: {shape, fields: [{property, value}]}
    const isNodeData = isMutation && Array.isArray(obj.fields) && typeof obj.shape === 'string';
    if (typeof obj.shape === 'string') {
      shapes.add(obj.shape);
      if (isNodeData || (obj === ir && isMutation)) writtenShapes.add(obj.shape);
    }
    if (typeof obj.property === 'string') {
      addProperty(obj.property, false);
    }
    for (const key of Object.keys(obj)) {
      if (key === 'fields' && isNodeData) {
        for (const field of obj.fields as any[]) {
          if (field && typeof field.property === 'string') {
            addProperty(field.property, true);
          }
          walk(field?.value);
        }
        continue;
      }
      walk(obj[key]);
    }
  };
  walk(ir);
  return { shapes, writtenShapes, propertyShapes };
}

/**
 * Ids the client chose for nodes a mutation writes as node data (`{__id, ...}`):
 * the created node, and nested node data in a create or an update. The server
 * assigns those ids; a client-chosen one could address an existing node.
 */
export function collectClientIds(ir: any): string[] {
  const ids = new Set<string>();
  if (!ir || typeof ir !== 'object') return [];
  const seen = new Set<object>();

  const walkValue = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) walkValue(item);
      return;
    }
    const obj = value as Record<string, any>;
    if (Array.isArray(obj.fields) && typeof obj.shape === 'string') {
      walkNodeData(obj);
      return;
    }
    for (const key of Object.keys(obj)) walkValue(obj[key]);
  };

  const walkNodeData = (data: any) => {
    if (!data || typeof data !== 'object') return;
    if (typeof data.id === 'string' && data.id) ids.add(data.id);
    for (const field of Array.isArray(data.fields) ? data.fields : []) {
      walkValue(field?.value);
    }
  };

  switch (ir.kind) {
    case 'create':
      walkNodeData(ir.data);
      break;
    case 'update':
    case 'upsert':
    case 'update_where':
      // the target of an update is named by id; only nested node data counts
      walkNodeData({ ...ir.data, id: undefined });
      break;
  }
  return [...ids];
}

const warnedQueryAccess = new Set<string>();

function warnOnce(key: string, message: string) {
  if (warnedQueryAccess.has(key)) return;
  warnedQueryAccess.add(key);
  console.warn(message);
}

/** The IR kinds each generic-plane operation may carry. */
const KINDS_BY_OPERATION: Record<QueryOperation, ReadonlySet<string>> = {
  select: new Set(['select', 'count']),
  ask: new Set(['ask']),
  create: new Set(['create']),
  update: new Set(['update', 'upsert', 'update_where']),
  delete: new Set(['delete', 'delete_all', 'delete_where']),
};

const MUTATIONS: ReadonlySet<QueryOperation> = new Set(['create', 'update', 'delete']);

/** The store `LinkedStorage` routes a node shape to (its default when unpinned). */
function storeForShape(shapeId: string): unknown {
  let shapeClass: Function | undefined;
  try {
    shapeClass = getShapeClass(shapeId as any) as any;
  } catch {
    shapeClass = undefined;
  }
  return LinkedStorage.getDatasetForShapeClass(shapeClass);
}

function superShapeIds(shapeId: string): string[] {
  try {
    return (getSuperShapes(shapeId) ?? []).map((s: any) => s?.id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The shapes whose stores decide a query: the root, every written shape, and
 * every other touched shape that is not a super shape of another one in the
 * query (those only own inherited properties).
 */
export function deciderShapes(ir: any, targets: QueryTargets): Set<string> {
  const ancestors = new Set<string>();
  for (const shape of targets.shapes) {
    for (const id of superShapeIds(shape)) ancestors.add(id);
  }
  const deciders = new Set<string>();
  const root = ir?.root?.shape ?? ir?.shape;
  if (typeof root === 'string') deciders.add(root);
  for (const shape of targets.writtenShapes) deciders.add(shape);
  for (const shape of targets.shapes) {
    if (!ancestors.has(shape)) deciders.add(shape);
  }
  return deciders;
}

export interface CheckQueryAccessOptions {
  operation: QueryOperation;
  query: unknown;
  /**
   * The lowered IR. `undefined` when the query could not be analysed: refused
   * (400), unless `raw` is set.
   */
  ir: unknown;
  /** A raw SPARQL query (`query` is its text); see `rawQueries`. */
  raw?: boolean;
  /**
   * Who may run a raw query: `'session'` (the default) any signed-in session,
   * `'off'` nobody. The server passes its `rawQueries` setting.
   */
  rawQueries?: RawQueriesMode;
  /**
   * `'warn'` only logs an anonymous read that no declared rule covers (the
   * implicit `'session'` default); `'enforce'` refuses it. Declared rules and
   * mutations are enforced in both modes.
   */
  mode: 'warn' | 'enforce';
  /** Used in log lines. */
  endpoint?: string;
}

function refuse(status: number, message: string, log?: string): never {
  if (log) console.warn(log);
  throw new ServerCallError(status, message);
}

/**
 * Apply the store rules to a query about to run on the generic plane.
 *
 * Only a call with an HTTP context is checked; system work and
 * backend-to-backend calls made outside a request are trusted. (The server
 * enters an HTTP context for every request it receives.) Order:
 *
 * 1. the operation must match the query's kind (400 otherwise);
 * 2. raw SPARQL → refused (403) when `rawQueries` is `'off'`; otherwise it
 *    needs a session (401 without one, in every mode), and nothing below
 *    applies;
 * 3. a query that could not be analysed → 400;
 * 4. the rule of every store the query maps to (see the module comment);
 * 5. a mutation that chooses the ids of new nodes → 403.
 */
export async function checkQueryAccess(o: CheckQueryAccessOptions): Promise<void> {
  const ctx = getCallContext();
  if (!ctx || ctx.kind !== 'http') return;
  const request = ctx.request;
  const linkedAuth = request?.linkedAuth;
  const hasSession = !!linkedAuth?.userAccount;
  const endpoint = o.endpoint ?? o.operation;
  const isMutation = MUTATIONS.has(o.operation);

  if (!o.raw && o.ir !== undefined) {
    const kind = (o.ir as any)?.kind;
    if (!KINDS_BY_OPERATION[o.operation]?.has(kind)) {
      refuse(
        400,
        'Query kind does not match the endpoint',
        `[linked] refused ${endpoint}: it carries a ${JSON.stringify(String(kind)).slice(0, 40)} query`
      );
    }
  }

  if (o.raw) {
    // anything but 'session' (a typo included) refuses
    if ((o.rawQueries ?? 'session') !== 'session') {
      warnOnce(
        'raw:' + endpoint,
        `[linked] refused ${endpoint}: raw SPARQL is turned off (rawQueries: 'off').`
      );
      refuse(403, 'Query not permitted');
    }
    if (!hasSession) {
      refuse(401, 'Authentication required');
    }
    return;
  }

  if (o.ir === undefined) {
    if (!hasSession) refuse(401, 'Authentication required');
    refuse(400, 'Query could not be analysed');
  }

  const targets = collectQueryTargets(o.ir);
  const stores = new Map<unknown, string>();
  for (const shape of deciderShapes(o.ir, targets)) {
    const store = storeForShape(shape);
    if (!stores.has(store)) stores.set(store, shape);
  }
  if (stores.size === 0) stores.set(LinkedStorage.getDefaultDataset(), '(default)');

  for (const [store, shape] of stores) {
    const access = getStoreAccess(store);
    const declared = isMutation ? access?.write : access?.read;
    const rule: AccessRule = declared ?? 'session';
    if (rule === 'none') {
      refuse(403, 'Query not permitted', `[linked] refused ${endpoint}: the store of ${shape} does not allow it`);
    }
    if (rule === 'session') {
      if (hasSession) continue;
      if (!isMutation && declared === undefined && o.mode !== 'enforce') {
        warnOnce(
          'anon:' + endpoint,
          `[linked] anonymous ${endpoint} on the generic query plane. ` +
            `This is refused (401) once rpcExposure is 'enforce'.`
        );
        continue;
      }
      refuse(401, 'Authentication required');
    }
    let allowed: boolean;
    try {
      allowed = await (rule as AccessFunction)({
        operation: o.operation,
        query: o.query,
        ir: o.ir,
        shapes: targets.shapes,
        propertyShapes: targets.propertyShapes,
        store,
        request,
        linkedAuth,
      });
    } catch (err) {
      if (ServerCallError.is(err)) throw err;
      refuse(
        403,
        'Query not permitted',
        `[linked] refused ${endpoint}: the access rule for ${shape} failed: ${(err as any)?.message ?? err}`
      );
    }
    if (allowed !== true) {
      if (!hasSession) refuse(401, 'Authentication required');
      refuse(403, 'Query not permitted', `[linked] refused ${endpoint}: the access rule for ${shape} refused it`);
    }
  }

  if (isMutation && collectClientIds(o.ir).length > 0) {
    refuse(
      403,
      'Query not permitted: the server assigns the ids of new nodes',
      `[linked] refused ${endpoint}: it chooses the id of a new node`
    );
  }
}
