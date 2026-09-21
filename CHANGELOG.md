# @\_linked/server-utils

## 1.3.0

### Minor Changes

- [#30](https://github.com/linked-fw/server-utils/pull/30) [`056622e`](https://github.com/linked-fw/server-utils/commit/056622ed5120d5876ac28d26418c189d6a9f1aee) Thanks [@flyon](https://github.com/flyon)! - Html: add `crossorigin="anonymous"` to route asset links whose origin differs
  from the page's, so releases served from a CDN preload and load correctly. The
  preload and the stylesheet for one href always make the same decision, so a
  cross-origin stylesheet is never fetched twice. Same-origin hrefs are rendered
  exactly as before — nothing changes for apps that serve their own assets.

  The pre-hydration CSS check now treats a `SecurityError` from `sheet.cssRules`
  as "ready" instead of "not ready": a cross-origin sheet without CORS can never
  be inspected, and waiting on it only held the loader up until the 2s fallback.

## 1.2.1

### Patch Changes

- [#28](https://github.com/linked-fw/server-utils/pull/28) [`7dc41b8`](https://github.com/linked-fw/server-utils/commit/7dc41b87a2cb73f50da4fa0f9b13b8eb600eaa65) Thanks [@flyon](https://github.com/flyon)! - Declare npm as the package manager for this repo, convert the build scripts off `yarn`, and mark `package-lock.json` as a generated file.

## 1.2.0

### Minor Changes

- [#24](https://github.com/linked-cm/server-utils/pull/24) [`136984c`](https://github.com/linked-cm/server-utils/commit/136984ce0f0bcbf92451a0bf551139e0a81d900f) Thanks [@flyon](https://github.com/flyon)! - Add an opt-in to reject failed server calls. Pass `{ method, rejectOnError: true }` to `Server.call` (or `LincdServerProxy.call`) and a non-2xx response rejects with a `ServerCallError` carrying the HTTP `status` and the server's `{error}` message, instead of resolving `undefined`. On the backend's local server path the opt-in rejects an unmatched call with status 501 and wraps a provider error as status 500. Without the opt-in, behaviour is unchanged. `ServerCallError` is exported from `utils/Server` and `utils/LincdServerProxy`.

## 1.1.1

### Patch Changes

- [#19](https://github.com/linked-cm/server-utils/pull/19) [`db0e6b9`](https://github.com/linked-cm/server-utils/commit/db0e6b999ef34acf69bd283d6717e35f8bb8249e) Thanks [@flyon](https://github.com/flyon)! - Pin `AppContext` on `globalThis` so module re-evaluation cannot fork it.

  The dev server loads this module on two different lifecycles: `LinkedServer`
  imports `AppContextProvider` statically and is instantiated once at boot, while
  the consumers below it (`AppRoot`, `Html`) arrive via
  `vite.ssrLoadModule('/src/App.tsx')`, which is re-evaluated on every full SSR
  invalidation. Because `server-utils` is bundled into the SSR graph, a bare
  `createContext` call then handed the consumers a NEW context object while the
  provider still held the boot-time one. `useAppContext()` found no matching
  provider, returned null, and every SSR render threw "Cannot destructure property
  'isNativeApp' of useAppContext()".

  The stale provider is pinned inside the long-lived server object, so this never
  recovered on its own: a single HMR page reload could flip a working dev server
  into serving 500s on every request until the process was restarted. It also
  presented as a bare "SSR timed out" rather than the real error, because
  `onShellError` did not answer the request (fixed separately in `@_linked/server`).

  Pinning the context object on `globalThis` keeps provider and consumer on one
  context across re-evaluations.

## 1.1.0

### Minor Changes

- [#17](https://github.com/linked-cm/server-utils/pull/17) [`41db1b2`](https://github.com/linked-cm/server-utils/commit/41db1b20d5e17e313359db9d06edb21762ca53bb) Thanks [@flyon](https://github.com/flyon)! - - `Server.call` now retries transient failures (connection-level rejections and 502/503/504) with exponential backoff, so a dropped socket / gateway blip under load no longer fails the request hard. 4xx and plain 500 are not retried (the server already processed the request).
  - Published **ESM-only** (dropped the CJS build). No CJS `require` consumers remained; this matches the rest of the `@_linked/*` fleet and lets the build resolve `@_linked/core`'s `exports` map.

## 1.0.10

### Patch Changes

- [#15](https://github.com/linked-cm/server-utils/pull/15) [`66ff3b0`](https://github.com/linked-cm/server-utils/commit/66ff3b0c6284025776527700f8d782ace447aec2) Thanks [@flyon](https://github.com/flyon)! - `Server.removeDefaultHeaders(...names)` / `LincdServerProxy.removeDefaultHeaders(...names)` — remove default headers previously set via `addDefaultHeaders` (used by scoped request contexts like CN's DataRouting to tear down routing headers on unmount).

## 1.0.9

### Patch Changes

- [#12](https://github.com/linked-cm/server-utils/pull/12) [`ce41a57`](https://github.com/linked-cm/server-utils/commit/ce41a57f2f80ed22d0f164b89216ba14a3a48254) Thanks [@flyon](https://github.com/flyon)! - `BackendProvider` gains `registerRoute(method, path, ...handlers)` + `disposeRoutes()` — register express routes/middleware that are tracked and torn down on HMR reload (so backend source changes don't stack duplicate middleware). Used by `@_linked/auth`'s `dispose()`. Fixes `this.registerRoute is not a function` on boot.

  Also: `Server.ts` re-exports `CallConfig` with `export type` (it's an interface) — fixes the runtime ESM error "does not provide an export named 'CallConfig'".

## 1.0.8

### Patch Changes

- [#8](https://github.com/linked-cm/server-utils/pull/8) [`9dcc606`](https://github.com/linked-cm/server-utils/commit/9dcc606d44be53d3ef7cda0339269c3aa6d06019) Thanks [@flyon](https://github.com/flyon)! - loadData: ESM-only JSON import — drop the dead CJS branch, add the `{ with: { type: 'json' } }` import attribute.

## 1.0.7

### Patch Changes

- [#9](https://github.com/linked-cm/server-utils/pull/9) [`5967596`](https://github.com/linked-cm/server-utils/commit/59675969a08827982106e82c7c42e3fab517b7e6) Thanks [@flyon](https://github.com/flyon)! - Serialization: replace removed `CoreMap` with native `Map` (core dropped CoreMap in `b2de3ad`). Fixes `Cannot find module @_linked/core/collections/CoreMap` on a clean install.

## 1.0.6

### Patch Changes

- [#5](https://github.com/linked-cm/server-utils/pull/5) [`88cb730`](https://github.com/linked-cm/server-utils/commit/88cb730784ceffabb187d44eb3b8d3279e38aac5) Thanks [@flyon](https://github.com/flyon)! - Rebuild + republish. The 1.0.5 tarball was missing all `.js` files (only `.d.ts` shipped) because `yarn linked build` was silently failing inside CI at the dual-package step. Switch to the explicit per-step build pattern that `@_linked/cli` itself uses (`rimraf && build-esm && build-cjs && copy-to-lib && dual-package`), which fails loudly per step and produces complete `lib/esm/` + `lib/cjs/` output with their dual-package `package.json` markers.

## 1.0.5

### Patch Changes

- [#4](https://github.com/linked-cm/server-utils/pull/4) [`620ff0f`](https://github.com/linked-cm/server-utils/commit/620ff0f7b815ceb19117a78ec7fc4fb5191a5916) Thanks [@flyon](https://github.com/flyon)! - `initFrontend` now returns `Promise<void>` (was `Promise<unknown>`), so callers can await it without an explicit cast.

  Also: the `build` script now requires `lib/esm` and `lib/cjs` to exist after compile, so a silently-failing build no longer produces an empty published tarball.

- [`6965162`](https://github.com/linked-cm/server-utils/commit/696516211de3a2a8b5b1f863f118b467c18330ee) - `LincdServerProxy.parseShape`: prefer the `packageName` stored on the shape constructor (set by `@_linked/core` during `linkedPackage()` registration) instead of extracting it from the URI. The URI form passes through `URI.sanitize` which is lossy (`@_linked/server` → `-_linked-server`), so the sanitized segment can't round-trip as a Node module specifier. Falls back to URI parsing for shapes predating the `packageName` property.

  Also: restore previously-deleted `src/types.d.ts` (CSS module declarations) needed by tsconfig.

## 1.0.4

### Patch Changes

- [`887c3cc`](https://github.com/linked-cm/server-utils/commit/887c3cca90a0dddbc14b70088302b0459da36e0d) - Initial release under the new publishing setup.
