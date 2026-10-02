---
"@_linked/server-utils": minor
---

`getUpdatesSince` now requires a signed-in user (`@callable('user')`) and returns at most 100 updates per call. `LinkedLiveUpdate.send(type, data, {to})` addresses an update to one user account; updates without `to` are still broadcast to every signed-in user.
