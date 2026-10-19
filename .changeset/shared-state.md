---
"@_linked/server-utils": minor
---

State callers set is shared by every copy of this package in a runtime: `Server`'s proxy and local server, `LincdServerProxy`'s default headers, auth handler and action handlers, `LinkedEmail`'s provider, the live-update log and batch, and request data now live on `globalThis` (core's `sharedState`). `ServerCallError` is branded, so `isLinkedError(err, ServerCallError)` and `ServerCallError.is` match one thrown by another copy. Requires `@_linked/core` 2.36.0.
