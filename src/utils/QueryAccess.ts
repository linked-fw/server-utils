/**
 * Who may run which query through the generic query plane.
 *
 * The generic plane is the set of server endpoints that run a query the client
 * built (`/call/@_linked/server/*Query` and the `LincdAPI` `/api/*` routes). This
 * module holds the rules for it; the server enforces them.
 *
 * - `registerProtectedShapes(shapes, {deny, owner})`: a shape (or any shape that
 *   extends it) that the generic plane must not touch at all (`'all'`, e.g.
 *   credentials) or must not change (`'write'`, e.g. memberships, which change
 *   only through their own providers). Protection covers the nodes as well as the
 *   shape: a mutation through any other shape that would write or delete a node
 *   typed with a protected shape's class (or a subclass of it) is refused too.
 * - `registerQueryAuthorizer(fn, {owner})`: app-specific checks, run for every
 *   query that passed the protected-shape rules. Throw (a `ServerCallError` with
 *   a status, typically 403) to refuse.
 * - Raw SPARQL (`/api/select-raw`) cannot be analysed, so none of the rules
 *   above apply to it. The server's `rawQueries` setting decides instead:
 *   `'session'` (the default) runs it for any signed-in session, `'off'`
 *   refuses it.
 *
 * The registries are keyed by `owner`, so re-running registration (an HMR
 * reload of the registering provider) replaces the earlier entry instead of
 * stacking another one.
 *
 * The registry lives on `globalThis` so that duplicate copies of this module
 * share it.
 */
import {
  getAllNodeShapes,
  getNodeShape,
  getRegistryVersion,
  getSubShapes,
  getSuperShapes,
} from '@_linked/core/utils/ShapeClass';
import { getPropertyShapes } from '@_linked/core/shapes/nodeShapeData';
import { getCallContext } from './CallContext.js';
import { ServerCallError } from './ServerCallError.js';

export type QueryOperation = 'select' | 'ask' | 'create' | 'update' | 'delete';

export type QueryDenyMode = 'all' | 'write';

export interface QueryAuthorizationContext {
  operation: QueryOperation;
  /** The query as the client sent it (DSL-JSON or a rehydrated builder). */
  query: unknown;
  /** The lowered IR of the query. */
  ir: unknown;
  /** Every node shape the query touches: scanned, written, traversed into, or owning a property it uses. */
  shapes: ReadonlySet<string>;
  /** Every property shape the query uses. */
  propertyShapes: ReadonlySet<string>;
  request: any;
  linkedAuth: any;
}

export type QueryAuthorizer = (
  ctx: QueryAuthorizationContext
) => void | Promise<void>;

/**
 * Who may run raw SPARQL on the generic plane: `'session'` any signed-in
 * session, `'off'` nobody.
 */
export type RawQueriesMode = 'off' | 'session';

type Registry = {
  protectedShapes: Map<string, Map<QueryDenyMode, (Function | string)[]>>;
  authorizers: Map<string, QueryAuthorizer>;
};

const REGISTRY_KEY = Symbol.for('@_linked/server-utils:queryAccess');

