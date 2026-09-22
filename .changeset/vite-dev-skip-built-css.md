---
"@_linked/server-utils": patch
---

## Skip built CSS link during Vite development

`Html` no longer injects `<link rel="stylesheet" href={assets['main.css']}>` when `assets['__viteDev']` is set. Vite already injects CSS in development; the built stylesheet link caused double-loading / broken asset paths.

Also drops `.js` from bare `@_linked/core` type import paths in checked-in `.d.ts` files.
