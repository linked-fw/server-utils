---
"@_linked/server-utils": minor
---

`@callable('signed-in')` (and `declareCallable(Cls, {method: 'signed-in'})`) is the level for a method that needs a session. `'user'` stays accepted as a deprecated alias and is treated exactly like `'signed-in'`; `getOwnCallableLevel` reports the level as declared. New `requiresSession(level)` answers whether a level needs a session, for either spelling.
