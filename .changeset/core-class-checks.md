---
'@_linked/server-utils': patch
---

`JSONWriter` and `LincdServerProxy` recognise a `Shape`, `ShapeSet` or `CoreSet` (and a `Shape` class) made by another installed copy of `@_linked/core`: the checks use `isLinkedInstance` instead of `instanceof`. Requires `@_linked/core` `^2.36.2`.