function registry(): Registry {
  const g = globalThis as any;
  if (!g[REGISTRY_KEY]) {
    Object.defineProperty(g, REGISTRY_KEY, {
      value: {
        protectedShapes: new Map(),
        authorizers: new Map(),
      } as Registry,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return g[REGISTRY_KEY];
}

function assertOwner(owner: unknown, fn: string): asserts owner is string {
  if (typeof owner !== 'string' || !owner) {
    throw new TypeError(`${fn}: an owner (e.g. your package name) is required`);
  }
}

/**
 * Protect shapes on the generic query plane.
 *
 * `shapes` are shape classes or node-shape IRIs. A registration replaces the
 * same owner's earlier registration for the same `deny` mode; one owner may hold
 * one `'all'` and one `'write'` list. Pass an empty list to clear it.
 */
export function registerProtectedShapes(
  shapes: (Function | string)[],
  o: { deny: QueryDenyMode; owner: string }
): void {
  assertOwner(o?.owner, 'registerProtectedShapes');
  if (o.deny !== 'all' && o.deny !== 'write') {
    throw new TypeError(
      `registerProtectedShapes: deny must be 'all' or 'write', got ${JSON.stringify(o.deny)}`
    );
  }
  const reg = registry();
  let byMode = reg.protectedShapes.get(o.owner);
  if (!byMode) {
    byMode = new Map();
    reg.protectedShapes.set(o.owner, byMode);
  }
  if (!shapes || shapes.length === 0) {
    byMode.delete(o.deny);
  } else {
    byMode.set(o.deny, [...shapes]);
  }
}

/**
 * Add a query authorizer. Replaces the same owner's earlier authorizer. Returns a
 * function that removes it (only if it is still the registered one).
 */
export function registerQueryAuthorizer(
  fn: QueryAuthorizer,
  o: { owner: string }
): () => void {
  assertOwner(o?.owner, 'registerQueryAuthorizer');
  if (typeof fn !== 'function') {
    throw new TypeError('registerQueryAuthorizer: expected a function');
  }
  const reg = registry();
  reg.authorizers.set(o.owner, fn);
  return () => {
    if (reg.authorizers.get(o.owner) === fn) {
      reg.authorizers.delete(o.owner);
    }
  };
}

function shapeIdOf(shape: Function | string): string | undefined {
  if (typeof shape === 'string') return shape;
  return (shape as any)?.shape?.id;
}

/** The node-shape IRIs currently protected with the given mode. */
export function getProtectedShapeIds(deny: QueryDenyMode): Set<string> {
  const ids = new Set<string>();
  for (const byMode of registry().protectedShapes.values()) {
    for (const shape of byMode.get(deny) ?? []) {
      const id = shapeIdOf(shape);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * The `rdf:type` IRIs of every protected shape (either mode) and of every shape
 * that extends one: the classes whose nodes no generic-plane mutation may write
 * or delete, whichever shape the mutation goes through.
 */
export function getProtectedClassIds(): Set<string> {
  const classes = new Set<string>();
  const add = (shape: any) => {
    const id = shape?.targetClass?.id;
    if (typeof id === 'string' && id) classes.add(id);
  };
  for (const deny of ['all', 'write'] as QueryDenyMode[]) {
    for (const shapeId of getProtectedShapeIds(deny)) {
      let nodeShape: any;
      try {
        nodeShape = getNodeShape({ id: shapeId } as any);
      } catch {
        nodeShape = undefined;
      }
      add(nodeShape);
      let subs: any[] = [];
      try {
        subs = getSubShapes(shapeId) ?? [];
      } catch {
        subs = [];
      }
      subs.forEach(add);
    }
  }
  return classes;
}

/** The registered authorizers, in registration order. */
export function getQueryAuthorizers(): QueryAuthorizer[] {
  return [...registry().authorizers.values()];
}

// property-shape IRI -> {owner node shape, value node shape, owns its values}
let propertyIndex:
  | Map<string, { owner: string; value?: string; contains?: boolean }>
  | undefined;
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
          contains: ps.contains === true,
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

/** True when `shapeId` or any shape it extends is in `protectedIds`. */
function isProtected(shapeId: string, protectedIds: Set<string>): boolean {
  if (protectedIds.has(shapeId)) return true;
  let supers: { id: string }[] = [];
  try {
    supers = getSuperShapes(shapeId) ?? [];
  } catch {
    supers = [];
  }
  return supers.some((s) => s && protectedIds.has(s.id));
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

/** The IRIs of every `contains` property's (simple) path in the registry. */
export function getContainsPredicates(): string[] {
  const preds = new Set<string>();
  for (const nodeShape of getAllNodeShapes().values()) {
    for (const ps of (nodeShape as any)?.propertyShapes ?? []) {
      if (!ps?.contains) continue;
      const path = ps.path;
      if (typeof path === 'string') preds.add(path);
      else if (path && typeof path === 'object' && typeof path.id === 'string') {
        preds.add(path.id);
      }
    }
  }
  return [...preds];
}

function shapeHasContainsProperty(shapeId: string): boolean {
  const nodeShape = getNodeShape({ id: shapeId } as any);
  if (!nodeShape) return false;
  try {
    return getPropertyShapes(nodeShape, true).some((ps: any) => ps?.contains);
  } catch {
    return false;
  }
}

export interface MutationNodes {
  /** Ids the client chose for nodes the mutation creates (`__id`). */
  clientIds: string[];
  /** Existing nodes the mutation writes or deletes, by id. */
  ids: string[];
  /** Nodes whose owned (`contains`) subtree the mutation may delete. */
  ownerIds: string[];
  /** Shapes a where/all mutation writes or deletes every matching instance of. */
  scanShapes: string[];
}

/**
 * The nodes a mutation IR writes or deletes:
 *
 * - the target (`update`/`upsert` `id`, `delete` `ids`);
 * - nested node data that carries an id (`{__id, ...}`), which the client chose;
 * - references set or removed on a `contains` property, since the owning edge
 *   makes them part of the target (removing one deletes it);
 * - for `delete`, and for an update that writes a `contains` property, the target
 *   is also an owner whose owned subtree the store may cascade-delete;
 * - for `update_where`/`delete_where`/`delete_all`, the shape whose instances it
 *   matches (no ids are known up front).
 */
export function collectMutationNodes(ir: any): MutationNodes {
  const clientIds = new Set<string>();
  const ids = new Set<string>();
  const ownerIds = new Set<string>();
  const scanShapes = new Set<string>();
  if (!ir || typeof ir !== 'object') {
    return { clientIds: [], ids: [], ownerIds: [], scanShapes: [] };
  }
  const index = getPropertyIndex();
  const seen = new Set<object>();
  let writesContains = false;

  const addId = (set: Set<string>, id: unknown) => {
    if (typeof id === 'string' && id) set.add(id);
  };

  // A field value: node data, a reference, a set modification, or an array of them.
  const walkValue = (value: unknown, contains: boolean) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) walkValue(item, contains);
      return;
    }
    const obj = value as Record<string, any>;
    if (Array.isArray(obj.fields) && typeof obj.shape === 'string') {
      walkNodeData(obj, true);
      return;
    }
    if ('add' in obj || 'remove' in obj) {
      walkValue(obj.add, contains);
      walkValue(obj.remove, contains);
      return;
    }
    if (typeof obj.id === 'string') {
      if (contains) addId(ids, obj.id);
      return;
    }
    // an expression or anything else: look inside for nested node data
    for (const key of Object.keys(obj)) walkValue(obj[key], contains);
  };

  const walkNodeData = (data: any, nested: boolean) => {
    if (!data || typeof data !== 'object') return;
    // node data with an id is a node the client named itself
    if (typeof data.id === 'string') addId(clientIds, data.id);
    for (const field of Array.isArray(data.fields) ? data.fields : []) {
      const contains = !!(field && typeof field.property === 'string' && index.get(field.property)?.contains);
      if (contains && !nested) writesContains = true;
      walkValue(field?.value, contains);
    }
  };

  switch (ir.kind) {
    case 'create':
      walkNodeData(ir.data, false);
      break;
    case 'update':
    case 'upsert':
      addId(ids, ir.id);
      walkNodeData({ ...ir.data, id: undefined }, false);
      if (writesContains) addId(ownerIds, ir.id);
      break;
    case 'update_where':
      walkNodeData({ ...ir.data, id: undefined }, false);
      if (typeof ir.shape === 'string') scanShapes.add(ir.shape);
      break;
    case 'delete':
      for (const ref of Array.isArray(ir.ids) ? ir.ids : []) {
        addId(ids, ref?.id);
        if (typeof ir.shape === 'string' && shapeHasContainsProperty(ir.shape)) {
          addId(ownerIds, ref?.id);
        }
      }
      break;
    case 'delete_all':
    case 'delete_where':
      if (typeof ir.shape === 'string') scanShapes.add(ir.shape);
      break;
  }
  return {
    clientIds: [...clientIds],
    ids: [...ids],
    ownerIds: [...ownerIds],
    scanShapes: [...scanShapes],
  };
}

/** What the server is asked to look up before a mutation runs. */
export interface ProtectedNodeCheck {
  operation: QueryOperation;
  /** The mutation's shape: the store it routes to is the one to ask. */
  shape: string;
  /** Is any of these nodes typed with one of `classes`? */
  ids: string[];
  /** Is any node in the owned subtree of these (`containsPredicates`, one or more hops) typed so? */
  ownerIds: string[];
  /** Is any instance of these classes (or a node it owns) also typed so? */
  scanClasses: string[];
  /** The protected classes; a node typed with a subclass of one counts too. */
  classes: string[];
  /** The `contains` predicates the store follows when it cascades a delete. */
  containsPredicates: string[];
}

/**
 * Answers a `ProtectedNodeCheck` against the store the mutation would run on:
 * `true` when a protected node would be touched. The server provides it (one
 * SPARQL `ASK`). Throw when the store cannot answer; the mutation is refused.
 */
export type ProtectedNodeProbe = (check: ProtectedNodeCheck) => Promise<boolean>;

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
  /** `'enforce'` refuses what `'warn'` only logs. */
  mode: 'warn' | 'enforce';
  /** Used in log lines. */
  endpoint?: string;
  /**
   * Looks up whether a mutation would touch a node typed with a protected class.
   * Without it, a mutation is refused whenever protected shapes are registered.
   */
  probeProtectedNodes?: ProtectedNodeProbe;
}

function refuse(status: number, message: string, log?: string): never {
  if (log) console.warn(log);
  throw new ServerCallError(status, message);
}

/**
 * Apply the query rules to a query about to run on the generic plane.
 *
 * Only a call with an HTTP context is checked; system work and
 * backend-to-backend calls made outside a request are trusted. (The server
 * enters an HTTP context for every request it receives.) Order:
 *
 * 1. the operation must match the query's kind (400 otherwise);
 * 2. raw SPARQL → refused (403) when `rawQueries` is `'off'`; otherwise it
 *    needs a session (401 without one, in every mode), and nothing below
 *    applies;
 * 3. no session → a mutation is refused (401) in every mode; anything else is
 *    logged once, or 401 in enforce mode;
 * 4. a query that could not be analysed → 400;
 * 5. a protected shape (`deny: 'all'`) anywhere in the query, or a written shape
 *    under either mode on a mutation → 403 in both modes (registering a shape is
 *    the opt-in);
 * 6. a mutation: client-chosen ids for new nodes → 403; and, when protected
 *    shapes are registered, a node it would write or delete that is typed with a
 *    protected class (asked through `probeProtectedNodes`) → 403;
 * 7. the registered query authorizers, in order.
 */
export async function checkQueryAccess(o: CheckQueryAccessOptions): Promise<void> {
  const ctx = getCallContext();
  if (!ctx || ctx.kind !== 'http') return;
  const request = ctx.request;
  const linkedAuth = request?.linkedAuth;
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
    if (!linkedAuth?.userAccount) {
      refuse(401, 'Authentication required');
    }
    return;
  }

  if (!linkedAuth?.userAccount) {
    if (isMutation) {
      refuse(401, 'Authentication required');
    }
    if (o.mode === 'enforce') {
      refuse(401, 'Authentication required');
    }
    warnOnce(
      'anon:' + endpoint,
      `[linked] anonymous ${endpoint} on the generic query plane. ` +
        `This is refused (401) once rpcExposure is 'enforce'.`
    );
  }

  if (o.ir === undefined) {
    refuse(400, 'Query could not be analysed');
  }

  const targets = collectQueryTargets(o.ir);
  const denyAll = getProtectedShapeIds('all');
  for (const shape of targets.shapes) {
    if (isProtected(shape, denyAll)) {
      refuse(403, 'Query not permitted', `[linked] refused ${endpoint}: it touches protected shape ${shape}`);
    }
  }
  if (isMutation) {
    const denyWrite = getProtectedShapeIds('write');
    for (const shape of targets.writtenShapes) {
      if (isProtected(shape, denyWrite) || isProtected(shape, denyAll)) {
        refuse(403, 'Query not permitted', `[linked] refused ${endpoint}: it writes protected shape ${shape}`);
      }
    }
    await checkMutationNodes(o, endpoint);
  }

  const authorizers = getQueryAuthorizers();
  if (authorizers.length === 0) return;
  const authContext: QueryAuthorizationContext = {
    operation: o.operation,
    query: o.query,
    ir: o.ir,
    shapes: targets.shapes,
    propertyShapes: targets.propertyShapes,
    request,
    linkedAuth,
  };
  for (const authorize of authorizers) {
    await authorize(authContext);
  }
}

async function checkMutationNodes(o: CheckQueryAccessOptions, endpoint: string) {
  const ir = o.ir as any;
  const nodes = collectMutationNodes(ir);
  if (nodes.clientIds.length > 0) {
    refuse(
      403,
      'Query not permitted: the server assigns the ids of new nodes',
      `[linked] refused ${endpoint}: it chooses the id of a new node`
    );
  }
  const classes = getProtectedClassIds();
  if (classes.size === 0) return;
  if (
    nodes.ids.length === 0 &&
    nodes.ownerIds.length === 0 &&
    nodes.scanShapes.length === 0
  ) {
    return;
  }
  const scanClasses: string[] = [];
  for (const shapeId of nodes.scanShapes) {
    const targetClass = (getNodeShape({ id: shapeId } as any) as any)?.targetClass?.id;
    if (typeof targetClass !== 'string' || !targetClass) {
      refuse(
        403,
        'Query not permitted',
        `[linked] refused ${endpoint}: cannot tell which nodes it matches (shape ${shapeId} has no target class)`
      );
    }
    scanClasses.push(targetClass);
  }
  if (!o.probeProtectedNodes) {
    refuse(
      403,
      'Query not permitted',
      `[linked] refused ${endpoint}: protected shapes are registered and the nodes it writes cannot be checked`
    );
  }
  let touches: boolean;
  try {
    touches = await o.probeProtectedNodes({
      operation: o.operation,
      shape: ir.shape,
      ids: nodes.ids,
      ownerIds: nodes.ownerIds,
      scanClasses,
      classes: [...classes],
      containsPredicates: getContainsPredicates(),
    });
  } catch (err) {
    if (ServerCallError.is(err)) throw err;
    refuse(
      403,
      'Query not permitted',
      `[linked] refused ${endpoint}: could not check the nodes it writes: ${(err as any)?.message ?? err}`
    );
  }
  if (touches !== false) {
    refuse(403, 'Query not permitted', `[linked] refused ${endpoint}: it writes a node of a protected class`);
  }
}
