---
date: 2026-10-27
summary: >
  The jest unit suites ran 0 tests (all five failed to parse TypeScript): `babel-jest`, hoisted to
  the workspace root, loaded the root's Babel 7 core with this package's Babel 8 presets. A
  package-local jest transform now loads the package's own `@babel/core`; the config finds
  `@_linked/core` wherever it is installed. 73 tests pass. Patch. Step F of CN master plan 181.
---

# 006 — The jest unit suites parse again

## PR

### Summary

`npm run test:unit` failed every suite before a test ran ("Missing initializer in const
declaration" on `new Map<string, CallableLevel>()`). Cause: the presets in `devDependencies` are
Babel 8 (`@babel/preset-env`/`preset-typescript` `^8`), but in the CN workspace `babel-jest` is
deduped to the root, where it loads the root's `@babel/core` 7.29.7. Babel 8's TypeScript plugin
on a Babel 7 core strips some type syntax and leaves the rest. Standalone, the lockfile hoists
`@babel/core` 8, which is why the setup looked right. No suite exercises removed code; none was
deleted.

### Changes

- `jest.transform.cjs` (new): a jest transform that runs `@babel/core` resolved from this
  package, with preset-env, preset-typescript and `babel-preset-jest` (hoists `jest.mock`), and
  passes jest's `supportsStaticESM` as Babel's `caller` so modules compile to CommonJS.
- `jest.config.cjs`: uses that transform; the `@_linked/core` leaf-module mapping looks for
  `node_modules/@_linked/core` upward from the package instead of assuming
  `<rootDir>/node_modules` (in the workspace it is hoisted).
- `package.json`: `@babel/core` `^8.0.0` and `babel-preset-jest` `^30.2.0` as devDependencies
  (both were already installed, as a peer and as `babel-jest`'s dependency); `package-lock.json`
  updated in an isolated copy (`npm install --package-lock-only`): two root entries, four `peer`
  flags dropped.
- Backlog 002 removed; follow-up 004 (CI runs the unit suites).

### Verification

```
$ npm test            # test:unit, then test:calls
Test Suites: 5 passed, 5 total
Tests:       73 passed, 73 total
# tests 115
# pass 115
# fail 0
$ npx linked build
⚠ Checking dependencies - warning: _linked-server-utils is missing dependencies:
  - react-dom
✔ Build successful with warnings
```

Before: `Test Suites: 5 failed, 5 total` / `Tests: 0 total`. The `react-dom` warning predates
this change. `npm run test:regular` in the CN worktree: PASS, 342 passed / 14 skipped, 297 s (`## Details`).

### Deviations

None.

### Follow-ups

- CI does not run the tests (`require-tests: false`): backlog 004.

## Details

The diagnosis, in order: the transform was applied (a logging transformer saw both the test file
and `callable.ts`), but its output still held `<string, CallableLevel>`; the same options through
`@babel/core` 7 directly with Babel 7-resolved presets compiled cleanly; the package's own
`node_modules/@babel` holds core 8.0.9 and presets 8.0.x, the root holds core 7.29.7 next to
`babel-jest` 30.5.2. Fixing the core alone exposed two more gaps the old setup masked: Babel 8's
preset-env keeps ES modules without a `caller` that says otherwise, and without
`babel-preset-jest` the virtual `jest.mock('@_linked/core/shapes/Shape')` ran after the import it
stubs.

`test:calls` runs against `lib/`, so it needs a build first (`npx linked build`); a fresh worktree
without `lib/` fails all 16 files with `ERR_MODULE_NOT_FOUND`, which is expected.


### CN regular set

`CN_TEST_PORT=4167 npm run test:regular` in the CN worktree (both packages linked from the step's
worktrees), under the shared lock, 297 s wall clock:

```
  14 skipped
  342 passed (4.0m)

test:regular
  typecheck:gate                                   PASS   14s
  unit (vitest)                                    PASS   38s
  packages                                         PASS    8s
  playwright (integration + sign-in e2e)           PASS  237s
  total                                            PASS  297s
```
