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

- None after the review addendum below (first landing left `__PRELOAD_ROUTES__` and
  `assetManifest` unescaped; the addendum escapes them too).

### Review addendum

An independent review found nothing exploitable and asked for three changes, now landed:

- `Html` also routes `window.__PRELOAD_ROUTES__` and `assetManifest` through
  `escapeJsonForScript`, so every JSON value it writes into a `<script>` is escaped (the dev-only
  inline `<style>` is CSS, not JSON, and stays as it was).
- `test/html-render.test.mjs` (new): server-renders `Html` with a hostile `requestObject`,
  `requestLD`, asset manifest and route key through `AppContext`; asserts no raw
  `</script><b>x</b>` in the output, and that `#request-json`, `#request-ld` and the manifest
  `JSON.parse` back to the input. With the `requestObject` escape removed from the built `Html`
  the run is `# pass 2`, `# fail 2`; with it, `# pass 4`, `# fail 0`.
- Backlog 005 records two notes: `requestLD`'s format (JSON-only escaping) and the `cachePaths`
  HTML cache in `@_linked/server`, which stores per-request `request-json`.

Verification: `npx linked build` `✔ Build successful with warnings`; `npm run test:calls`
`# tests 119`, `# pass 119`, `# fail 0`; CN `tests/e2e/signin.spec.ts` (dev sign-in, `CN_TEST_PORT=4162`)
`5 passed (36.1s)`.

### Follow-ups

- Backlog 005 (request-ld format; request data in `cachePaths` pages).
- webid.email can drop its `encodePageData` escaping after the release (webid.email backlog 005,
  trimmed to that).

## Details

The escape runs on the JSON text, not on the value: outside a string `JSON.stringify` never emits
`<`, `>`, `&` or the separators, so only string contents change and the output stays valid JSON.
Doing it in `Html` rather than in `@_linked/server`'s `getRequestData` keeps `requestObject` plain
JSON for the server tests that `JSON.parse` it, and covers any other caller that passes
`requestObject` or `requestLD` to `Html` through `AppContext`.
