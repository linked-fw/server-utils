---
date: 2026-10-27
summary: >
  Html escapes `<`, `>`, `&`, U+2028 and U+2029 in the JSON it writes into the request-json and
  request-ld scripts (`escapeJsonForScript`), so a `</script>` in frontendData cannot break out of
  the element; the client parses the same value. Patch. Found by webid.email (its backlog 005).
---

# 005 — `frontendData` escaped inside its `<script>`

Create Now plan 181 (backlog batch), with `@_linked/auth` report 022. Landed on the integration
branch `dev`.

## PR

### Summary

`LinkedServer.getRequestData` serializes `request.frontendData` with `JSON.stringify`, and `Html`
wrote it unescaped into `<script id="request-json" type="application/json">`. JSON does not escape
`<`, so a value such as `</script><img src=x onerror=…>` closed the element and the rest was parsed
as markup: any provider putting user- or site-chosen text into `frontendData` opened an XSS.

### Changes

- `src/utils/HtmlAssets.ts`: new `escapeJsonForScript(json)`, which writes `<`, `>`, `&`, U+2028
  and U+2029 as `<`, `>`, `&`, ` `, ` `. These are JSON string escapes,
  so `JSON.parse` gives the same value; undefined or empty input gives `''`.
- `src/components/Html.tsx`: `request-json` (`requestObject`) and `request-ld` (`requestLD`) go
  through it.
- `test/html-assets.test.mjs`: four tests (no `<`, `>`, `&`, U+2028, U+2029 left and
  `</script>` written as `</script>`; round trip through `JSON.parse` equals the input;
  JSON without those characters unchanged; missing data writes nothing).
- Changeset: patch.

The client reader (`initFrontend` in `src/utils/Frontend.ts`) is unchanged: it reads the script's
text and `JSON.parse`s it, which decodes the escapes. On the client `Html` renders only its
children, so there is no hydration difference.

### Verification

- `npx linked build`: `✔ Build successful with warnings` (the warnings were there before).
- `node --test test/html-assets.test.mjs`: `# pass 25`, `# fail 0`.
- `npm run test:calls`: `# tests 115`, `# pass 115`, `# fail 0`.
- Running a CN worktree on this build: the home page's `<script id="request-json"
  type="application/json">{}` still parses, and `npm run test:regular` passes (see auth report 022
  for the quoted run).
- `npm run test:unit` (jest) is not run: its suites fail to parse TypeScript on `main` too
  (backlog 002).

### Deviations

- The two inline executable scripts (`window.__PRELOAD_ROUTES__` and `assetManifest`) are left as
  they were: their JSON comes from the route table and the build manifest, not from request data.

### Follow-ups

- webid.email can drop its `encodePageData` escaping after the release (webid.email backlog 005,
  trimmed to that).

## Details

The escape runs on the JSON text, not on the value: outside a string `JSON.stringify` never emits
`<`, `>`, `&` or the separators, so only string contents change and the output stays valid JSON.
Doing it in `Html` rather than in `@_linked/server`'s `getRequestData` keeps `requestObject` plain
JSON for the server tests that `JSON.parse` it, and covers any other caller that passes
`requestObject` or `requestLD` to `Html` through `AppContext`.
