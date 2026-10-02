---
'@_linked/server-utils': minor
---

The server-utils ontology moves from `http://lincd.org/ont/lincd-server-utils/` to `https://linked.cm/ont/server-utils/`, the first-party scheme every public package uses (`https://linked.cm/ont/{publicSlug}/`, next to its shapes at `https://linked.cm/shape/server-utils/`).

No data migration is needed. No stored data is typed with its only term, `Lincd_API_Client`. The only store triple that carried it is the `sh:targetClass` of the synced `Lincd_API_Client` shape description, which boot sync deletes and recreates, so it moves to the new IRI the next time the server starts (with `syncShapesOnBoot: false`, at the next sync). The prefix key (`lincd-server-utils`) and the `ontologies/lincd-server-utils` module are unchanged; code that hard-codes `http://lincd.org/ont/lincd-server-utils/` must be updated.
