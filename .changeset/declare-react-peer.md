---
"@_linked/server-utils": patch
---

Declares its React peer; accepts React 18 or 19. The components import `react`, which is now a `peerDependencies` entry (`^18.2.0 || ^19.0.0`) so the consumer's single React copy is used.
