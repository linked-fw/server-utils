---
'@_linked/server-utils': minor
---

Ontology data: labels, descriptions and types for every term.

- `src/data/server-utils.ttl` gains the ontology node (`dcterms:title`, `dcterms:description`,
  `owl:versionInfo`) and is written in the deterministic Turtle form.
- `server-utils:Lincd_API_Client` is typed `owl:Class` (was `rdfs:Class`), with an English label
  ("Linked API client", was "LINCD API Client") and comment; `rdfs:isDefinedBy` stays.
