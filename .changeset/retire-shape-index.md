---
'@_linked/server-utils': minor
---

Remove the `ShapeDetails` and `PropertyDetails` types and the in-memory shape index (`@_linked/server-utils/utils/ShapeIndex`: `shapeIndex`, `getShapeIndex`, `getShapeFromIndex`).

This release removes public API but is published as a minor version on purpose. No linked package uses these any more, and staying on the 1.x line means every dependent on `^1` still resolves to a single copy. `@_linked/server` stops filling the index in the same release (`indexShapesIntoMemory` is removed there).

Why: shape metadata is stored as SHACL and read as core's `NodeShapeWire` / `PropertyShapeWire`. `ShapeDetails` held only part of that metadata, and some of what it held was wrong: it stored complex property paths (sequences, alternatives, inverses) as an empty id, and it put `sh:class` into `valueShape`.

Migration:

- Replace the `ShapeDetails` / `PropertyDetails` types with `NodeShapeWire` / `PropertyShapeWire` from `@_linked/core/shapes/nodeShapeWire`.
- Instead of calling `getShapeIndex()` / `getShapeFromIndex(id)`, read shapes from your store, or from core's registry for compiled shapes (for example `getNodeShape(id)` from `@_linked/core/utils/ShapeClass`).
- If you imported `PathExpr` through the removed module, import it from `@_linked/core/paths/PropertyPathExpr`.
