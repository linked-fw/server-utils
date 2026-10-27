---
'@_linked/server-utils': patch
---

The jest unit suites run again: a package-local transform loads this package's Babel 8 core instead of whichever `babel-jest` finds. Test setup only; no runtime change.
