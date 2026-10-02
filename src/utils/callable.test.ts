import { callable, declareCallable, getOwnCallableLevel } from './callable.js';

// Decorators are applied by hand: the jest babel transform does not compile
// legacy decorators. `callable(level)(proto, key, descriptor)` is exactly what
// tsc emits for `@callable(level)` under experimentalDecorators.
function decorate(cls: any, method: string, level: 'public' | 'user') {
  const descriptor = Object.getOwnPropertyDescriptor(cls.prototype, method);
  callable(level)(cls.prototype, method, descriptor);
}

describe('callable', () => {
  class Base {
    ping() {}
    secret() {}
  }
  class Sub extends Base {
    ping() {}
    own() {}
  }
  decorate(Base, 'ping', 'public');
  decorate(Sub, 'own', 'user');

  it('records the level on the declaring class', () => {
    expect(getOwnCallableLevel(Base, 'ping')).toBe('public');
    expect(getOwnCallableLevel(Sub, 'own')).toBe('user');
  });

  it('does not inherit declarations: an override must redeclare', () => {
    expect(getOwnCallableLevel(Sub, 'ping')).toBeUndefined();
  });

  it('declaring on a subclass does not touch the base class', () => {
    expect(getOwnCallableLevel(Base, 'own')).toBeUndefined();
    // the map is an OWN property, not shared through the static prototype chain
    const key = Symbol.for('@_linked/server-utils:callable');
    expect(Object.prototype.hasOwnProperty.call(Sub, key)).toBe(true);
    expect((Sub as any)[key]).not.toBe((Base as any)[key]);
  });

  it('keeps the metadata non-enumerable', () => {
    expect(Object.keys(Base)).toEqual([]);
  });

  it('answers undefined for undeclared methods and non-classes', () => {
    expect(getOwnCallableLevel(Base, 'secret')).toBeUndefined();
    expect(getOwnCallableLevel(undefined as any, 'ping')).toBeUndefined();
  });

  it('throws on a static method', () => {
    class S {
      static thing() {}
    }
    expect(() => callable('public')(S as any, 'thing', undefined)).toThrow(/static/);
    expect(() => declareCallable(S, { thing: 'public' })).toThrow(/static/);
  });

  it('throws on a TC39 decorator context', () => {
    expect(() =>
      (callable('public') as any)(function () {}, { kind: 'method', name: 'x' })
    ).toThrow(/TC39/);
  });

  it('throws on an unknown level', () => {
    expect(() => callable('admin' as any)).toThrow(/unknown level/);
    expect(() => declareCallable(Base, { ping: 'admin' as any })).toThrow(/unknown level/);
  });

  it('declareCallable declares for plain JS classes', () => {
    class Plain {
      a() {}
      b() {}
    }
    declareCallable(Plain, { a: 'public', b: 'user' });
    expect(getOwnCallableLevel(Plain, 'a')).toBe('public');
    expect(getOwnCallableLevel(Plain, 'b')).toBe('user');
  });
});
