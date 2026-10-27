---
summary: >
  Two notes from the review of report 005: (a) `requestLD` is always '' today, and if it ever
  carries Turtle or N-Quads instead of JSON-LD, `escapeJsonForScript` would corrupt it; (b)
  `@_linked/server`'s `cachePaths` HTML cache is keyed by `req.url` and stores the per-request
  `request-json`, so a personalised page in `cachePaths` would serve one person's `frontendData`
  to everyone.
status: Open
---

# 005 — `request-ld`'s format, and request data in cached pages

Source: the independent review of report 005 (`frontendData` escaped inside its `<script>`).

## (a) `request-ld` is escaped as JSON

`Html` writes `requestLD` through `escapeJsonForScript`, which rewrites `<`, `>`, `&`, U+2028 and
U+2029 as `\uXXXX`. That is lossless for JSON (JSON-LD), and `requestLD` is always `''` today
(`LinkedServer.getRequestData`). If it ever carries Turtle or N-Quads, `<` inside an IRI
(`<https://…>`) would change the data; a non-JSON format needs its own escaping (or JSON-LD only).

First question: make `requestLD` JSON-LD by contract (type and doc it), or remove it while it is
unused?

## (b) The `cachePaths` HTML cache holds per-request data

`@_linked/server`'s `LinkedServer.tsx` (the `onShellReady` cache transform, and the cache read
near line 2416) caches the rendered HTML for any `req.url` listed in `config.server.cachePaths`.
That HTML includes `<script id="request-json">` with the request's `frontendData`. A page whose
`frontendData` depends on the person (a sign-in page, anything with session data) listed in
`cachePaths` would serve the first visitor's data to every later one.

First questions: refuse to cache when `frontendData` is non-empty, cache only the shell and render
`request-json` per request, or document `cachePaths` as for anonymous, identical pages only? The
fix belongs in `@_linked/server`; record it there when picked up.
