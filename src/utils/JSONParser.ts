/**
 * Simplified JSONParser for @_linked/core.
 *
 * Handles: Shape instances, Shape classes, Date, ShapeSet, CoreSet, Map,
 * plain objects/arrays, and primitives.
 *
 * All graph-model types (Graph, NamedNode, BlankNode, Literal, Quad, QuadSet,
 * QuadArray, NodeSet, URIMappings, N3 data) have been removed — they no longer
 * exist in @_linked/core.
 */
import { Shape } from '@_linked/core/shapes/Shape';
import { ShapeSet } from '@_linked/core/collections/ShapeSet';
import { CoreSet } from '@_linked/core/collections/CoreSet';
import { getShapeClass } from '@_linked/core/utils/ShapeClass';
import { ServerCallError } from './ServerCallError.js';

/**
 * What to do with a `{__sc}` marker, which revives into a live Shape CLASS.
 *
 * - `'allow'` (default): revive it.
 * - `'warn'`: revive it, logging once per shape.
 * - `'reject'`: throw a `ServerCallError(400)`.
 *
 * Server-call arguments come from the client, and no call in the framework or
 * its apps takes a Shape class as an argument, so the RPC path warns or rejects.
 */
export type ShapeClassRevival = 'allow' | 'warn' | 'reject';

export interface JSONParserOptions {
  shapeClasses?: ShapeClassRevival;
}

const warnedShapeClasses = new Set<string>();

export class JSONParser {
  /**
   * Parse a JSON string back into typed objects.
   */
  static parse<T>(json: string, options?: JSONParserOptions): T {
    const object = JSON.parse(json);
    return this.parseObject(object, options);
  }

  /**
   * Convert a plain JS object back into typed objects.
   * Recognizes markers (__s, __sc, __dt, __type) and reconstructs
   * the corresponding Shape/collection instances.
   *
   * A `__proto__` key is always dropped: assigning it would set the result's
   * prototype rather than add a property.
   */
  static parseObject<T>(object: any, options?: JSONParserOptions): T {
    return this.parseInternal(object, options?.shapeClasses ?? 'allow') as T;
  }

  private static parseInternal(object: any, sc: ShapeClassRevival): any {
    if (
      object === null ||
      object === undefined ||
      typeof object === 'string' ||
      typeof object === 'number' ||
      typeof object === 'boolean'
    ) {
      return object;
    }

    if (Array.isArray(object)) {
      return object.map((item) => this.parseInternal(item, sc));
    }

    if (typeof object !== 'object') {
      return object;
    }

    // Collection types
    if ('__type' in object) {
      const type = object.__type;
      if (type === 'ss') {
        return this.createShapeSet(object, sc);
      }
      if (type === 'cs') {
        return this.createCoreSet(object, sc);
      }
      if (type === 'cm') {
        return this.createCoreMap(object, sc);
      }
    }

    // Shape instance: {__s: nodeShapeURI, u: instanceURI}
    if ('__s' in object) {
      return this.createShape(object);
    }

    // Shape class: {__sc: nodeShapeURI}
    if ('__sc' in object) {
      if (sc === 'reject') {
        throw new ServerCallError(400, 'Shape class arguments are not accepted');
      }
      if (sc === 'warn') {
        const key = String(object.__sc);
        if (!warnedShapeClasses.has(key)) {
          warnedShapeClasses.add(key);
          console.warn(
            `[linked] a server call argument revives the Shape class ${key}. ` +
              `This is refused (400) once rpcExposure is 'enforce'.`
          );
        }
      }
      return this.createShapeClass(object);
    }

    // Date: {__dt: ISO string}
    if ('__dt' in object) {
      return new Date(object.__dt);
    }

    // Legacy wrapper — just unwrap
    if ('__n' in object) {
      return this.parseInternal(object.__n, sc);
    }

    // Plain object — recursively parse values
    const result: Record<string, any> = {};
    for (const key in object) {
      if (key === '__proto__') continue;
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        result[key] = this.parseInternal(object[key], sc);
      }
    }
    return result;
  }

  private static createShape(object: { __s: string; u: string }): Shape {
    const ShapeClass = getShapeClass(object.__s) as unknown as typeof Shape;
    if (!ShapeClass) {
      console.warn(
        `Unknown shape class ${object.__s}, using generic Shape. ` +
          `The shape class is probably not loaded.`
      );
      return new (Shape as any)({ id: object.u }) as Shape;
    }
    return new (ShapeClass as any)({ id: object.u }) as Shape;
  }

  private static createShapeClass(object: { __sc: string }): typeof Shape {
    const ShapeClass = getShapeClass(object.__sc) as unknown as typeof Shape;
    if (!ShapeClass) {
      console.warn(
        `Unknown shape class ${object.__sc}, using generic Shape. ` +
          `The shape class is probably not loaded.`
      );
      return Shape;
    }
    return ShapeClass;
  }

  private static createShapeSet(object: {
    __type: string;
    entries: any[];
  }, sc: ShapeClassRevival): ShapeSet<Shape> {
    const set = new ShapeSet<Shape>();
    for (const entry of object.entries) {
      set.add(this.parseInternal(entry, sc));
    }
    return set;
  }

  private static createCoreSet(object: {
    __type: string;
    entries: any[];
  }, sc: ShapeClassRevival): CoreSet<any> {
    const set = new CoreSet<any>();
    for (const entry of object.entries) {
      set.add(this.parseInternal(entry, sc));
    }
    return set;
  }

  private static createCoreMap(object: {
    __type: string;
    entries: any[];
  }, sc: ShapeClassRevival): Map<any, any> {
    const map = new Map<any, any>();
    for (const entry of object.entries) {
      const [key, value] = entry;
      map.set(this.parseInternal(key, sc), this.parseInternal(value, sc));
    }
    return map;
  }
}
