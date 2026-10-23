---
'@_linked/server-utils': minor
---

`QueryAccess` decides graph queries on the generic query plane. `QueryOperation` gains `'graph'`
(kinds `graph_create`, `graph_replace`, `graph_patch`, `graph_drop`), and `withAccess` takes a
third rule, `graph: 'none' | (ctx) => boolean`, whose context carries the caller (`request`,
`linkedAuth`), `graph`, `kind`, `recordClass`, `query`, `ir` and `store`. A graph query maps to the
store `LinkedStorage.graphQuery` routes its record class to (`storeForGraphQuery`). New exports:
`GraphQueryKind`, `GraphAccessContext`, `GraphAccessFunction`, `GraphAccessRule`,
`storeForGraphQuery`.

Breaking changes:

- A store without a `graph` rule refuses graph queries (403); there is no `'session'` default,
  and `withAccess` throws a `TypeError` for `graph: 'session'`.
- `QueryOperation` includes `'graph'`: code that maps every operation exhaustively must handle it.
  `QueryAccessContext.operation` (read and write rules) stays without it.
- A graph kind sent to any other operation, and a shape query sent as `'graph'`, is refused (400).
