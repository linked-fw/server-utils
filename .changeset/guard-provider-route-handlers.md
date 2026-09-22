---
'@_linked/server-utils': patch
---

`BackendProvider.registerRoute` now guards every handler it registers, so a
failing provider route reports itself instead of hanging.

Express 4 ignores the promise an `async` handler returns, so a rejection reached
no error handler and nothing wrote to the response — the socket stayed open
until the client timed out, with nothing in the log. An endpoint that threw was
indistinguishable from a dead server.

Handlers registered through `registerRoute` now get:

- **Rejection → 500 + stack.** A throw is logged as
  `[linked] GET /path failed: <stack>` and answered with
  `500 {error: 'internal server error', route: 'GET /path'}`. Middleware
  (registered with `'use'`) forwards to `next(err)` instead of sending JSON,
  since it may not be serving JSON at all.
- **Hang → a named warning.** A request still unanswered after
  `LINKED_ROUTE_WARN_MS` milliseconds logs
  `[linked] GET /path has not responded after 15000ms`. This covers the case a
  `try/catch` cannot reach: a handler that neither responds nor throws. Default
  15000; set `LINKED_ROUTE_WARN_MS=0` to disable.

The watchdog only warns and never ends the response, so streaming endpoints are
unaffected. It is cleared on response end for routes but when the handler
settles for middleware, so a hanging route is reported once — by its own name —
rather than once per upstream `use` layer.

Error-handling middleware (arity 4) is left unwrapped so Express still
recognises it. No call-site changes are required: existing hand-rolled
`try/catch` blocks in provider routes keep working and are now a redundant
second layer rather than the only safety net.
