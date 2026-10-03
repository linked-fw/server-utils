/**
 * Shape metadata — a DERIVED, LOSSY view of the shape metamodel, on its way out.
 *
 * @deprecated Read `NodeShapeWire` (`@_linked/core/shapes/nodeShapeWire`) instead. It is defined
 * by SUBTRACTION from `NodeShapeData` — drop the circular parent link, carry `sh:pattern` as its
 * source string — so it carries every field the metamodel has and cannot fall behind. This type
 * enumerates a subset BY HAND, which is exactly how it fell behind: it has no home for `order`,
 * `group`, `displayRank`, `displayHidden`, `contains`, `defaultValue`, `class` distinct from
 * `valueShape`, `hasValue`, `equals`, `disjoint`, `lessThan`, `lessThanOrEquals`, nor the
 * node-level `dependent` / `closed` / `ignoredProperties`. Retiring it is an agreed decision
 * (ideas-033 D7); `src/utils/shapeCatalogQuery.ts` derives it from the metamodel so the remaining
 * consumers can migrate one at a time.
 *
 * ## This header used to claim a third party was bound to it. That was not true.
 *
 * It said: *"`FieldGraphInput.shapes` and `ExtractionSubmission.shapes` are `ShapeDetails[]`, and
 * an external extraction provider (ISA) is built against it. So it is a versioned contract."*
 * Both halves have stopped holding, and the claim sent at least one investigation off from the
 * wrong premise, so it is worth saying plainly what is and is not the case:
 *
 *  - Those two fields are `NodeShapeWire[]` as of `field-graph/v2.4`. This type is not in the
 *    extraction contract at all any more.
 *  - No external system consumes it over a wire. The ISA transport is an interface with no
 *    implementation in this workspace, and the ISA handover (plans/037) has been PARKED since
 *    2026-08-25 — the studio runs on a simulated model.
 *
 * So it is an internal view model, not a versioned third-party contract, and a change here needs
 * no third-party treatment. If ISA unparks, the contract it binds to is `field-graph`'s own
 * `NodeShapeWire`, not this.
 *
 * Still no graph-runtime dependency: these are plain, JSON-safe objects. The one structured
 * value is `PropertyDetails.path`, a `PathExpr` — itself a plain discriminated union, imported
 * as a TYPE only so nothing from `@_linked/core` is loaded at runtime. `PathExpr` is re-exported
 * here because consumers already import it from this module.
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
