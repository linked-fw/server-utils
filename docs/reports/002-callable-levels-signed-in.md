---
summary: >
  The `@callable` level for a provider method that needs a session is `'signed-in'`; `'user'`
  stays accepted as a deprecated alias treated exactly like it, and `getOwnCallableLevel` reports
  the level as declared. New `requiresSession(level)` answers whether a level needs a session.
  The README documents which provider methods a client may call (`@callable`, `@internal`,
  undeclared, `runAsSystem`). Released in 1.14.0.
---

# 002 — Callable levels: `'signed-in'`, and the README on what a client may call

## What was built

**README section ([#100](https://github.com/linked-fw/server-utils/pull/100)).** `readme.md`
gained "Which provider methods a client may call", which until then was documented only in
CHANGELOG entries:

- the three declarations from `@_linked/server-utils/utils/callable` (`@callable(level)` /
  `declareCallable`, `@internal()` / `declareInternal`, none) and a table of what each does over
  HTTP: public runs for anyone; signed-in answers 401 before the body runs without a session;
  undeclared depends on `@_linked/server`'s `server.rpcExposure` (`warn` runs and logs once,
  `enforce` answers 501); internal is never dispatched over HTTP (501);
- the rule, in bold: a method that acts for a signed-in user is declared `@callable('signed-in')`
  and reads the user with `requireSessionUser()`, never from its arguments;
- an example provider, the inheritance rules (an override keeps the strictest level up its class
  chain; `@internal()` is inherited and wins), and `runAsSystem` for work that is not done for the
  request's user.

linked-fw/server's README links to this section from its `server.rpcExposure` section, so both
packages point at one place.

**`'signed-in'` level (1.14.0, [#101](https://github.com/linked-fw/server-utils/pull/101)).**
In `src/utils/callable.ts`:

- `CallableLevel` is `'public' | 'signed-in' | 'user'`; the `'user'` member carries a
  `@deprecated` JSDoc. There is no runtime warning.
- `callable` / `declareCallable` accept `'signed-in'`; the unknown-level `TypeError` names
  `'public' or 'signed-in'`.
- The declaration is stored as written, so `getOwnCallableLevel` returns `'user'` for an old
  declaration. That keeps a mixed install (this version with an older `@_linked/server`) enforcing
  401 for existing `'user'` methods.
- New `requiresSession(level: CallableLevel | undefined): boolean`, true for `'signed-in'` and
  `'user'`. Callers use it instead of comparing level strings.
- `getUpdatesSince` (`src/backend.ts`) is declared `'signed-in'`.

## Why

`'signed-in'` names what the server checks for the level: that the request has a session. The
user itself always comes from the call context, never from the method's arguments. Keeping
`'user'` as an alias, stored as written, lets each consumer and `@_linked/server` move separately.

## Usage

```ts
import { callable, requiresSession, getOwnCallableLevel } from '@_linked/server-utils/utils/callable';
import { requireSessionUser } from '@_linked/server-utils/utils/CallContext';

class NotesBackendProvider extends BackendProvider {
  @callable('signed-in')
  getMyNotes() {
    return loadNotesOf(requireSessionUser());
  }
}

requiresSession(getOwnCallableLevel(NotesBackendProvider, 'getMyNotes')); // true
```

## Files

- `src/utils/callable.ts` — levels, `callable` / `declareCallable` / `internal` / `declareInternal`,
  `getOwnCallableLevel`, `requiresSession`. No imports, safe on the client.
- `src/backend.ts` — this package's own provider; `getUpdatesSince` is `'signed-in'`.
- `readme.md` — the section described above.

## Tests

- `src/utils/callable.test.ts` (jest): `'signed-in'` declarations, the deprecated `'user'` alias
  (stored and reported as written, `requiresSession` true), the unknown-level message.
- `test/live-updates.test.mjs`: updated to the `'signed-in'` declaration of `getUpdatesSince`.

## Known limits

- `'user'` is still accepted, with no runtime deprecation warning; only the type marks it.

## Follow-ups

- `@_linked/server` enforces and reports both spellings with `requiresSession`, and consumers
  move their declarations to `'signed-in'` (Create Now did so in
  https://github.com/Semantu/create-now/pull/163). Removing the `'user'`
  alias is a future major; no backlog item.

## PRs

- https://github.com/linked-fw/server-utils/pull/100 — README: which provider methods a client may call
- https://github.com/linked-fw/server-utils/pull/101 — `'signed-in'` level, `'user'` deprecated alias (1.14.0)
