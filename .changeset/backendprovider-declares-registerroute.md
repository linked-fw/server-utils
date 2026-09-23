---
'@_linked/server-utils': patch
---

`BackendProvider` now declares `registerRoute` and `disposeRoutes`.

Both have existed on the class for some time, but `BackendProvider.d.ts` is
hand-written and shadows `BackendProvider.ts`, so it never gained them.
Consumers saw a type missing methods the class actually has:

```ts
class AuthProvider extends BackendProvider {
  setupBeforeControllers() {
    // previously: "Property 'registerRoute' does not exist on type ..."
    this.registerRoute('get', '/auth/dev', (req, res) => res.send('ok'));
  }
  dispose() {
    this.disposeRoutes();
  }
}
```

No runtime behaviour changes — this is a declaration catching up with the
implementation. The file is flagged for deletion in favour of emitted
declarations, which is tracked separately.
