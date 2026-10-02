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
 * the base class. A subclass that overrides a declared method without
 * redeclaring it keeps the strictest level declared for that method up its class
 * chain (the server resolves this; `getOwnCallableLevel` reports only the class's
 * own declaration).
 *
 * `@internal()` (or `declareInternal`) is the opposite: the method is never
 * dispatched over HTTP, in any exposure mode, while backend-to-backend calls
 * keep working. An app can use `declareInternal` on a class it imports to block
 * a method the package itself has not annotated. Unlike a callable declaration,
 * an internal one is inherited: an override on a subclass stays internal, and it
 * wins over a callable declaration of the same method.
 *
 * This module has no imports on purpose: it is safe to load on the client too.
 */

export type CallableLevel = 'public' | 'user';

const CALLABLE_KEY = Symbol.for('@_linked/server-utils:callable');
const INTERNAL_KEY = Symbol.for('@_linked/server-utils:internal');

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

function ownInternalSet(cls: Function, create: boolean): Set<string> | undefined {
  if (Object.prototype.hasOwnProperty.call(cls, INTERNAL_KEY)) {
    return (cls as any)[INTERNAL_KEY];
  }
  if (!create) return undefined;
  const set = new Set<string>();
  Object.defineProperty(cls, INTERNAL_KEY, {
    value: set,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return set;
}

/** `cls` and its super classes, nearest first. */
function classChain(cls: Function): Function[] {
  const chain: Function[] = [];
  let c: any = cls;
  while (typeof c === 'function' && c !== Function.prototype) {
    chain.push(c);
    c = Object.getPrototypeOf(c);
  }
  return chain;
}

const warnedConflicts = new Set<string>();

function warnConflict(cls: Function, method: string) {
  const key = `${cls.name}\u0000${method}`;
  if (warnedConflicts.has(key)) return;
  warnedConflicts.add(key);
  console.warn(
    `[linked] ${cls.name || 'anonymous class'}.${method} is declared both callable and internal; ` +
      `internal wins and the method is not dispatched over HTTP`
  );
}

/** Warn once when declaring `method` callable on `cls` meets an internal declaration. */
function checkCallableConflict(cls: Function, method: string) {
  if (isDeclaredInternal(cls, method)) warnConflict(cls, method);
}

/** Warn once when declaring `method` internal on `cls` meets a callable declaration. */
function checkInternalConflict(cls: Function, method: string) {
  if (classChain(cls).some((c) => ownMap(c, false)?.has(method))) {
    warnConflict(cls, method);
  }
}

/** True when `cls` or a super class defines an instance method named `method`. */
function hasInstanceMethod(cls: Function, method: string): boolean {
  let proto: any = cls.prototype;
  while (proto && proto !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, method);
    if (descriptor) return 'value' in descriptor && typeof descriptor.value === 'function';
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

function printable(name: string): string {
  return JSON.stringify(String(name)).slice(0, 120);
}

function assertInstanceMethod(cls: Function, method: string, fn: string) {
  if (typeof cls !== 'function') {
    throw new TypeError(`${fn}: can only declare methods of a class`);
  }
  if (!Object.prototype.hasOwnProperty.call(cls.prototype, method)) {
    // A static method lives on the constructor, an instance method on its
    // prototype. Only instance methods are dispatched.
    if (Object.prototype.hasOwnProperty.call(cls, method)) {
      throw new TypeError(
        `${fn}: ${cls.name}.${method} is static; only instance methods can be declared`
      );
    }
  }
  // A misspelt name would otherwise declare nothing, silently.
  if (!hasInstanceMethod(cls, method)) {
    throw new TypeError(
      `${fn}: ${cls.name || 'anonymous class'} has no method ${printable(method)}`
    );
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
    checkCallableConflict(cls, propertyKey);
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
 *
 * Throws a `TypeError` for a name the class (or a super class) has no instance
 * method for, and for a static method.
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
    assertInstanceMethod(cls, method, 'declareCallable');
  }
  const map = ownMap(cls, true);
  for (const [method, level] of entries) {
    map.set(method, level);
    checkCallableConflict(cls, method);
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

/**
 * Method decorator (legacy `experimentalDecorators` form) declaring a provider
 * method internal: never dispatched over HTTP, in any exposure mode. Calls from
 * other backend code still work.
 *
 * ```ts
 * class MyProvider extends BackendProvider {
 *   @internal()
 *   resetEverything() { ... }
 * }
 * ```
 */
export function internal(): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor?: any) {
    if (
      propertyKey &&
      typeof propertyKey === 'object' &&
      'kind' in (propertyKey as any)
    ) {
      throw new TypeError(
        'internal: TC39 decorators are not supported; compile with experimentalDecorators'
      );
    }
    if (typeof target === 'function') {
      throw new TypeError(
        `internal: ${target.name}.${String(propertyKey)} is static; only instance methods are dispatched`
      );
    }
    if (typeof propertyKey !== 'string') {
      throw new TypeError('internal: method names must be strings');
    }
    const cls = target?.constructor;
    if (typeof cls !== 'function' || cls.prototype !== target) {
      throw new TypeError('internal: can only decorate class methods');
    }
    ownInternalSet(cls, true).add(propertyKey);
    checkInternalConflict(cls, propertyKey);
    return descriptor;
  } as MethodDecorator;
}

/**
 * Declare methods internal without decorators: in plain JS, or from another
 * package on a class you import, to block methods its package has not
 * annotated. The declaration also covers overrides on subclasses, and wins over
 * a callable declaration of the same method (with a warning).
 *
 * ```js
 * declareInternal(SomeImportedProvider, ['dangerousMethod']);
 * ```
 *
 * Throws a `TypeError` for a name the class (or a super class) has no instance
 * method for, and for a static method.
 */
export function declareInternal(cls: Function, methods: string[]): void {
  if (typeof cls !== 'function') {
    throw new TypeError('declareInternal: expected a class');
  }
  if (!Array.isArray(methods)) {
    throw new TypeError('declareInternal: expected an array of method names');
  }
  for (const method of methods) {
    if (typeof method !== 'string' || !method) {
      throw new TypeError('declareInternal: method names must be non-empty strings');
    }
    assertInstanceMethod(cls, method, 'declareInternal');
  }
  const set = ownInternalSet(cls, true);
  for (const method of methods) {
    set.add(method);
    checkInternalConflict(cls, method);
  }
}

/**
 * True when `cls` or one of its super classes declares `method` internal.
 */
export function isDeclaredInternal(cls: Function, method: string): boolean {
  if (typeof cls !== 'function') return false;
  return classChain(cls).some((c) => ownInternalSet(c, false)?.has(method) === true);
}

/** For tests: forget which callable/internal conflicts were already logged. */
export function resetCallableConflictWarnings(): void {
  warnedConflicts.clear();
}
