import {
  callable,
  declareCallable,
  declareInternal,
  getOwnCallableLevel,
  internal,
  isDeclaredInternal,
  resetCallableConflictWarnings,
} from './callable.js';

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

describe('internal', () => {
  function decorateInternal(cls: any, method: string) {
    const descriptor = Object.getOwnPropertyDescriptor(cls.prototype, method);
    internal()(cls.prototype, method, descriptor);
  }

  let warn: jest.SpyInstance;
  beforeEach(() => {
    resetCallableConflictWarnings();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('records an own declaration, separate from the callable map', () => {
    class P {
      a() {}
      b() {}
    }
    decorateInternal(P, 'a');
    expect(isDeclaredInternal(P, 'a')).toBe(true);
    expect(isDeclaredInternal(P, 'b')).toBe(false);
    expect(getOwnCallableLevel(P, 'a')).toBeUndefined();
    const key = Symbol.for('@_linked/server-utils:internal');
    expect(Object.prototype.hasOwnProperty.call(P, key)).toBe(true);
    expect(Object.keys(P)).toEqual([]);
  });

  it('is inherited: an override on a subclass stays internal', () => {
    class Base {
      a() {}
    }
    class Sub extends Base {
      a() {}
    }
    decorateInternal(Base, 'a');
    expect(isDeclaredInternal(Sub, 'a')).toBe(true);
  });

  it('declaring on a subclass does not touch the base class', () => {
    class Base {
      a() {}
    }
    class Sub extends Base {}
    declareInternal(Sub, ['a']);
    expect(isDeclaredInternal(Sub, 'a')).toBe(true);
    expect(isDeclaredInternal(Base, 'a')).toBe(false);
    const key = Symbol.for('@_linked/server-utils:internal');
    expect(Object.prototype.hasOwnProperty.call(Base, key)).toBe(false);
  });

  it('declareInternal works from outside on a class that does not annotate itself', () => {
    class Imported {
      getPassword() {}
      ok() {}
    }
    declareInternal(Imported, ['getPassword']);
    expect(isDeclaredInternal(Imported, 'getPassword')).toBe(true);
    expect(isDeclaredInternal(Imported, 'ok')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('wins over a callable declaration, and warns once', () => {
    class Declared {
      a() {}
    }
    declareCallable(Declared, { a: 'public' });
    declareInternal(Declared, ['a']);
    declareInternal(Declared, ['a']);
    expect(isDeclaredInternal(Declared, 'a')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/Declared\.a .*internal wins/);
  });

  it('warns when a subclass declares callable what its base declared internal', () => {
    class Base {
      a() {}
    }
    class Sub extends Base {
      a() {}
    }
    declareInternal(Base, ['a']);
    declareCallable(Sub, { a: 'user' });
    expect(isDeclaredInternal(Sub, 'a')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers false for non-classes', () => {
    expect(isDeclaredInternal(undefined as any, 'a')).toBe(false);
  });

  it('throws on static methods, TC39 contexts and bad input', () => {
    class S {
      static thing() {}
    }
    expect(() => internal()(S as any, 'thing', undefined)).toThrow(/static/);
    expect(() => declareInternal(S, ['thing'])).toThrow(/static/);
    expect(() =>
      (internal() as any)(function () {}, { kind: 'method', name: 'x' })
    ).toThrow(/TC39/);
    expect(() => declareInternal(S, 'thing' as any)).toThrow(/array/);
    expect(() => declareInternal(undefined as any, ['a'])).toThrow(/class/);
  });
});
