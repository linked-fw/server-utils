---
'@_linked/server-utils': patch
---

`CallConfig.rejectOnError` is now visible to consumers.

The option has existed and worked for some time, but `src/utils/LincdServerProxy.d.ts` — a
hand-maintained declaration that shadows `LincdServerProxy.ts` — never gained the field. The
build copies that file into `lib/`, so the published package advertised a `CallConfig` without
it, and any consumer passing `rejectOnError` got a type error for a feature that works.

This patches the one field. The wider problem — fifteen hand-written `.d.ts` files in
`src/utils/` that shadow their sources and drift from them — is recorded in
`docs/backlog/001-hand-written-declarations-shadow-the-source.md`.
