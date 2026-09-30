---
'@_linked/server-utils': patch
---

Add `shapes/index`, a side-effect-only module that registers every shape this package defines and nothing else (no components, no CSS), so `import '@_linked/server-utils/shapes/index'` loads the shapes in plain node as well as in a bundle. The package entry now imports it instead of listing shapes one by one.
