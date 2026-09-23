---
summary: >
  Fifteen hand-maintained `.d.ts` files sit beside their `.ts` sources in `src/utils/`.
  They shadow the real types, drift from them, are copied into `lib/` by the build, and are
  PUBLISHED that way — so consumers type against a surface that does not match the code.
  `CallConfig` is missing `rejectOnError` on npm today, and `BackendProvider` is missing
  `registerRoute` entirely.
---

# 001 — Hand-written `.d.ts` files shadow (and misdescribe) the source

**Status:** open. One field patched to unblock other work; the pattern itself is untouched.

## What is there

`src/utils/` contains fifteen `.d.ts` files, each named after a `.ts` file beside it:

```
BackendProvider  Backup  Frontend  ImageResize  JSONParser  JSONWriter
LincdServerProxy  LinkedEmail  LinkedLiveUpdates  RequestData  Server
ServerPaths  ShapeIndex  ShapeProvider  Upload
```

TypeScript emits declarations from source. These are written by hand, so nothing keeps them in
step — and because a hand-written `.d.ts` takes precedence over generating one from the sibling
`.ts`, **they are what consumers actually see.** The build copies them into `lib/esm/utils/`, and
they ship.

## Two measured examples

**`CallConfig` is missing `rejectOnError`.** The source declares it
(`src/utils/LincdServerProxy.ts:33`) with documentation; the declaration
(`src/utils/LincdServerProxy.d.ts`) stops at `forceFetch`. Verified in the **published** package —
unpacking `@_linked/server-utils@1.4.3` from npm shows the same gap. So today, any consumer
calling:

```ts
Server.call(target, {method: 'selectQuery', rejectOnError: true}, json)
```

gets `Object literal may only specify known properties, and 'rejectOnError' does not exist in
type 'CallConfig'` — for a feature that exists, works, and is relied upon. `@_linked/server`'s
`BackendAPIStore` has been failing to typecheck locally for exactly this reason.

**`BackendProvider` is missing `registerRoute` entirely.** The source mentions it 5 times; the
declaration, zero. That is the mechanism by which every package registers express routes at
server start-up — a central part of this package's API, invisible to typed consumers.

A rough count suggests the drift is general rather than isolated: `BackendProvider.ts` has
roughly 15 member-ish declarations against 6 in its `.d.ts`; `Server.ts` about 8 against 0.

## Why it matters beyond the two fields

The failure mode is quiet and asymmetric. Locally, a workspace consumer may resolve source and
compile fine; in CI, where the package is installed from the registry, it resolves the stale
declaration — or vice versa. Either way the disagreement shows up far from its cause, as a type
error in someone else's package, and the natural reaction is to work around it with a cast. Every
such cast is a small permanent lie.

It is also the same class of bug as `@_linked/server-utils`'s own `types/ShapeDetails.d.ts`, which
had to be edited by hand alongside `ShapeDetails.ts` when `PropertyDetails.path` changed — the
edit would otherwise have been shadowed.

## What to do

The fix is to **delete them and let `tsc` emit declarations**, which is presumably why
`declaration: true` exists in the first place. The work is in checking that nothing depends on a
hand-written detail the generator would not produce — an intentional widening, a type the source
does not export, an ambient declaration. Fifteen files, most of them small.

Worth doing in one pass rather than field by field: patching individual fields as they bite
(as was just done for `rejectOnError`) keeps the pattern alive and hides how far it has drifted.
