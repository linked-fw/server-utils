---
summary: >
  The PR workflow passes `require-tests: false` to the shared linked-fw workflow, so neither the
  jest unit suites nor `test:calls` run in CI; the jest suites once stopped parsing unnoticed
  (report 006). Turn the tests on in CI.
packages: [server-utils]
---

# 004 — CI runs the unit suites

Source: report 006 (the jest unit suites failed to parse TypeScript for a long time, also on
`main`, and nothing noticed).

## Problem

`.github/workflows/pr.yml` calls `linked-fw/.github/.github/workflows/pr.yml@v1` with
`require-tests: false`. `npm test` runs `test:unit` (jest) and `test:calls` (`node --test`
against the built `lib/`), and neither gates a PR.

## First questions

- What does the shared workflow run with `require-tests: true`: `npm test` after a build?
  `test:calls` needs `lib/`, so the build must come first.
- Turn it on here alone, or for every linked-fw repo whose suite runs without a store?
