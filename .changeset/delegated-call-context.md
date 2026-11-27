---
"@_linked/server-utils": minor
---

A third call context, `delegated`, for work done for a known user by something acting on their behalf, outside that user's request. `runAsDelegate(userAccount, delegate, fn)` enters it; `requireSessionUser()` returns the user and `currentDelegate()` the delegate. The generic query plane (`checkQueryAccess`) checks a delegated call like an HTTP call instead of trusting it like `system` work; access functions get the `delegate` and no `request`. Existing contexts are unchanged.
