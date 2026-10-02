---
"@_linked/server-utils": minor
---

Declared-callable provider methods, per-call request context, query access rules.

- `utils/callable`: `@callable('public' | 'user')`, `declareCallable(cls, methods)` and `getOwnCallableLevel(cls, method)` declare which provider methods a server may dispatch over RPC. `@internal()`, `declareInternal(cls, methods)` and `isDeclaredInternal(cls, method)` mark methods a server never dispatches over HTTP; the declaration is inherited by subclasses, can be made on a class from another package, and wins over a callable declaration (with a warning). `declareCallable` and `declareInternal` throw a `TypeError` for a name the class has no instance method for.
- `utils/CallContext` (server-only): an `AsyncLocalStorage` call context with `getCallContext`, `runWithCallContext`, `runAsSystem`, `currentRequest`, `currentResponse` and `requireSessionUser`, plus `httpCallContext(req, res)` and `runInHttpContext(req, res, fn)`, which give each HTTP request one shared context.
- `BackendProvider.request`/`response` read the current call's context. Assigning them stores the value in that call's context for that provider instance; an assignment made outside any call is ignored with a warning. `initRequest` is a no-op hook. Every handler registered with `registerRoute`, middleware included, runs in the request's context.
- `utils/QueryAccess` (server-only), the rules for the generic query plane: `registerProtectedShapes`, `registerQueryAuthorizer`, `registerRawQueryAuthorizer` and `checkQueryAccess`. A protected shape covers its nodes as well: a mutation through any shape that would write or delete a node typed with a protected shape's class (or a subclass) is refused, using a `probeProtectedNodes` lookup the server supplies.
- `JSONParser.parseObject(obj, {shapeClasses: 'allow' | 'warn' | 'reject'})`; `__proto__` keys are dropped.
- `setupLiveUpdatesMulticore` is internal.

Behaviour changes for apps on the generic query plane (`checkQueryAccess`):

- mutations require a signed-in user in every mode (401);
- a create may not choose the ids of the nodes it creates (`__id`), 403;
- raw SPARQL is refused (403) in every mode unless the app registers a raw query authorizer. Raw authorizers run before the session check, and every one of them accepting admits the query with or without a session, so a server-to-server caller can authenticate with a token the authorizer verifies; the context carries the query text, the parsed `body` and, when the server kept it, the received `rawBody`. A raw authorizer must therefore check the caller itself;
- a query that cannot be analysed is refused (400), as is an operation that does not match the query's kind.
