import { Prefix } from '@_linked/core/utils/Prefix';
import { createNameSpace } from '@_linked/core/utils/NameSpace';

/**
 * Load the data of this ontology into memory, thus adding the properties of the entities of this ontology to the local graph.
 */
export var loadData = () => {
  //@ts-ignore
  return import('../data/server-utils.json', {
    with: { type: 'json' },
  }).then((data) => data.default);
};

/**
 * The namespace of this ontology, which can be used to create NamedNodes with URI's not listed in this file.
 *
 * First-party ontologies live on linked.cm: `https://linked.cm/ont/{ontologySlug}/`, and a
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
 * The prefix label equals the ontologySlug: `server-utils`. Before 1.7.0 it was
 * `lincd-server-utils`, which stays registered as a deprecated alias so `lincd-server-utils:X`
 * still expands. It is added FIRST: Prefix keeps every prefix → URI entry but only the last
 * URI → prefix one, so the namespace compacts to `server-utils:`.
 */
Prefix.add('lincd-server-utils', ns('').id);
Prefix.add('server-utils', ns('').id);

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

