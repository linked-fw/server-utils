---
"@_linked/server-utils": minor
---

`declareInternal(cls, methods, {overridesCallable: true})` and `@internal({overridesCallable: true})` close a method that is declared callable on purpose, without the "declared both callable and internal" warning. A conflict without the option still warns, and the warning now names the option.
