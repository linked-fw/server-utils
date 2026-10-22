---
'@_linked/server-utils': minor
---

The ontology data ships as Turtle.

- `src/data/server-utils.json` is replaced by `src/data/server-utils.ttl` (the same 4 triples on
  `server-utils:Lincd_API_Client`: type, label, comment, `rdfs:isDefinedBy`), copied into
  `lib/esm/data/` by the build. The module exports `dataFiles`.
- **Breaking:** `loadData()` now resolves to the Turtle text (`string[]`, read through
  `@_linked/core/ontology/loadOntologyFiles`, server only) instead of the JSON-LD document, and
  `data/server-utils.json` is no longer in `lib/esm/`.
