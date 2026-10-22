---
summary: >
  `npm run test:unit` (jest with babel-jest) fails to parse TypeScript in all five suites under
  `src/utils/`, so 0 tests run. It fails on `main` too. `npm run test:calls` (node --test) is the
  suite that works.
status: Open -- found during CN plan 070; not investigated
---

# 002 — The jest unit suites fail to parse TypeScript

Source: CN plan 070 (store-inference), noticed while running this package's gates.

## Problem

`npm run test:unit` runs `jest --config jest.config.cjs`. Every suite fails before a test runs:

```
FAIL src/utils/BackendProvider.test.ts
FAIL src/utils/LincdServerProxy.authHandler.test.ts
FAIL src/utils/LincdServerProxy.responseBody.test.ts
FAIL src/utils/callable.test.ts
FAIL src/utils/CallContext.test.ts
Test Suites: 5 failed, 5 total
Tests:       0 total
```

Each reports "Jest encountered an unexpected token" with a TypeScript-only construct
(`SyntaxError: Missing initializer in const declaration`, `Unexpected token '['`, ...), so the
`@babel/preset-typescript` transform in `jest.config.cjs` is not applied. The same happens on
`main` (6c045bc) in the CN workspace checkout. `npm test` runs `test:unit` first, so it fails too.

`npm run test:calls` (`node --test 'test/*.test.mjs'`) works: 95 tests, 95 pass.

## First questions

- In the CN workspace this package has no `jest` of its own in `node_modules/.bin`; `npx jest`
  resolves the workspace root's jest. Does that jest load a different `babel-jest` or Babel
  config (root `babel.config.*`, `configFile: false` ignored), and does the suite pass in a
  standalone clone with its own install?
- Fix the transform, or move these five suites to `node --test` like `test:calls`?
- Once fixed, CI should run `test:unit` so it cannot silently stop parsing again.
