---
'@_linked/server-utils': minor
---

Raw SPARQL on the generic query plane is now governed by a setting instead of an authorizer hook. `checkQueryAccess` takes `rawQueries: 'off' | 'session'` (the server passes its `server.rawQueries` setting): `'session'`, the default, runs a raw query for any signed-in session, and `'off'` refuses every raw query. `registerRawQueryAuthorizer`, `getRawQueryAuthorizers` and the `RawQueryAuthorizer` / `RawQueryAuthorizationContext` types are removed. The new `RawQueriesMode` type names the setting.

### Behaviour changes

- A raw query (`/api/select-raw`) now needs a signed-in session (401 without one, in every `rpcExposure` mode), or is refused outright (403) when `rawQueries` is `'off'`. Before, raw queries were refused unless an app registered a raw query authorizer, and a registered authorizer could admit a caller without a session. An app that relied on such an authorizer must now send a session, or keep raw queries off.
