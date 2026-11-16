---
summary: A third call context, `delegated`, for work done for a known user through something acting on their behalf (a connected agent, an integration). The user is the session user; the generic query plane checks the call instead of trusting it. Two repositories: server-utils (the context and the access check) and server (the transaction caller).
status: Implementation
packages: [server-utils, server]
---

# 001 — A delegated call context

## The gap

A call context is `http` (a request, with its session) or `system` (no user). Backend code that acts **for a user but not inside that user's request** has neither. Example: an endpoint that authenticates a per-connection key, then runs queries and provider methods as the person the key belongs to.

Today that code has two bad choices:
- run in a `system` context: `requireSessionUser()` throws, and `checkQueryAccess` returns early because a call without an `http` context is trusted. An untrusted caller's queries would skip every store rule;
- build a fake request object with a `linkedAuth` on it and enter an `http` context: it works, but it depends on the shape of a request and of `linkedAuth`, which are internals.

## What exists already (checked on `main`, server-utils 1.17.0, server 3.14.1)

- `collectQueryTargets(ir)` and `checkQueryAccess(...)` are exported from `@_linked/server-utils/utils/QueryAccess`.
- `resolveQueryCatalog`, `toReadQuery`, `toQueryBuilder`, `lowerForAccessCheck` and `authorizeGenericQuery` are exported from `@_linked/server/utils/queryPlane`.

So backend code can already decode a DSL-JSON query, authorize it under the store rules and run it with `LinkedStorage`. Only the context is missing.

## Decisions

1. **A new kind**, added to the `CallContext` union:
   ```ts
   | { kind: 'delegated'; userAccount: any; delegate: CallDelegate; linkedAuth: { userAccount: any; delegate: CallDelegate } }
   export interface CallDelegate { id: string; label?: string; via?: string }
   ```
   `linkedAuth` is built once by the entry function, so an access function that reads `ctx.linkedAuth.userAccount` works unchanged and can also see `linkedAuth.delegate`.
2. **One way in:** `runAsDelegate(userAccount, delegate, fn)`. It throws a `TypeError` without a user account or a delegate id: a delegated context never exists without a user.
3. **`requireSessionUser()` returns the delegated user.** `currentDelegate()` returns the delegate, or `undefined` in any other context. `currentRequest()` and `currentResponse()` stay `undefined`: there is no request.
4. **Delegated calls are never trusted by the query plane.** `checkQueryAccess` checks `http` and `delegated` alike; only `system` and no context stay trusted. Rule and graph access functions get `request: undefined`, the `linkedAuth` above and a new optional `delegate` field. `QueryAccessContext.request` and `GraphAccessContext.request` are documented as absent for a delegated call.
5. **`BackendProvider.request` / `.response`** read `undefined` in a delegated context (unchanged code path: only `http` has them); assignments keep working as overrides.
6. **server:** `transactionCaller()` answers `user:<id>` for a delegated context, so a delegated caller's transaction is bound to its user and never to `system`. `RemoteDataset` sends no user token for a delegated call (no session token exists); documented.
7. **Nothing changes for existing callers.** No existing context is reinterpreted, and no export is removed or renamed.

## Files

