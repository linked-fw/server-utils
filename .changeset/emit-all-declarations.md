---
'@_linked/server-utils': patch
---

Declarations are now always emitted from the source. Twenty-six hand-written `.d.ts` files sat next to the `.ts`/`.tsx` they described; `linked build` copies `src/**/*.d.ts` into `lib/esm` after compiling, so under it they replaced the emitted declarations, and four had drifted — `index` (missing the `shapes/index` and `ServerCallError` imports), `types/RouteConfig`, `types/ShapeDetails` (the old `path` type) and `utils/BackendProvider` (no `registerRoute`). They are deleted; `src/types.d.ts`, the ambient CSS-module declarations, stays.
