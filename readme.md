# lincd-server-utils

provides a set of utilities for applications with a lincd-server backend.

## Server

```tsx
import { Server } from 'lincd-server-utils/lib/utils/Server';
```

Call the server from the frontend.

### Failed calls

By default a call that fails with a non-2xx response logs a warning and resolves `undefined`.

To reject instead, pass a `CallConfig` with `rejectOnError: true` as the method:

```tsx
import { Server, ServerCallError } from '@_linked/server-utils/utils/Server';

try {
  const result = await Server.call(this, { method: 'selectQuery', rejectOnError: true }, query);
} catch (err) {
  if (ServerCallError.is(err)) {
    err.status; // e.g. 500 (provider threw) or 501 (no provider for the call)
    err.message; // the server's {error} message, or the status text
  }
}
```

With the opt-in a successful call still resolves whatever the provider returned, including `null` or `undefined`.

On the backend, `Server.call` calls the local server directly and follows the same rules:

- **No provider.** A call that no provider handles resolves `undefined` by default. With `rejectOnError` it rejects with status 501.
- **Provider throws.** A provider method that throws always rejects. With `rejectOnError` the rejection is a `ServerCallError` with status 500, and the original error is kept as `cause`.

### Authentication hook

An auth package keeps a session alive around server calls by registering an `AuthHandler`. server-utils has no knowledge of tokens: the handler changes the default headers (`Server.addDefaultHeaders` / `Server.removeDefaultHeaders`), and each request's headers are built after the hook has run.

```tsx
import { Server } from '@_linked/server-utils/utils/Server';

Server.setAuthHandler({
  // before every request: e.g. refresh a token that has already expired
  async beforeRequest(url, init) {
    if (tokenExpired()) await refresh(); // refresh() calls Server.addDefaultHeaders(...)
  },
  // after a 401: resolve true to send the request again, once, with the current default headers
  async onUnauthorized(url, response) {
    return refresh();
  },
});
```

- **Which calls.** Every call made over HTTP: `Server.call`, `Server.customPost` and `Server.callCustomShapeMethod`. Calls made directly against the local server on the backend do not use it. There is one handler; setting another replaces it and `null` removes it.
- **`init` is a preview.** To change what is sent, change the default headers.
- **401 only.** A 403 means the caller is known and not allowed; refreshing does not help, so it is not passed to `onUnauthorized`.
- **At most one retry per call.** The retry's response goes to the caller as is: a second 401 is not passed to `onUnauthorized` again. If the default headers changed while the request was in flight (another call refreshed meanwhile), a 401 is retried once without asking.
- **Concurrency.** Retry state belongs to each call. Making concurrent refreshes share one round trip is the handler's job.
- **A throwing hook** is logged and treated as "no change" / "do not retry"; the call goes on.
- **Response actions are not retried.** A provider that answers `200` with a response action (for example `@_linked/auth`'s `ENFORCE_SIGNIN`) has already run, and may have written something before deciding the caller is not signed in, so sending the request again is not safe. Response actions keep going to `Server.registerActionHandler`.

`callCustomShapeMethod` sends the default headers, except `Content-Type` (its body is often `FormData`, which needs the browser to set the boundary). Headers passed to it win. Its body is sent again on a retry, so use a body that can be (a string, `FormData`, a `Blob`), not a stream.

## LinkedEmail

Send emails from anywhere in the backend.

Make sure to install an email client first, like `lincd-zeptomail`.
By adding `lincd-zeptomail` to your project (in package.json), it will automatically be used as the default email client.

After this, you can send emails from anywhere in the backend.

```tsx
LinkedEmail.sendEmail({
  ...
});
```

### Setting a default provider

If you want to implement an email client, you can use `LinkedEmail.setDefaultProvider` to set the default email client.
You can do this in the constructor of your backend provider. Here is an example:

```tsx
import { LinkedEmail } from 'lincd-server-utils/lib/utils/LinkedEmail';
// import your email client from this package
import { MyMailClient } from './utils/MyMailClient';
import { BackendProvider } from 'lincd-server-utils/lib/utils/BackendProvider';
export class MyBackendProvider extends BackendProvider {
  constructor(s) {
    super(s);
    LinkedEmail.setDefaultProvider(new MyMailClient());
  }
}
```
