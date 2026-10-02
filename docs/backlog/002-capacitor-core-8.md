---
summary: >
  `@capacitor/core` 5 -> 8 is deferred: we decided not to upgrade Capacitor for now. Nothing in
  server-utils imports `@capacitor/*` -- not today, and not since the initial commit -- yet it sits
  in `dependencies` and is installed by every consumer. The right outcome is to remove it, not to
  upgrade or keep deferring it.
status: Deferred -- held by the shared Renovate preset; replaces Renovate PR linked-fw/server-utils#57
---

# 002 — `@capacitor/core` 8 is deferred (and the dependency is unused)

**Status:** deferred. We decided not to upgrade Capacitor for now. Renovate PR
[#57](https://github.com/linked-fw/server-utils/pull/57) (`@capacitor/core` to v8) is
superseded by this note, and majors of `@capacitor/**` are disabled in
[`linked-fw/renovate-config`](https://github.com/linked-fw/renovate-config).

## How it is used here

It is not. `@capacitor/core` is declared in `dependencies` as `^5.2.2`, but no file in the repo
other than `package.json` mentions Capacitor, and `git log -S"from '@capacitor"` finds no commit
that ever imported it -- it came over with the initial extraction from the lincd.org monorepo.
It is still a runtime dependency on paper, so every consumer of `@_linked/server-utils`
installs Capacitor 5 for nothing, and can end up with a second copy of `@capacitor/core` beside
the one its own app uses.

## What changes between 5 and 8

Three majors. The JS surface (`Capacitor.getPlatform()`, `isNativePlatform()`, `registerPlugin`)
is stable throughout; the cost is in the native toolchain each major raises:

| | Node | Xcode | iOS min | Android min / target SDK | Other |
|---|---|---|---|---|---|
| **6** | 18+ | 15+ | 13 | 22 / 34 | `addListener` returns only a Promise; Android scheme defaults to `https`; iOS custom plugins no longer auto-register |
| **7** | 20+ | 16+ | 14 | 23 / 35 | JDK 21; `bundledWebRuntime` and `cordova.staticPlugins` config removed; telemetry opt-out |
| **8** | 22+ | 26+ | 15 | 24 / 36 | AGP 8.13, Gradle 8.14.3, Kotlin 2.2.20; `adjustMarginsForEdgeToEdge` removed; iOS SPM projects by default |

Sources: <https://capacitorjs.com/docs/updating/6-0>, `/7-0`, `/8-0`.

## Recommendation: remove the dependency

Delete `@capacitor/core` from `dependencies`, rebuild (`npx linked build`) to confirm nothing
breaks, and release as a patch. That ends this hold for server-utils outright. Not done here.

## When this is picked up

1. Remove the dependency (above) -- an upgrade would only move an unused package forward.
2. The `@capacitor/**` major hold in `renovate-config` also covers `auth` and `shape-ui`; lift
   it only once those are resolved.
