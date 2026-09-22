/**
 * Shape metadata types for CMS UI.
 * These types describe shape structure for frontend display — no graph-runtime dependency.
 *
 * `PathExpr` is imported as a TYPE only, which keeps that property true at runtime:
 * nothing from `@_linked/core` is loaded. It is re-exported because consumers
 * (e.g. `@_linked/documents`) already import it from this module.
 */
import type {PathExpr} from '@_linked/core/paths/PropertyPathExpr';

export type {PathExpr};

export type PropertyDetails = {
  id: string;
  label: string;
  /**
   * A SHACL property path. `PathExpr` covers a bare IRI string, a `{id}` node
   * reference, and the composite forms (`seq`, `alt`, `inv`, …). It replaces an
   * older `{id} | {id}[]`, whose bare-array arm had no callers and no `PathExpr`
   * equivalent — a sequence is spelled `{seq: [...]}`.
   */
  path: PathExpr;
  valueShape?: { id: string };
  datatype?: { id: string };
  description: string;
  maxCount?: number;
  minCount?: number;
  nodeKind?: { id: string };
  name?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minInclusive?: number;
  maxInclusive?: number;
  minExclusive?: number;
  maxExclusive?: number;
  inValues?: { id: string; label: string }[];
};

export type ShapeDetails = {
  id: string;
  label: string;
  description: string;
  targetClass?: { id: string };
  type?: { id: string };
  extends?: { id: string };
  properties: PropertyDetails[];
  numInstances?: number;
};
