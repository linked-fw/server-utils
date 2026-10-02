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
 *   only through their own providers).
 * - `registerQueryAuthorizer(fn, {owner})`: app-specific checks, run for every
 *   query that passed the protected-shape rules. Throw (a `ServerCallError` with
 *   a status, typically 403) to refuse.
 *
 * Both registries are keyed by `owner`, so re-running registration (an HMR
 * reload of the registering provider) replaces the earlier entry instead of
 * stacking another one.
 *
 * The registry lives on `globalThis` so that duplicate copies of this module
 * share it.
 */
import { getAllNodeShapes, getRegistryVersion, getSuperShapes } from '@_linked/core/utils/ShapeClass';
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

type Registry = {
  protectedShapes: Map<string, Map<QueryDenyMode, (Function | string)[]>>;
  authorizers: Map<string, QueryAuthorizer>;
};

const REGISTRY_KEY = Symbol.for('@_linked/server-utils:queryAccess');

function registry(): Registry {
  const g = globalThis as any;
  if (!g[REGISTRY_KEY]) {
    Object.defineProperty(g, REGISTRY_KEY, {
      value: { protectedShapes: new Map(), authorizers: new Map() } as Registry,
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

/** The registered authorizers, in registration order. */
export function getQueryAuthorizers(): QueryAuthorizer[] {
  return [...registry().authorizers.values()];
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

export interface CheckQueryAccessOptions {
  operation: QueryOperation;
  query: unknown;
  /**
   * The lowered IR. `undefined` for a query that cannot be analysed (a raw
   * SPARQL string): no session → as below; otherwise warned, or 403 in enforce.
   */
  ir: unknown;
  /** `'enforce'` refuses what `'warn'` only logs. */
  mode: 'warn' | 'enforce';
  /** Used in log lines. */
  endpoint?: string;
}

/**
 * Apply the query rules to a query about to run on the generic plane.
 *
 * Only an HTTP call is checked; system and backend-to-backend work outside a
 * request is trusted. Order:
 *
 * 1. no session → logged once, or 401 in enforce mode;
 * 2. a protected shape (`deny: 'all'`), or a written shape under `deny: 'write'`
 *    on a mutation → 403 in both modes (registering a shape is the opt-in);
 * 3. an unanalysable query → logged once, or 403 in enforce mode;
 * 4. the registered authorizers, in order.
 */
export async function checkQueryAccess(o: CheckQueryAccessOptions): Promise<void> {
  const ctx = getCallContext();
  if (!ctx || ctx.kind !== 'http') return;
  const request = ctx.request;
  const linkedAuth = request?.linkedAuth;
  const endpoint = o.endpoint ?? o.operation;

  if (!linkedAuth?.userAccount) {
    if (o.mode === 'enforce') {
      throw new ServerCallError(401, 'Authentication required');
    }
    warnOnce(
      'anon:' + endpoint,
      `[linked] anonymous ${endpoint} on the generic query plane. ` +
        `This is refused (401) once rpcExposure is 'enforce'.`
    );
  }

  if (o.ir === undefined) {
    if (o.mode === 'enforce') {
      throw new ServerCallError(403, 'Query not permitted');
    }
    warnOnce(
      'raw:' + endpoint,
      `[linked] ${endpoint} cannot be analysed for protected shapes. ` +
        `This is refused (403) once rpcExposure is 'enforce'.`
    );
    return;
  }

  const targets = collectQueryTargets(o.ir);
  const denyAll = getProtectedShapeIds('all');
  for (const shape of targets.shapes) {
    if (isProtected(shape, denyAll)) {
      console.warn(`[linked] refused ${endpoint}: it touches protected shape ${shape}`);
      throw new ServerCallError(403, 'Query not permitted');
    }
  }
  const isWrite = o.operation === 'create' || o.operation === 'update' || o.operation === 'delete';
  if (isWrite) {
    const denyWrite = getProtectedShapeIds('write');
    for (const shape of targets.writtenShapes) {
      if (isProtected(shape, denyWrite) || isProtected(shape, denyAll)) {
        console.warn(`[linked] refused ${endpoint}: it writes protected shape ${shape}`);
        throw new ServerCallError(403, 'Query not permitted');
      }
    }
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
