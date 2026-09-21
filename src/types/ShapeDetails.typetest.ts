/**
 * Compile-time assertions for `PropertyDetails.path`.
 *
 * There is no unit-test runner for types here — `tsc` IS the test. This file is
 * type-checked by the ordinary build, so a regression in the `path` type fails
 * `npm run build`. It emits an unused empty export and nothing else.
 */
import type {PropertyDetails} from './ShapeDetails.js';

type Path = PropertyDetails['path'];

// A bare IRI string — what the SPARQL readers actually bind.
const acceptsBareIri: Path = 'http://schema.org/name';

// A node reference — what the DSL reader produces.
const acceptsNodeRef: Path = {id: 'http://schema.org/name'};

// A composite path. Sequences are `{seq: [...]}`, never a bare array.
const acceptsSequence: Path = {
  seq: [{id: 'http://schema.org/a'}, {id: 'http://schema.org/b'}],
};

// An inverse path, to pin that the whole PathExpr union is reachable here.
const acceptsInverse: Path = {inv: {id: 'http://schema.org/member'}};

// The dropped arm. `{id}[]` was the old type's second member and has no PathExpr
// equivalent; this assertion documents that removing it was deliberate.
// @ts-expect-error a bare array is not a PathExpr — use {seq: [...]}
const rejectsBareArray: Path = [{id: 'http://schema.org/a'}];

export const __shapeDetailsTypeAssertions = [
  acceptsBareIri,
  acceptsNodeRef,
  acceptsSequence,
  acceptsInverse,
  rejectsBareArray,
] as const;
