---
date: 2026-11-10
summary: >
  The ontology is registered by src/ontologies/index.ts (registerOntologies) and the package registers no prefix; an app's prefix map holds the prefixes. Major.
packages: [server-utils]
---

# 009 — The ontology index; no prefix registered

## PR

**What changed.** The package's ontology is registered by one generated module,
`src/ontologies/index.ts`, which calls core's `registerOntologies([...], import.meta.url)` with the
ontology's name, namespace, terms, data files and the prefix its data suggests. The package entry
imports it (and `shapes/index` does, where the package has one). `src/package.ts` exports `registerOntologies` in place of
`linkedOntology`. The package adds no prefix to core's prefix map any more: an app loads its own
map (`linked.app.json`), and the ontology's data states the prefix it suggests.

`ontologies/server-utils.register` and the deprecated `ontologies/lincd-server-utils.register` are removed, with the `server-utils` and deprecated `lincd-server-utils` prefixes; `ontologies/server-utils` drops `dataFiles` and `loadData` (`lincd-server-utils` stays as a terms alias). `components/AppRoot` no longer adds `APP_PREFIX` → `DATA_ROOT` when imported. `test/ontology.test.mjs` checks the registration and that no prefix is added, and compaction with an app map (`server_utils`).

Changeset: major (`.changeset/ontology-index.md`), released with the core major that provides
`registerOntologies`.

**Verification.**

- `linked generate-ontology --check`:

  ```
  server-utils: registered by the index, vann data checked)
  Every ontology module is current.
  ```

- `linked build`: `✔ Build successful` (with the existing missing-dependency warning).
- `npm test`:

  ```
  Test Suites: 5 passed, 5 total
  Tests:       73 passed, 73 total
  # pass 119
  # fail 0
  ```

- No `linkedOntology`, `Prefix.add` or `.register.js` left in `src/` (grep, empty).

**Deviations.** None.

**Follow-ups.** None in this repo.

## Details

Built and tested against the core and cli of the same coordinated major, and the standard
vocabulary packages in the index layout. The same change across every linked package with an
ontology is described alike in each package's report.
