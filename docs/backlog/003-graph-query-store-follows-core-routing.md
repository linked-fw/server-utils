---
summary: >
  `storeForGraphQuery` copies core's private `LinkedStorage.resolveDatasetForGraphQuery` (record
  class → first shape targeting it → its store, else the default). When core's graph routing
  changes (CN plan 071, K4: a dataset and a graph per shape), the access check must follow it, or
  it asks one store's rule while the query runs on another.
status: Open -- recorded with report 004 (CN plan 071); revisit with core's graph routing (K4)
---

# 003 — The graph-query store follows core's routing

Source: [report 004](../reports/004-graph-queries-in-query-access.md).

## Problem

`checkQueryAccess` asks the `graph` rule of the store a graph query runs on. Core does not export
how it picks that store (`LinkedStorage.resolveDatasetForGraphQuery` is private), so
`storeForGraphQuery` repeats it. Two copies of one routing rule drift: if core changes it (core
report 048 notes that an app shape targeting `sd:NamedGraph` or a core graph class could be picked
first; CN plan 071's K4 routes data to a dataset and a graph), the check consults the wrong store.

## First open questions

- Should core export the resolver (for example `LinkedStorage.getDatasetForGraphQuery(q)`), so
  `storeForGraphQuery` calls it and keeps no copy?
- With graph routing per shape, does a graph rule also need the routed graph set, or is the
  query's graph IRI enough?
- Add a parity test once a core with `LinkedStorage.graphQuery` is on npm: pin stub datasets with
  a recording `graphQuery`, run `LinkedStorage.graphQuery(q)` and assert it hit
  `storeForGraphQuery(q.recordClass)` (super-shape pin, unknown class, inside a catalog).
- `GraphQueryKind` and the `graph` kind set restate core's `GraphQueryKind` and
  `GRAPH_QUERY_KINDS`; once the core range includes them, import the type and build the set from
  core's list (a new core kind is a 400 here until then: fails closed, but drifts).
