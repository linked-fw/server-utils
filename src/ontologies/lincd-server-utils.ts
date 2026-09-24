import { Prefix } from '@_linked/core/utils/Prefix';
import { createNameSpace } from '@_linked/core/utils/NameSpace';

/**
 * Load the data of this ontology into memory, thus adding the properties of the entities of this ontology to the local graph.
 */
export var loadData = () => {
  //@ts-ignore
  return import('../data/lincd-server-utils.json', {
    with: { type: 'json' },
  }).then((data) => data.default);
};

/**
 * The namespace of this ontology, which can be used to create NamedNodes with URI's not listed in this file
 */
export var ns = createNameSpace('http://lincd.org/ont/lincd-server-utils/');
Prefix.add('lincd-server-utils', 'http://lincd.org/ont/lincd-server-utils/');

/**
 * The NamedNode of the ontology itself
 */
export var _self = ns('');

//A list of all the entities (Classes & Properties) of this ontology, each exported as a NamedNode
export var Lincd_API_Client = ns('Lincd_API_Client');

//An extra grouping object so all the entities can be accessed from the prefix/name
export const lincdServerUtils = {
  Lincd_API_Client,
};

