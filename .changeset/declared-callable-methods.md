---
"@_linked/server-utils": minor
---

Declared-callable provider methods, per-call request context, query access registry.

- `utils/callable`: `@callable('public' | 'user')`, `declareCallable(cls, methods)` and `getOwnCallableLevel(cls, method)` declare which provider methods a server may dispatch over RPC.
- `utils/CallContext` (server-only): an `AsyncLocalStorage` call context with `getCallContext`, `runWithCallContext`, `runAsSystem`, `currentRequest`, `currentResponse` and `requireSessionUser`.
- `BackendProvider.request`/`response` are now getters over the current call's context, so concurrent calls on a singleton provider no longer share a request. Assigning them still works but warns once per class; `initRequest` is a no-op hook and `callOtherProvider` no longer copies the request. Provider routes registered with `registerRoute` run in the call context.
- `utils/QueryAccess` (server-only): `registerProtectedShapes`, `registerQueryAuthorizer` and `checkQueryAccess`, the rules for the generic query plane.
- `JSONParser.parseObject(obj, {shapeClasses: 'allow' | 'warn' | 'reject'})`; `__proto__` keys are always dropped.
