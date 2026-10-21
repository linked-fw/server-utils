---
summary: >
  Bulk mutations on the generic query plane (`deleteAll`, `deleteWhere`, `update().forAll()` and
  `update().where()`) are authorized over every sub-shape they reach: the root shape plus every
  registered shape whose class is in core's `subClassesOf(root class)`, each store's rule must
  allow it, and a bulk mutation whose shapes route to more than one store is refused with
  `409 bulk-mutation-spans-stores: …`. Shapes and stores resolve in the query's shape catalog.
---

# 003 — Bulk mutations authorized over sub-shapes

CN plan 070 (the store infers RDFS classes) makes bulk mutations polymorphic, like select and
count: a `deleteAll` on `C` deletes every instance of every subclass of `C`. The access check of
the generic query plane only looked at the root shape, so a caller allowed on `C` could change
nodes of a sub-shape whose store refuses them. This report records the fix.

## What was built

`src/utils/QueryAccess.ts`:

- **`bulkSubShapes(rootShape)`** (exported): the root plus every registered shape whose target
  class is in `subClassesOf(<root's target class>)` (`@_linked/core/ontology/classHierarchy`,
  the shape tree's edges unioned with the ontology triples once set). Empty for a root without a
  target class.
- **`checkQueryAccess`**, for IR kinds `delete_all`, `delete_where`, `update_where`:
  - the sub-shapes join the decider shapes *after* the ancestor filter of `deciderShapes` (which
    would otherwise drop the root as the super shape of its own sub-shapes);
  - every store they route to must satisfy its rule, as for any other decider shape;
  - a function rule receives them in `ctx.shapes` (the touched shapes plus the sub-shapes);
  - after every 401/403 check, when the root and its sub-shapes route to more than one store
    object, the call is refused with `ServerCallError(409, 'bulk-mutation-spans-stores: <root>
    spans <n> stores (<shapes of store 1>; <shapes of store 2>)')`. Store identity is by object
    (two store objects on one endpoint are two stores). No `code` field: the code is the
    message's prefix. The span set is the root and its sub-shapes only; a shape a `where` filter
    traverses into is checked for access but does not count as a store the mutation changes.
- **Catalog scope.** The decider shapes, the sub-shapes and their stores are resolved inside
  `withShapeCatalog(catalogOf(ir), …)`, the scope `LinkedStorage.resolveDatasetForQuery` routes
  the query in. The server's `authorizeGenericQuery` calls `checkQueryAccess` outside the
  query's catalog, so before this change a shape that exists only as data in a catalog (CN's
  data-only shapes) was unknown to the check and mapped to the default store. That gap is
  closed for every query, not only bulk ones: resolving the sub-shapes in the catalog and the
  root outside it would compare stores from two registries and could refuse a single-store bulk
  mutation as spanning. `collectQueryTargets` still runs outside the catalog (unchanged).
- Module and `QueryAccessContext.shapes` comments describe the rule.

Leaf shapes are unchanged: their sub-shape set is the root alone, so nothing new is checked.
Selects, counts and asks are untouched (a select over a super shape already routes by the root).

## Tests

`test/query-access.test.mjs`, new `bulk mutations` suite (9 tests, fixtures `Thing ← Person,
Account`, `Secret ← SubSecret`):

- a caller allowed on `Thing` but whose `Person` store says `write: 'none'` is refused (403)
  `delete_all`, `delete_where` and `update_where` on `Thing`; 401 without a session;
- a function rule sees `Thing`, `Person`, `Account` (not `Secret`) in `ctx.shapes` for all three
  kinds; a leaf root (`Account`) reaches no other shape;
- `Person` pinned to another (rule-less) store: all three kinds answer 409 with the
  `bulk-mutation-spans-stores: ` prefix naming `Thing` and `Person`; unpinned, the call passes;
- a function rule on `Person`'s own store object is asked (with `ctx.store` that object and
  `Person` in `ctx.shapes`) and its `false` refuses the `delete_all` on `Thing`;
- the 403 of a refusing sub-shape store wins over the 409;
- leaf shapes: `delete_all`/`delete_where` on `Person` with `Thing`'s store refusing writes pass;
- ontology triples count: after `setOntologyHierarchy([Secret ⊑ Thing])`, `delete_all Thing`
  reaches `Secret` and `SubSecret` (403, then 409 naming `SubSecret`);
- a sub-shape that exists only in the IR's `ShapeCatalog` is seen (verified to fail with the
  catalog scope removed from the built output);
- selects and counts over `Thing` with `Person`'s store refusing reads are unchanged.

## Verification

GATE_PLACEHOLDER

## Review

An independent read-only review (opus) of commit 01bc937 against plan 070's decision 20, its
U1 section and §Contracts (Bulk access, Class hierarchy in memory). Verdict, quoted:

> Verdict: No open medium or high findings.

On the catalog judgement call it said: "I think it is correct and safer than before. [...] A
catalog query naming a shape IRI that is also pinned globally made the check consult the pinned
store's rule, while the query actually ran on the default dataset, whose rule was never
consulted. Now the check and the execution agree."

Its five low findings and what became of them:

- *A root with no target class reaches no sub-shapes* (only the root is checked). Kept: such a
  root has no class for the store to infer over, so core's bulk lowering has no class pattern to
  widen. Not covered by a test.
- *An ontology subclass with no registered shape* is changed by the inferring store without any
  rule being asked for it. That is the contract's "registered shape" scope: such nodes route to
  the root's store by class anyway, and decisions 13-16 keep the shape tree in step with the
  class tree.
- *The 409 lists sub-shape IRIs per store* rather than store names: store objects have no name
  to report, and the message is reached only after every involved store's rule admitted the
  caller. Kept; the prefix and the "<root> spans <n> stores" form follow the contract.
- *The catalog fix should be stated plainly*: done in this report (What was built) and in the
  changeset.
- *Test gaps*: a function rule on a sub-shape's own store object was added. Not added: a
  non-bulk catalog query on a globally pinned IRI, two shapes of one class in different stores
  (covered by the same code path as the cross-store test).

## Follow-ups

- `package.json` still allows `@_linked/core ^2.36.2`; `@_linked/core/ontology/classHierarchy`
  ships in core's next release. The range is raised at plan 070's release step (R), where every
  repository's ranges move to the released versions.
- The jest suite (`npm run test:unit`) fails all 5 suites in the localized worktree layout
  (`SyntaxError: Unexpected token '['` from untranspiled TypeScript under babel-jest), on the
  unmodified tree too (plan 070 records it as pre-existing). Not addressed here.
