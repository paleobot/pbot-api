export const schemaDeleteMap = {
    Person: {
        blockingRelationships: [{
            type: "ENTERED_BY",
            direction: "in"
        }, {
            type: "AUTHORED_BY",
            direction: "in"
        }],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "MEMBER_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }]
    },
    Group: {
        blockingRelationships: [{
            type: "MEMBER_OF",
            direction: "in"
        }, {
            type: "ITEM_OF",
            direction: "in"
        }],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "ENTERED_BY",
            direction: "out"
        }]
    }, 
    Reference: {
        blockingRelationships: [{
            type: "CITED_BY",
            direction: "out"
        }],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "AUTHORED_BY",
            direction: "out"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }]
    }, 
    Schema: {
        blockingRelationships:  [{
            type: "APPLICATION_OF",
            direction: "in"
        }],
        cascadeRelationships: [{
            type: "CHARACTER_OF",
            direction: "in"
        }],
        nonblockingRelationships: [{
            type: "AUTHORED_BY",
            direction: "out"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }, {
            type: "CITED_BY",
            direction: "in"
        }]
    }, 
    Character: {
        blockingRelationships: [{
            type: "INSTANCE_OF",
            direction: "in"
        }],
        cascadeRelationships: [{
            type: "CHARACTER_OF",
            direction: "in"
        }, {
            type: "STATE_OF",
            direction: "in"
        }],
        nonblockingRelationships: [{
            type: "CHARACTER_OF",
            direction: "out"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }]
    },
    State: {
        blockingRelationships: [{
            type: "HAS_STATE",
            direction: "in"
        }],
        cascadeRelationships: [{
            type: "STATE_OF",
            direction: "in"
        }],
        nonblockingRelationships: [{
            type: "STATE_OF",
            direction: "out"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }]
    },
    Description: {
        blockingRelationships: [],
        cascadeRelationships: [{
            type: "DEFINED_BY",
            direction: "out"
        }],
        nonblockingRelationships: [{
            type: "APPLICATION_OF",
            direction: "out"
        }, {
            type: "DESCRIBED_BY",
            direction: "in"
        }, {
            type: "EXAMPLE_OF",
            direction: "in"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }, {
            type: "CITED_BY",
            direction: "in"
        }]
    },
    CharacterInstance: {
        blockingRelationships: [],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "CANDIDATE_FOR",
            direction: "out"
        }, {
            type: "DEFINED_BY",
            direction: "in"
        }, {
            type: "INSTANCE_OF",
            direction: "out"
        }, {
            type: "HAS_STATE",
            direction: "out"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }]
    }, 
    OTU: {
        blockingRelationships: [{
            type: "SAME_AS",
            direction: "out"
        }],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "EXAMPLE_OF",
            direction: "out"
        }, {
            type: "HOLOTYPE_OF",
            direction: "out",
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }, {
            type: "CITED_BY",
            direction: "in"
        }]
    },
    Synonym: {
        blockingRelationships: [],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "SAME_AS",
            direction: "in"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }, {
            type: "CITED_BY",
            direction: "in"
        }]
    },
    Comment: {
        blockingRelationships: [{
            type: "REFERS_TO",
            direction: "in"
        }],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "REFERS_TO",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }, {
            type: "CITED_BY",
            direction: "in"
        }]
    },
    Specimen: {
        blockingRelationships: [{
            type: "DESCRIBED_BY",
            direction: "out",
        }, {
            type: "HOLOTYPE_OF",
            direction: "out",
        }],
        cascadeRelationships: [{
            type: "IMAGE_OF",
            direction: "in"
        }], 
        nonblockingRelationships: [{
            type: "IS_TYPE",
            direction: "out"
        }, {
            type: "PRESERVED_BY",
            direction: "out"
        }, {
            type: "EXAMPLE_OF",
            direction: "out"
        }, {
            type: "COLLECTED_IN",
            direction: "out"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }, {
            type: "CITED_BY",
            direction: "in"
        }]
    }, 
    Image: {
        blockingRelationships: [],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "IMAGE_OF",
            direction: "out"
        }, {
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }]
    }, 
    Collection: {
        blockingRelationships: [],
        cascadeRelationships: [{
            type: "COLLECTED_IN",
            direction: "in"
        }, ],
        nonblockingRelationships: [{
            type: "ELEMENT_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
        }, {
            type: "CITED_BY",
            direction: "in"
        }]
    }, 
}

