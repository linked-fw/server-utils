---
'@_linked/server-utils': patch
---

In a browser on a page the server rendered, `Server.call` and friends go to the page's own origin, not to `SITE_ROOT`. With `SITE_ROOT` naming the same server under another host name (`http://my-machine.local:4000` while the browser is on `http://localhost:4000`), every call was cross-site: the browser dropped the SameSite auth cookies set by those responses, so the session lived only in the tab's memory and each page load signed the user out. Backend calls, native apps and pages served from elsewhere still use `SITE_ROOT`.
