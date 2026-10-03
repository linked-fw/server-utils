---
'@_linked/server-utils': minor
---

Access on the generic query plane is now declared per store, in the storage config, instead of through a shape registry, authorizers and a protected-node lookup.

**This access model is interim. It needs to be revised and rethought from the ground up.** It is coarse on purpose: a rule covers a whole store and answers per operation, so a store a caller may write can be written anywhere, and a rule cannot see which nodes a query will match.

- `withAccess(store, {read, write})` declares who may query a store through the generic plane (`/call/@_linked/server/*Query` and `LincdAPI` `/api/*`) and returns the store, so it can wrap the store where `linked.backend.storage.js` creates it. A rule is `'none'` (403), `'session'` (401 without a session) or a function `(ctx) => boolean | Promise<boolean>` that receives `{operation, query, ir, shapes, propertyShapes, store, request, linkedAuth}`; `false` answers 403 (401 without a session), and a thrown `ServerCallError` keeps its status. `getStoreAccess(store)` reads it back.
- A store with no rule, or no rule for the operation, requires a session. In `rpcExposure: 'warn'` an anonymous read under that implicit default is still only logged; declared rules and mutations are enforced in every mode.
- `checkQueryAccess` maps a query to stores with the same shape→store routing `LinkedStorage` runs it with: the root shape, every written shape, and every other shape it touches except a super shape that only owns an inherited property. The query must satisfy the rule of every store it maps to.
- Queries backend code runs itself are not affected; only calls inside an HTTP context are checked.
- Kept: the operation/kind match (400), an unanalysable query (400), the refusal of client-chosen ids for new nodes (403, now `collectClientIds`), and the `rawQueries` setting for raw SPARQL.
- Removed: `registerProtectedShapes`, `registerQueryAuthorizer`, `getProtectedShapeIds`, `getProtectedClassIds`, `getQueryAuthorizers`, `collectMutationNodes`, `getContainsPredicates`, the `ProtectedNodeCheck`/`ProtectedNodeProbe` types, `QueryAuthorizationContext`/`QueryAuthorizer`/`QueryDenyMode`, and the `probeProtectedNodes` option of `checkQueryAccess`. Apps that registered protected shapes or authorizers move those rules onto their stores with `withAccess`. Two groups of shapes that need different rules need two store objects (they may point at the same dataset).
