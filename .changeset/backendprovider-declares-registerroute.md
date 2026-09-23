---
---

No change to the published package.

`src/` is not in the published files, and `lib/esm/utils/BackendProvider.d.ts`
is emitted from the source, so it has always declared `registerRoute` and
`disposeRoutes` correctly. The hand-written `src/utils/BackendProvider.d.ts`
this fixes shadows the source only for consumers that resolve through the
`development` condition — workspace and in-repo builds. Those were broken; npm
consumers never were.

Recorded as an empty changeset so the release stays honest rather than cutting
a version whose artifact is byte-identical.
