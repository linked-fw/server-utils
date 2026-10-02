---
'@_linked/server-utils': minor
---

Add `Server.setAuthHandler` / `LincdServerProxy.setAuthHandler`, a supported hook for keeping a session alive around server calls: `beforeRequest(url, init)` runs before every HTTP call, and `onUnauthorized(url, response)` on a 401 decides whether the call is sent again, once, with the current default headers. `callCustomShapeMethod` now sends the default headers (except `Content-Type`) and goes through the same hook.
