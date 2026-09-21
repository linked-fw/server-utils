---
'@_linked/server-utils': minor
---

`PropertyDetails.path` is now `PathExpr` from `@_linked/core`.

It was `{id: string} | {id: string}[]`, which had drifted out of step with core:
every consumer passes the path to core helpers (`canonicalPathKey`,
`normalizePropertyPath`) that take a `PathExpr`, and did so behind casts because
the declared type did not match. `PathExpr` also admits a bare IRI string, which
is what the SPARQL readers actually produce.

`PathExpr` is re-exported from `types/ShapeDetails` — `@_linked/documents` already
imported it from here, an import that could not resolve before.

Technically breaking for anyone hand-constructing a `PropertyDetails` with the
array form `[{id}, {id}]`, which has no `PathExpr` equivalent (a sequence is
`{seq: [...]}`). A survey found no such caller: nothing in the ecosystem builds or
reads a path array. Every other previously-valid value stays valid, and values
that were already being passed — bare strings — become valid for the first time.

Imported as a TYPE only, so the module still loads no graph runtime.
