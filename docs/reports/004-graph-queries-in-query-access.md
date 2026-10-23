---
summary: >
  `QueryAccess` decides graph queries (`graph_create`, `graph_replace`, `graph_patch`,
  `graph_drop`) on the generic query plane: operation `graph`, the target is the graph IRI, the
  query maps to the store `LinkedStorage.graphQuery` routes its record class to, and that store's
  `graph` rule (`'none'` or a function of caller, graph, kind and record class) decides. No rule →
  403; a graph kind on another endpoint → 400.
---

# 004 — Graph queries in `QueryAccess`

CN plan 071 (named graphs) adds `IDataset.graphQuery` (core report 048). The server's generic
plane will accept graph queries (server step V1) and CN's gateway checks them with a rule (C1).
This step gives `QueryAccess` the operation and the rule. CN plan 071's U1 section is the
sub-plan; nothing was redesigned.

## Tasks (two phases)

1. Operation `graph` in `QueryOperation` and `KINDS_BY_OPERATION`; `StoreAccess.graph`
   (`'none'` | function); `storeForGraphQuery`; the graph branch of `checkQueryAccess`; tests.
   Gate: `npx linked build && npm run test:calls`.
2. Changeset (minor, breaking changes listed), backlog 003, this report, independent review,
   full gate, landing.

## What was built

`src/utils/QueryAccess.ts`:

- `QueryOperation` gains `'graph'`; `KINDS_BY_OPERATION.graph` = the four kinds, so a graph kind
  on any other operation, and a shape IR on `'graph'`, is refused (400) by the existing check.
  `QueryAccessContext.operation` (read and write rules) is `Exclude<QueryOperation, 'graph'>`.
- `StoreAccess.graph?: GraphAccessRule` = `'none' | GraphAccessFunction`. No `'session'`: a
  signed-in session alone never writes a graph; `withAccess` throws a `TypeError` for it. The
  stored record keeps only `{read, write}` when no graph rule is given.
- `GraphAccessContext`: `operation: 'graph'`, `kind`, `graph`, `recordClass`, `query` (as sent),
  `ir` (the parsed `GraphQuery`), `store`, and the caller as `request` / `linkedAuth`, the same
  fields read and write rules get (the contract's "caller").
- `storeForGraphQuery(recordClass)`: the first shape targeting the class, its store through
  `LinkedStorage.getDatasetForShapeClass` (a pin of a super shape covers it), else the default
  store; resolved in the active catalog, exactly as core's private resolver does (backlog 003).
- `checkQueryAccess`, after the kind and "could not be analysed" checks: for `'graph'`, a query
  without a string `graph` or `recordClass` → 400 (401 anonymous); the routed store's rule
  missing or `'none'` → 403; a rule that throws a `ServerCallError` keeps its status, any other
  error → 403; anything but `true` → 403, or 401 without a session. Nothing after it (shape
  rules, client ids) applies. Calls outside an HTTP context are not checked, as before.

`test/query-access.test.mjs`, suite `graph queries` (16 tests): refused without a rule in both
modes, with and without a session, for every kind; `'none'`; read/write rules never decide;
allowed for every kind; the rule's context (caller, graph, kind, record class, store, query, ir);
a rule deciding by record class; refusal 403/401; thrown errors; routing through a super-shape
pin and to the default store for an unknown class; every graph kind on every other operation
400; shape IR on `'graph'` 400; malformed queries 400/401; not checked outside a request;
`withAccess` accepting `'none'`/function and rejecting `'session'`.

Breaking changes (changeset `graph-queries-access.md`, minor): graph queries need a `graph` rule;
`QueryOperation` includes `'graph'`; graph kinds on other operations are 400.

## Verification

Worktree `~/web/wt/u1/packages-local/_linked-server-utils` (`npx linked doctor resolve`:
server-utils `overlay`, core the main checkout's `named-graphs` tip 75162c1). Baseline before
the change: 95/95.

Quick gate after phase 1 and after the review fixes (`npx linked build && npm run test:calls`):

```
✔ Build successful with warnings
npx linked build  5.12s user 0.60s system 161% cpu 3.546 total
# tests 111
# suites 23
# pass 111
# fail 0
npm run test:calls  1.62s user 0.40s system 145% cpu 1.384 total
```

Full gate (`npm test` = `test:unit && test:calls`): `test:unit` is red as on `main` (backlog
002), so `test:calls`, the gate, ran alone (above):

```
Test Suites: 5 failed, 5 total
Tests:       0 total
npm test  6.01s user 1.33s system 315% cpu 2.324 total
```

The step's Verify (allowed, refused without a rule, wrong endpoint 400, rule sees
`recordClass`) is covered by the suite above. Results after rebasing onto `named-graphs` are in
the landing commit's gate run (below).

## Review

An independent read-only review (opus) of the diff against the U1 section and §Contracts. It
ran the suite itself (50/50 in the file). Verdict, quoted:

> Verdict: no open medium or high findings

Its five low findings:

- *The comment said the store resolves outside any catalog; core resolves the record shape in the
  active catalog.* Fixed: `storeForGraphQuery` now resolves in the active scope like core, and
  its comment says the server must check and run a graph query in the same scope (V1).
- *No parity test against core's actual routing* and *the kind list restates core's*: recorded in
  backlog 003 (core with `LinkedStorage.graphQuery` is not on npm yet, and CI installs from npm).
- *Backlog 003 linked this report before it existed*: this report.
- *The contract names `caller`; the code exposes `request`/`linkedAuth`.* Kept (same as read and
  write rules); the plan's §Contracts wording is for the master to align (reported).

## Follow-ups

- [Backlog 003](../backlog/003-graph-query-store-follows-core-routing.md): the store resolution
  copies core's private resolver; parity test; kinds from core. Revisit with core's graph routing
  (CN plan 071, K4).
- V1: pass `operation: 'graph'` with `ir` = core's `parseGraphQuery` result (undefined when it
  throws), and run `LinkedStorage.graphQuery` outside any shape catalog, as the check resolves.
- C1: CN's rule reads the caller from `ctx.linkedAuth` / `ctx.request`.
