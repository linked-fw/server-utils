/**
 * Simplified JSONWriter for @_linked/core.
 *
 * Handles: Shape instances, Shape classes, Date, ShapeSet, CoreSet, Map,
 * plain objects/arrays, and primitives.
 *
 * All graph-model types (Graph, NamedNode, BlankNode, Literal, Quad, QuadSet,
 * QuadArray, NodeSet, URIMappings) have been removed — they no longer exist
 * in @_linked/core.
 */
import { Shape } from '@_linked/core/shapes/Shape';
import { ShapeSet } from '@_linked/core/collections/ShapeSet';
import { CoreSet } from '@_linked/core/collections/CoreSet';
import { isLinkedInstance, linkedErrorBrand } from '@_linked/core/utils/linkedError';

const SHAPE_BRAND = linkedErrorBrand('@_linked/core', 'Shape');

/** `Shape` or a subclass of it, from any copy of core. */
function isShapeClass(object: any): boolean {
  if (object === Shape) return true;
  const proto = typeof object === 'function' ? object.prototype : null;
  if (!proto) return false;
  return (
    isLinkedInstance(proto, Shape) ||
    Object.prototype.hasOwnProperty.call(proto, SHAPE_BRAND)
  );
}

export class JSONWriter {
  /**
   * Convert any object to a JSON string.
   * The result is meant to be consumed by JSONParser.
   */
  static stringify(object: any): string {
    const jsObject = this.toJsObject(object);
    return JSON.stringify(jsObject);
  }

  /**
   * Convert any object to a plain JS object suitable for JSON.stringify.
   * Recursively converts Shape instances, Shape classes, Dates, and collections.
   */
  static toJsObject(object: any): any {
    if (
      object === null ||
      object === undefined ||
      typeof object === 'string' ||
      typeof object === 'number' ||
      typeof object === 'boolean'
    ) {
      return object;
    }

    if (object instanceof Date) {
      return { __dt: object.toISOString() };
    }

    if (isLinkedInstance(object, Shape)) {
      return this.convertShape(object);
    }

    // Shape class (not instance)
    if (isShapeClass(object)) {
      return this.convertShapeClass(object);
    }

    if (isLinkedInstance(object, ShapeSet)) {
      return this.convertCoreSet(object, 'ss');
    }

    if (object instanceof Map) {
      return this.convertCoreMap(object);
    }

    if (isLinkedInstance(object, CoreSet)) {
      return this.convertCoreSet(object, 'cs');
    }

    if (Array.isArray(object)) {
      return object.map((item) => this.toJsObject(item));
    }

    if (typeof object === 'object') {
      const result: Record<string, any> = {};
      for (const key in object) {
        if (Object.prototype.hasOwnProperty.call(object, key)) {
          result[key] = this.toJsObject(object[key]);
        }
      }
      return result;
    }

    return object;
  }

  private static convertShape(shape: Shape): { __s: string; u: string } {
    if (!shape.nodeShape) {
      console.warn(
        'Shape is not linked and cannot be converted to JSON: ' +
          shape.toString()
      );
    }
    return {
      __s: shape.nodeShape?.id,
      u: shape.id,
    };
  }

  private static convertShapeClass(shapeClass: typeof Shape): { __sc: string } {
    if (!shapeClass.shape) {
      console.warn(
        'Shape class is not linked and cannot be converted to JSON: ' +
          shapeClass.name
      );
    }
    return {
      __sc: shapeClass.shape?.id,
    };
  }

  private static convertCoreSet(
    set: CoreSet<any>,
    type: string
  ): { __type: string; entries: any[] } {
    const entries: any[] = [];
    set.forEach((item) => {
      entries.push(this.toJsObject(item));
    });
    return { __type: type, entries };
  }

  private static convertCoreMap(map: Map<any, any>): {
    __type: string;
    entries: any[];
  } {
    const entries: any[] = [];
    map.forEach((value, key) => {
      entries.push([this.toJsObject(key), this.toJsObject(value)]);
    });
    return { __type: 'cm', entries };
  }
}
