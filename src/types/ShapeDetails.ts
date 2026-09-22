/**
 * Shape metadata — the versioned description of a project's shapes.
 *
 * Originally written for CMS UI display. As of plan-035 this is ALSO the extraction contract's
 * shape catalog: `FieldGraphInput.shapes` and `ExtractionSubmission.shapes` are `ShapeDetails[]`,
 * and an external extraction provider (ISA) is built against it. So it is a versioned contract,
 * not an internal view model — adding a field is fine, changing or removing one is a breaking
 * change for a third party and needs the same treatment as a `field-graph/v1` change.
 *
 * Still no graph-runtime dependency: these are plain, JSON-safe objects. The one structured
 * value is `PropertyDetails.path`, a `PathExpr` — itself a plain discriminated union, imported
 * as a TYPE only so nothing from `@_linked/core` is loaded at runtime. `PathExpr` is re-exported
 * here because consumers (e.g. `@_linked/documents`) already import it from this module.
 */
import type {PathExpr} from '@_linked/core/paths/PropertyPathExpr';

export type {PathExpr};

export type PropertyDetails = {
  /** The `sh:PropertyShape` NODE's IRI. NOT the predicate — see `path`. */
  id: string;
  label: string;
  /**
   * The full SHACL property path, at any complexity: a bare predicate IRI string, a `{id}` node
   * reference, a sequence, an alternative, an inverse, or a cardinality operator.
   *
   * Was `{id} | {id}[]`, which could not express inverse/alternative/cardinality at all and was
   * ambiguous between "a sequence" and "several paths" — and whose bare-array arm had no callers
   * and no `PathExpr` equivalent (a sequence is spelled `{seq: [...]}`). Consumers that need a
   * scalar identity for a property use `canonicalPathKey(path)`; NEVER use `id`, which names the
   * property-shape node rather than what it points at.
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