- server-utils: `src/utils/CallContext.ts`, `src/utils/QueryAccess.ts`, `src/utils/CallContext.test.ts`, a new `src/utils/QueryAccess.delegated.test.ts`, `README.md` (the "Work with no user" section gains "Work for a user outside their request"), a changeset (minor).
- server: `src/utils/serverTransactions.ts` and its test, `README.md` (Query stores: the user's token; Store transactions: the caller), a changeset (patch), and the `@_linked/server-utils` range raised to the version that has the context.

## Example

```ts
import { runAsDelegate, requireSessionUser, currentDelegate } from '@_linked/server-utils/utils/CallContext';

await runAsDelegate(userAccount, { id: connectionIri, label: 'Notes agent', via: 'mcp' }, async () => {
  requireSessionUser();   // → userAccount
  currentDelegate();      // → { id, label, via }
  const { query, operation } = toReadQuery(json, await resolveQueryCatalog(json));
  await authorizeGenericQuery(operation, json, query, 'agent read');   // store rules apply
  return LinkedStorage.readQuery(query);
});
```

## Pitfalls

- **Code that treats "not http" as trusted.** Audited on `main`: server-utils `checkQueryAccess` (fixed here), server `transactionCaller` (fixed here), server `RemoteDataset` user-token hook (correct as is: no token to send), `BackendProvider.readField` (correct as is). Other packages that branch on `ctx.kind` need the same look before they are used from a delegated context; the README says so.
- **Access functions that read `ctx.request`.** They get `undefined` for a delegated call. A function that needs a request must refuse without one; the README states the contract.
- **A consumer on an older server-utils** has no `runAsDelegate`; server's range is raised in the same release order (server-utils first).

## Architecture compliance

- `npx semantu-agents docs architecture`: server-utils has none. server's `docs/architecture/01-server-only-surface.md` applies: `CallContext` and `QueryAccess` stay in `linked.serverOnly`.
- cli `docs/architecture/shared-state-and-error-brands.md`: the context storage is already on `globalThis`; nothing new is module-local.
- No architecture change proposed.

## Test strategy

- **Repositories:** server-utils, then server.
- **Quick gate:** `npm test` in each (jest unit + node call tests; about a minute each). Source: each `package.json`.
- **New cases** are listed with the tasks. Full suites are the same commands; nothing is deferred except server's live-store tests, which this change does not touch.

## Open questions

1. The name: `delegated` / `runAsDelegate` / `currentDelegate`. Alternatives: `onBehalf`, `agent`.
2. Whether `@callable('signed-in')` dispatch should ever be reachable for a delegated caller over HTTP. Not in this plan: a delegated caller invokes providers from backend code, which already skips the HTTP declaration check.

## Phases

Approved to build 2026-11-17 (names as proposed; a rename is a later refactor). One commit per phase per repository.

### Phase 1 — server-utils: the context (done: 5 new cases, full suite green)

- `CallContext.ts`: the `delegated` kind, `CallDelegate`, `runAsDelegate`, `currentDelegate`; `requireSessionUser` returns the delegated user.
- **Validation** (`src/utils/CallContext.test.ts`):
  - `runAsDelegate` — inside, `getCallContext().kind === 'delegated'`, `requireSessionUser()` is the given account, `currentDelegate()` equals the delegate, `currentRequest()` is `undefined`.
  - survives `await` and `setTimeout`.
  - throws `TypeError` without a user account, and without a delegate id.
  - `currentDelegate()` is `undefined` in `http`, `system` and no context.
  - nested `runAsSystem` inside a delegated context has no user again.
  - quick gate: `npm test`.

### Phase 2 — server-utils: the query plane checks delegated calls (pending)

- `QueryAccess.ts`: `checkQueryAccess` (and the graph check) treat `delegated` as a checked call; access contexts carry `delegate`; `request` is `undefined`.
- README section and a minor changeset.
- **Validation** (`src/utils/QueryAccess.delegated.test.ts`):
  - a store with `read: 'none'` refuses a delegated select with 403 (the same query in a `system` context is not refused: control).
  - a store with no rule admits a delegated select (the user is the session) and a delegated write.
  - a function rule is called with `linkedAuth.userAccount` equal to the user, `delegate` equal to the delegate and `request === undefined`; returning `false` refuses with 403.
  - a raw query with `rawQueries: 'off'` is refused 403 for a delegated call.
  - an `http` call behaves as before (one existing case re-run as control).
  - quick gate: `npm test`.

### Phase 3 — server: the transaction caller (pending)

- `serverTransactions.ts`: `transactionCaller()` answers `user:<id>` in a delegated context; 401 when the account has no id.
- README notes; a patch changeset; the server-utils range raised when that version exists (until then the worktree links the branch).
- **Validation:** the existing transaction-caller test gains `delegated → user:<id>` and `system → 'system'` (control); quick gate `npm test`.
