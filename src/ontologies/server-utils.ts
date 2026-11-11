import { createNameSpace } from '@_linked/core/utils/NameSpace';

/**
 * The namespace of this ontology, which can be used to create NamedNodes with URI's not listed in this file.
 *
 * First-party ontologies live on linked.cm: `https://linked.cm/ont/{name}/`, and a
 * package's own ontology takes the package's publicSlug (`@_linked/server-utils` →
 * `server-utils`), the same slug its shapes use under `https://linked.cm/shape/server-utils/`.
 *
 * Until 1.6.0 it was `http://lincd.org/ont/lincd-server-utils/`. No stored data is typed
 * with these terms; the only store triples that carried them were the synced shape description of
 * `Lincd_API_Client` (`sh:targetClass`), which boot sync rewrites (delete, then recreate) the next
 * time the server starts.
 */
export var ns = createNameSpace('https://linked.cm/ont/server-utils/');
/**
 * The NamedNode of the ontology itself
 */
export var _self = ns('');

//A list of all the entities (Classes & Properties) of this ontology, each exported as a NamedNode
export var Lincd_API_Client = ns('Lincd_API_Client');

//An extra grouping object so all the entities can be accessed from the prefix/name
export const serverUtils = {
  Lincd_API_Client,
};

/** @deprecated use serverUtils */
export const lincdServerUtils = serverUtils;