//In theory, the information contained in this map is already in the schema definion in schema.graphql.
//However, accessing that information is a challenge. For instance, say we want a list of the properties 
//allowed for a given node type. We have to do something like this:
//      Object.keys(context.schema._typeMap.GroupInput._fields)
//That's ugly. And it's not quite right. The resulting list will include properties we've mapped to 
//Cypher relationships. We need to exclude those. Also, we don't really want pbotID or enteredByPersonID for our purposes, 
//so we have to do this:
//      Object.keys(context.schema._typeMap.GroupInput._fields).filter(property => !["pbotID", "enteredByPersonID"].includes(property) && !context.schema._typeMap.GroupInput._fields[property].type.ofType)
//Beyond ugly.
//And we also need to be able to get a list of relationships that includes both their Cypher name and their graphql name.
//There is probably a way to get this from schema.graphql, but it's probably terrible.
//So, I'm ok with the extra maintenance required by this map.
//
//It's important to note that the relationships listed here for each node type are only the relationships 
//we want a mutation on that node type to have access to. For instance, the Specimen type below does not include 
//EXAMPLE_OF and HOLOTYPE_OF because we don't want mutations on Specimen to modify these. They are only modified
//by OTU.
export const schemaMap = {
    Group: {
        properties: ["name"],
        relationships: [
            {
                type: "MEMBER_OF",
                direction: "in",
                graphqlName: "members",
                required: false,
                updatable: true
            }
        ]
    },
    Person: {
        properties: [
            "given",
            "surname",
            "email",
            "orcid"
        ],
        relationships:[
            {
                type: "MEMBER_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
            
        ]
    },
    Reference: {
        properties: [
           "title",
           "year",
           "publisher",
           "doi",
           "pbdbid"
        ],
        relationships: [
            {
                type: "AUTHORED_BY",
                direction: "out",
                graphqlName: "authors",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order"
                ]
            },
            {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    Schema: {
        properties: [
           "title",
           "year",
           "acknowledgments"
        ],
        relationships: [
            {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            }, {
                type: "AUTHORED_BY",
                direction: "out",
                graphqlName: "authors",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            },
            {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    Character: {
        properties: [
           "name",
           "definition",
           "order"
        ],
        relationships: [
            {
                type: "CHARACTER_OF",
                direction: "out",
                graphqlName: "parentID",
                required: true,
                updatable: true
            },
            {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    State: {
        properties: [
            "name",
            "definition",
            "order"
        ],
        relationships: [
            {
                type: "STATE_OF",
                direction: "out",
                graphqlName: "parentID",
                required: true,
                updatable: true
            },
            {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    Description: {
        properties: [
			"name",
        ],
        relationships: [
            {
                type: "APPLICATION_OF",
                direction: "out",
                graphqlName: "schemaID",
                required: true,
                updatable: true
            }, {
                type: "DESCRIBED_BY",
                direction: "in",
                graphqlName: "specimenIDs",
                required: false,
                updatable: true
            }, {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            }, {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    OTU: {
        properties: [
			"name",
			"family",
			"genus",
			"species"
        ],
        relationships: [{
                type: "EXAMPLE_OF",
                direction: "in",
                graphqlName: "exampleSpecimens",
                required: true,
                updatable: true
            }, {
                type: "HOLOTYPE_OF",
                direction: "in",
                graphqlName: "holotype",
                required: true,
                updatable: true
            }, {
                type: "SAME_AS",
                direction: "out",
                graphqlName: "synonyms",
                required: false,
                updatable: true
            }, {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            }, {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    Synonym: {
        properties: [
            "explanation",
        ],
        relationships: [
            {
                type: "SAME_AS",
                direction: "in",
                graphqlName: "otus",
                required: true,
                updatable: true
            }, {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            }, {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    Comment: {
        properties: [
            "content"
        ],
        relationships: [
            {
                type: "REFERS_TO",
                direction: "out",
                graphqlName: "subjectID",
                required: true,
                updatable: true
            }, {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            }        
        ]
    },
    Specimen: {
        //TODO: look into https://www.graphql-scalars.dev/docs/scalars/uuid for managing idigbiouuid
        properties: [
           "name",
           "idigbiouuid",
           "pbdbcid",
           "pbdboccid"
        ],
        relationships: [
            {
                type: "DESCRIBED_BY",
                direction: "out",
                graphqlName: "descriptionID",
                required: false,
                updatable: true,
            }, {
                type: "IS_TYPE",
                direction: "out",
                graphqlName: "organIDs",
                required: true,
                updatable: true
            }, {
                type: "PRESERVED_BY",
                direction: "out",
                graphqlName: "preservationModeID",
                required: true,
                updatable: true
            }, {
                type: "COLLECTED_IN",
                direction: "out",
                graphqlName: "collection",
                required: false,
                updatable: true
            }, {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            }, {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    Organ: {
        properties: [
           "type"
        ],
        relationships: []
    },
    PreservationMode: {
        properties: [
           "name"
        ],
        relationships: []
    },
    Collection: {
        properties: [
            "name",
            "collectionType",
            "sizeClasses",
            "mininterval",
            "maxinterval",
            "lithology",
            "environment",
            "collectors",
            "lat",
            "lon",
            "country",
            "pbdbid"
        ],
        relationships: [
            {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true,
                properties: [
                    "pbotID",
                    "order",
                ]
            }, {
                type: "PRESERVED_BY",
                direction: "out",
                graphqlName: "preservationModeIDs",
                required: true,
                updatable: true
            }, {
                type: "COLLECTED_IN",
                direction: "in",
                graphqlName: "specimens",
                required: false,
                updatable: false
            }, {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: false,
                updatable: true
            }
        ]
    },
    Image: {
        properties: [
           "link",
           "citation",
           "caption",
           "type"
        ],
        relationships: [
            {
                type: "IMAGE_OF",
                direction: "out",
                graphqlName: "imageOf",
                required: true,
                updatable: true,
            },
            {
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
            }
        ]
    },
    
}
