---
"@_linked/server-utils": major
---

The ontology is registered by `src/ontologies/index.ts` (core's `registerOntologies`), which the package entry imports; the package registers no prefix (an app's prefix map, `linked.app.json`, holds the prefixes; the ontology's data suggests one). `src/package.ts` exports `registerOntologies` instead of `linkedOntology`. Requires the `@_linked/core` major with `registerOntologies`. Removed: `ontologies/server-utils.register`, `ontologies/lincd-server-utils.register`, the `dataFiles` and `loadData` exports of `ontologies/server-utils`, and the `server-utils` and deprecated `lincd-server-utils` prefixes (`server-utils` is not a valid prefix in an app map; the builder maps the namespace to `server_utils`).

`AppRoot` no longer adds the `APP_PREFIX` → `DATA_ROOT` prefix when imported: the app's prefix map (`linked.app.json`) is the one map, and an import-time addition could override one of its prefixes. An app that uses its data-root prefix lists it in its `linked.app.json`.
