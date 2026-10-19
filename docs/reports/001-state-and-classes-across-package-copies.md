---
summary: >
  Every piece of state that callers set on this package (Server's local server, proxy headers,
  auth and action handlers, the email provider, the live-update log, request data) lives on
  `globalThis` via core's `sharedState`, so two evaluated copies of a module share it.
  `ServerCallError` is branded and matched with `isLinkedError` / `ServerCallError.is`.
  `JSONWriter` and `LincdServerProxy` recognise core's `Shape`, `ShapeSet` and `CoreSet` from
  another installed copy of core with `isLinkedInstance` instead of `instanceof`.
  Released in 1.13.0 and 1.14.1.
---

# 001 — State and classes across package copies

## What was built

**Shared state (1.13.0, [#98](https://github.com/linked-fw/server-utils/pull/98)).** Module-level
state that callers set is stored in a `sharedState('@_linked/server-utils', '<Module>', init)`
container from `@_linked/core/utils/sharedState`, keyed on `globalThis`. The public API did not
change: the former statics are getters/setters over the container.

| Module | State moved to `sharedState` |
| --- | --- |
| `src/utils/Server.ts` | the proxy and its `localServer` (`Server.setLocalServer`) |
| `src/utils/LincdServerProxy.ts` | `defaultHeaders`, `authHandler`, `actionHandlers` |
| `src/utils/LinkedEmail.ts` | the default provider (`LinkedEmail.setDefaultProvider`) |
| `src/utils/LinkedLiveUpdates.ts` | `updates` (the log) and `LinkedLiveUpdate.batchedUpdates` |
| `src/utils/RequestData.ts` | the request data |

**Branded `ServerCallError` (1.13.0).** `src/utils/ServerCallError.ts` calls
`brandLinkedError(ServerCallError, '@_linked/server-utils', 'ServerCallError')`.
`ServerCallError.is(err)` checks the brand first and keeps the older `name === 'ServerCallError'`
plus numeric `status` check for errors thrown by a copy that predates the brand.

**Core classes from another copy of core (1.14.1, [#103](https://github.com/linked-fw/server-utils/pull/103)).**
`src/utils/JSONWriter.ts` and `src/utils/LincdServerProxy.ts` (`getShapeClass`,
`getInstanceNode`) used `instanceof Shape | ShapeSet | CoreSet`, so a value made by a second
installed `@_linked/core` was serialised as a plain object. They now use `isLinkedInstance` from
`@_linked/core/utils/linkedError`. The Shape-class check is `isShapeClass` in `JSONWriter.ts`: it
matches `Shape` itself, any subclass, and the other copy's `Shape` (whose prototype carries the
`@_linked/core:Shape` brand as an own property). After this, `grep -rn instanceof src` shows only
built-ins (`Date`, `Map`) and a comment.

## Why

Under `linked start` a module can be evaluated twice (Vite's SSR runner and Node), and a consumer
can end up with two installed copies of core. `LinkedServer` set the local server on one copy of
`Server`; a `RemoteDataset` without a `url` called `Server.call` on the other copy, which had no
local server. Headers, the auth handler and action handlers were missing the same way, and
`instanceof` failed for errors and core values from the other copy. This applies the convention in
linked-fw/cli's
[shared state and error brands](https://github.com/linked-fw/cli/blob/main/docs/architecture/shared-state-and-error-brands.md)
doc (cli backlog 017). The `instanceof` gap on core classes was found in the cli report 020 survey
and fixed once core 2.36.2 branded `Shape`, `ShapeSet` and `CoreSet`.

## Usage

```ts
import { isLinkedError } from '@_linked/core/utils/linkedError';
import { ServerCallError } from '@_linked/server-utils/utils/ServerCallError';

try {
  await Server.call(target, {method: 'getMyNotes'});
} catch (err) {
  if (isLinkedError(err, ServerCallError) /* or ServerCallError.is(err) */) {
    if (err.status === 401) signIn();
  }
}
```

New code in this package keeps caller-set state in `sharedState` and checks core classes and
linked errors by brand, never with `instanceof`. The README section "Shared state and error
brands" says so.

## Dependencies

`@_linked/core` `^2.36.0` in 1.13.0 (for `sharedState` and `brandLinkedError`), raised to
`^2.36.2` in 1.14.1 (the release that brands `Shape`, `ShapeSet` and `CoreSet`).
`jest.config.cjs` maps `@_linked/core/utils/(sharedState|linkedError)` to core's built ESM files,
because core's export map is `import`-only and jest's CJS resolver cannot follow it.

## Tests

`test/two-copies.test.mjs` (node test runner, against the built `lib/`) imports each module twice
(`?copy=a`, `?copy=b`, distinct module instances; it asserts the classes differ) and shows:

- the local server, default headers, auth handler, action handlers, email provider, live-update
  log and request data set through one copy are seen by the other;
- a `ServerCallError` from one copy fails `instanceof` but matches `isLinkedError` and
  `ServerCallError.is`;
- `JSONWriter` serialises a `Shape` instance, a subclass, the other copy's `Shape` class, a
  `ShapeSet` and a `CoreSet` loaded from a `?copy` of core, and treats plain classes and objects as
  plain. Against the pre-#103 source this suite fails (`not ok 21`).

## Known limits

- An error from a copy older than 1.13.0 carries no brand; only `ServerCallError.is` (name/status
  check) recognises it, `isLinkedError` does not.

## Follow-ups

None in this repo.

## PRs

- https://github.com/linked-fw/server-utils/pull/98 — shared caller-set state, branded `ServerCallError` (1.13.0)
- https://github.com/linked-fw/server-utils/pull/103 — `isLinkedInstance` for core classes (1.14.1)
