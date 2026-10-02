/**
 * Declared-callable provider methods.
 *
 * A backend provider method is only meant to be reachable over `/call/...` when
 * it says so. `@callable(level)` (or `declareCallable` for plain JS) records that
 * declaration on the provider's own class; the server's dispatcher reads it back
 * with `getOwnCallableLevel`.
 *
 * - `'public'`: anyone may call it, signed in or not.
 * - `'user'`: the server answers 401 before the method runs when the request has
 *   no session. The method body takes the user from the request context, never
 *   from its arguments.
 *
 * The declaration is stored as a non-enumerable OWN `Map` on the constructor and
 * is always read with `hasOwnProperty`. Static properties are inherited through
 * the constructor's prototype chain, so a plain `cls[KEY]` read on a subclass
 * would find the base class's map, and writing to it would declare the method on
 * the base class. A subclass that overrides a declared method therefore has to
 * redeclare it.
 *
 * This module has no imports on purpose: it is safe to load on the client too.
 */

export type CallableLevel = 'public' | 'user';

const CALLABLE_KEY = Symbol.for('@_linked/server-utils:callable');

const LEVELS: ReadonlySet<string> = new Set(['public', 'user']);

function assertLevel(level: unknown): asserts level is CallableLevel {
  if (typeof level !== 'string' || !LEVELS.has(level)) {
    throw new TypeError(
      `callable: unknown level ${JSON.stringify(level)}; use 'public' or 'user'`
    );
  }
}

function ownMap(cls: Function, create: boolean): Map<string, CallableLevel> | undefined {
  if (Object.prototype.hasOwnProperty.call(cls, CALLABLE_KEY)) {
    return (cls as any)[CALLABLE_KEY];
  }
  if (!create) return undefined;
  const map = new Map<string, CallableLevel>();
  Object.defineProperty(cls, CALLABLE_KEY, {
    value: map,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return map;
}

function assertInstanceMethod(cls: Function, method: string) {
  if (typeof cls !== 'function') {
    throw new TypeError('callable: can only declare methods of a class');
  }
  if (!Object.prototype.hasOwnProperty.call(cls.prototype, method)) {
    // A static method lives on the constructor, an instance method on its
    // prototype. Only instance methods are dispatched.
    if (Object.prototype.hasOwnProperty.call(cls, method)) {
      throw new TypeError(
        `callable: ${cls.name}.${method} is static; only instance methods can be callable`
      );
    }
  }
}

/**
 * Method decorator (legacy `experimentalDecorators` form) declaring a provider
 * method callable over RPC at the given level.
 *
 * ```ts
 * class MyProvider extends BackendProvider {
 *   @callable('user')
 *   listMyThings() { ... }
 * }
 * ```
 */
export function callable(level: CallableLevel): MethodDecorator {
  assertLevel(level);
  return function (target: any, propertyKey: string | symbol, descriptor?: any) {
    // TC39 (stage 3) decorators call with (value, context).
    if (
      propertyKey &&
      typeof propertyKey === 'object' &&
      'kind' in (propertyKey as any)
    ) {
      throw new TypeError(
        'callable: TC39 decorators are not supported; compile with experimentalDecorators'
      );
    }
    if (typeof target === 'function') {
      throw new TypeError(
        `callable: ${target.name}.${String(propertyKey)} is static; only instance methods can be callable`
      );
    }
    if (typeof propertyKey !== 'string') {
      throw new TypeError('callable: method names must be strings');
    }
    const cls = target?.constructor;
    if (typeof cls !== 'function' || cls.prototype !== target) {
      throw new TypeError('callable: can only decorate class methods');
    }
    ownMap(cls, true).set(propertyKey, level);
    return descriptor;
  } as MethodDecorator;
}

/**
 * Declare callable methods without decorators (plain JS, or a class you do not
 * compile yourself).
 *
 * ```js
 * declareCallable(MyProvider, {listMyThings: 'user', ping: 'public'});
 * ```
 */
export function declareCallable(
  cls: Function,
  methods: Record<string, CallableLevel>
): void {
  if (typeof cls !== 'function') {
    throw new TypeError('declareCallable: expected a class');
  }
  const entries = Object.entries(methods ?? {});
  for (const [method, level] of entries) {
    assertLevel(level);
    assertInstanceMethod(cls, method);
  }
  const map = ownMap(cls, true);
  for (const [method, level] of entries) {
    map.set(method, level);
  }
}

/**
 * The level `cls` itself declares for `method`, ignoring anything declared on
 * its super classes. `undefined` when the class does not declare it.
 */
export function getOwnCallableLevel(
  cls: Function,
  method: string
): CallableLevel | undefined {
  if (typeof cls !== 'function') return undefined;
  return ownMap(cls, false)?.get(method);
}
