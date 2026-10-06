---
'@_linked/server-utils': major
---

Remove the `ShapeDetails` / `PropertyDetails` types and the in-memory shape index
(`utils/ShapeIndex`: `shapeIndex`, `getShapeIndex`, `getShapeFromIndex`).

The shape catalog lives in the store: apps read it as SHACL and project it to core's
`NodeShapeWire` / `PropertyShapeWire`. Nothing reads the in-memory index any more, and
`ShapeDetails` was a hand-enumerated subset of the shape metadata that lost complex property
paths (sequences, alternatives, inverses were indexed as an empty id) and folded `sh:class`
into `valueShape`.

Migration: type shape metadata as `NodeShapeWire` / `PropertyShapeWire` from
`@_linked/core/shapes/nodeShapeWire`, and read shapes from the store (or core's registry for
compiled shapes) instead of `getShapeIndex()`. `@_linked/server` 3.0.0 stops populating the
index (`indexShapesIntoMemory` is removed there).
