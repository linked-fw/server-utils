---
'@_linked/server-utils': minor
---

Remove the `ShapeDetails` / `PropertyDetails` types and the in-memory shape index
(`utils/ShapeIndex`: `shapeIndex`, `getShapeIndex`, `getShapeFromIndex`).

This is a removal shipped as a minor release, by decision: nothing in the linked ecosystem reads
these any more, and keeping `@_linked/server-utils` on the 1.x line lets every dependent on `^1`
keep resolving to a single copy. If you still import any of them, follow the migration below.

The shape catalog lives in the store: apps read it as SHACL and project it to core's
`NodeShapeWire` / `PropertyShapeWire`. Nothing reads the in-memory index any more, and
`ShapeDetails` was a hand-enumerated subset of the shape metadata that lost complex property
paths (sequences, alternatives, inverses were indexed as an empty id) and folded `sh:class`
into `valueShape`.

Migration: type shape metadata as `NodeShapeWire` / `PropertyShapeWire` from
`@_linked/core/shapes/nodeShapeWire`, and read shapes from the store (or core's registry for
compiled shapes) instead of `getShapeIndex()`. The `PathExpr` type, which the removed module
re-exported, is imported from `@_linked/core/paths/PropertyPathExpr`. `@_linked/server` stops
populating the index in the same release line (`indexShapesIntoMemory` is removed there).
