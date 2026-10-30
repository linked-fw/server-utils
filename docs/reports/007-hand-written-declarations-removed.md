---
date: 2026-10-30
summary: >
  Closes backlog 001 (hand-written `.d.ts` files in `src/utils/` shadowed their sources and shipped
  with drifted types). They are gone: commits 0369aaa (2026-09-25, `Server`, `LincdServerProxy`)
  and f704355 (2026-09-30, the rest); `tsc` emits every declaration.
---

# 007 — The hand-written declarations are gone

Was backlog 001. Fifteen hand-maintained `.d.ts` files sat beside their `.ts` sources in
`src/utils/`, took precedence over the emitted declarations and were published, so consumers
typed against a surface that had drifted (`CallConfig` without `rejectOnError`, `BackendProvider`
without `registerRoute`).

Commit 0369aaa (`fix(types): emit Server and LincdServerProxy declarations instead of shadowing
them`) and commit f704355 (`fix: delete the hand-written .d.ts files that shadow their sources`)
removed them, in one pass as the backlog asked. On `dev` (2026-10-30) no `.d.ts` is left in
`src/utils/`; the only one under `src/` is `src/types.d.ts`, an ambient declaration file with no
`.ts` sibling.
