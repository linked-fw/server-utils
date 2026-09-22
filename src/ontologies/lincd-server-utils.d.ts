/**
 * Load the data of this ontology into memory, thus adding the properties of the entities of this ontology to the local graph.
 */
export declare var loadData: () => Promise<{
    "@context": {
        dc: string;
        owl: string;
        rdf: string;
        rdfs: string;
        "lincd-server-utils": string;
    };
    "@graph": {
        "@id": string;
        "@type": string;
        "rdfs:comment": string;
        "rdfs:isDefinedBy": {
            "@id": string;
        };
        "rdfs:label": string;
    }[];
}>;
/**
 * The namespace of this ontology, which can be used to create NamedNodes with URI's not listed in this file
 */
export declare var ns: (term: string) => import("@_linked/core/utils/NodeReference").NodeReferenceValue;
/**
 * The NamedNode of the ontology itself
 */
export declare var _self: import("@_linked/core/utils/NodeReference").NodeReferenceValue;
export declare var Lincd_API_Client: import("@_linked/core/utils/NodeReference").NodeReferenceValue;
export declare const lincdServerUtils: {
    Lincd_API_Client: import("@_linked/core/utils/NodeReference").NodeReferenceValue;
};
