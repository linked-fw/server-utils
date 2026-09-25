---
'@_linked/server-utils': patch
---

Stop the ok-branch of `fetchBackend` from destroying the payload it tries to
report. It did `res.json().catch(… res.text() …)`, but `json()` has already
consumed the stream, so the `text()` threw `body stream already read` and the
server's real message was lost. The body is now read once as text and parsed
from that, so an unparseable 200 logs its actual content.
