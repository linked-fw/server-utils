---
'@_linked/server-utils': minor
---

Html: add `crossorigin="anonymous"` to route asset links whose origin differs
from the page's, so releases served from a CDN preload and load correctly. The
preload and the stylesheet for one href always make the same decision, so a
cross-origin stylesheet is never fetched twice. Same-origin hrefs are rendered
exactly as before — nothing changes for apps that serve their own assets.

The pre-hydration CSS check now treats a `SecurityError` from `sheet.cssRules`
as "ready" instead of "not ready": a cross-origin sheet without CORS can never
be inspected, and waiting on it only held the loader up until the 2s fallback.
