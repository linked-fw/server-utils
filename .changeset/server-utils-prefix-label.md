---
'@_linked/server-utils': minor
---

The ontology's prefix label is now `server-utils`, matching its ontologySlug (the package's publicSlug) as every first-party ontology's prefix does. The namespace, `https://linked.cm/ont/server-utils/`, and every term IRI are unchanged, so this is a rename of labels and module paths only.

- The module is `ontologies/server-utils` (registered by `ontologies/server-utils.register`, data in `data/server-utils.json`), and its terms object is `serverUtils`.
- Full IRIs now compact to `server-utils:`. The JSON-LD `@context` key and its CURIEs moved with it.

Deprecated, still working: the `ontologies/lincd-server-utils` and `ontologies/lincd-server-utils.register` module paths (they re-export / load the new modules), the `lincdServerUtils` terms object (an alias of `serverUtils`), and the `lincd-server-utils` prefix, which still expands (`lincd-server-utils:X` → `https://linked.cm/ont/server-utils/X`) but is no longer what full IRIs compact to. Stored data under the old IRIs is not migrated; clear dev datasets.
