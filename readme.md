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
