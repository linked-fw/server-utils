---
'@_linked/server-utils': patch
---

Delete the hand-written `src/utils/Server.d.ts` and `src/utils/LincdServerProxy.d.ts` so the
declarations are emitted from the `.ts` sources instead.

Both files shadowed their own source and had drifted, and because they sit next to the source they
were copied over the correctly emitted `lib/esm/**/*.d.ts` on every build. The published types
therefore omitted `Server.removeDefaultHeaders`, `LincdServerProxy.removeDefaultHeaders`,
`LincdServerProxy.UNAUTHENTICATED_ACTION` and the `ServerCallError` re-export, all of which the
implementation has. No runtime code changes; this is a type-surface fix only.
