//import * as neo4j from 'neo4j-driver';
import {ValidationError} from 'apollo-server';

const schemaDeleteMap = {
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
            type: "STATE_OF",
            direction: "in"
        }],
        nonblockingRelationships: [{
            type: "CHARACTER_OF",
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
            type: "ENTERED_BY",
            direction: "out"
        }]
    },
    Description: {
        blockingRelationships: [],
        cascadeRelationships: [{
            type: "DEFINED_BY",
            direction: "out"
        }, {
            type: "CANDIDATE_FOR",
            direction: "in"
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
            type: "ENTERED_BY",
            direction: "out"
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
            type: "ENTERED_BY",
            direction: "out"
        }]
    }, 
    Specimen: {
        blockingRelationships: [{
            type: "DESCRIBED_BY",
            direction: "out"
        }],
        cascadeRelationships: [],
        nonblockingRelationships: [{
            type: "IS_TYPE",
            direction: "out"
        }, {
            type: "EXAMPLE_OF",
            direction: "out"
        }, {
            type: "ENTERED_BY",
            direction: "out"
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
const schemaMap = {
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
        relationships:[]
    },
    Reference: {
        properties: [
           "title",
           "year",
           "publisher",
           "doi"
        ],
        relationships: [
            {
                type: "AUTHORED_BY",
                direction: "out",
                graphqlName: "authors",
                required: false,
                updatable: true
            }
        ]
    },
    Schema: {
        properties: [
           "title",
           "year"
        ],
        relationships: [
            {
                type: "CITED_BY",
                direction: "in",
                graphqlName: "references",
                required: false,
                updatable: true
            }, {
                type: "AUTHORED_BY",
                direction: "out",
                graphqlName: "authors",
                required: false,
                updatable: true
            }
        ]
    },
    Character: {
        properties: [
           "name",
           "definition"
        ],
        relationships: [
            {
                type: "CHARACTER_OF",
                direction: "out",
                graphqlName: "schemaID",
                required: true,
                updatable: false
            }
        ]
    },
    State: {
        properties: [
            "name",
            "definition"
        ],
        relationships: [
            {
                type: "STATE_OF",
                direction: "out",
                graphqlName: "parentID",
                required: true,
                updatable: true
            }
        ]
    },
    Description: {
        properties: [
            "type",
			"name",
			"family",
			"genus",
			"species"
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
                graphqlName: "specimenID",
                required: false,
                updatable: true
            }
        ]
    },
    Specimen: {
        properties: [
           "name",
           "locality",
           "preservationMode",
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
                updatable: true
            }, {
                type: "EXAMPLE_OF",
                direction: "out",
                graphqlName: "otuID",
                required: false,
                updatable: true
            }, {
                type: "IS_TYPE",
                direction: "out",
                graphqlName: "organID",
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
    
}

const getRelationships = async (session, pbotID, relationships) => {
    let queryStr = relationships.reduce((str, relationship) => `
        ${str}
        MATCH
            (n)${relationship.direction === "in" ? "<-" : "-"}[:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(r) 
        WHERE n.pbotID="${pbotID}"
        RETURN 
            r
        UNION ALL
    `,'');
    queryStr = queryStr.substring(0, queryStr.lastIndexOf("UNION ALL"))
    console.log(queryStr);
    
    //If our string is empty, there is nothing to query (i.e. no relationships to search for). Return empty array.
    if (queryStr === '') return [];
    
    let result;
    result = await session.run(
        queryStr,
        {pbotID: pbotID}
    )
    console.log("------result----------");
    console.log(result);
    console.log("records returned: " + result.records.length)
    const res = result.records.map((rec) => ({pbotID: rec.get(0).properties.pbotID, nodeType: rec.get(0).labels[0]}));
    console.log("res");
    console.log(res);
    return res;
}

const handleDelete = async (session, nodeType, pbotID, enteredByPersonID, relationships) => {
    console.log("handleDelete");
    
    let queryStr = `
        MATCH 
            (baseNode:${nodeType} {pbotID: "${pbotID}"}),
            (ePerson:Person {pbotID: "${enteredByPersonID}"})
        WITH baseNode, ePerson					
            CREATE
                (baseNode)-[:ENTERED_BY {timestamp: datetime(), type:"DELETE"}]->(ePerson)
        WITH baseNode	
            REMOVE baseNode:${nodeType} SET baseNode:_${nodeType}
        WITH baseNode
    `;
    
    queryStr = relationships.reduce((str, relationship) => `
        ${str}
            OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
            CALL apoc.do.when(
                rel IS NOT NULL,
                "CREATE (baseNode)${relationship.direction === "in" ? "<-" : "-"}[archivedRel:_${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(node) SET archivedRel = rel DELETE rel RETURN baseNode",
                "RETURN baseNode",
                {baseNode: baseNode, node: remoteNode, rel: rel}
            ) YIELD value
        WITH distinct value.baseNode AS baseNode 
    `, queryStr);
    
    queryStr = `
        ${queryStr}
        RETURN {
            pbotID: baseNode.pbotID
        }
    `;
        
    console.log(queryStr);
    
    const result = await session.run(queryStr);
    return result;
}

const handleUpdate = async (session, nodeType, data) => {
    console.log("handleUpdate");
    
    const pbotID = data.pbotID;
    const enteredByPersonID = data.enteredByPersonID
    
    const properties = schemaMap[nodeType].properties || [];
    let relationships = schemaMap[nodeType].relationships || [];
    relationships = relationships.filter(r => r.updatable);
    console.log("relationships");
    console.log(relationships);
    
    //Get base node and create new ENTERED_BY relationship
    let queryStr = `
        MATCH 
            (baseNode:${nodeType} {pbotID: "${pbotID}"}),
            (ePerson:Person {pbotID: "${enteredByPersonID}"})
        WITH baseNode, ePerson					
            CREATE
                (baseNode)-[eb:ENTERED_BY {timestamp: datetime(), type:"EDIT"}]->(ePerson)
        WITH baseNode, eb	
    `;
    
    //Copy old property values into ENTERED_BY
    queryStr = properties.reduce((str, property) => {
        if (data[property]) {
            return `
                ${str}
                    CALL apoc.do.case([
                        baseNode.${property} IS NULL,
                        "SET eb.${property} = 'not present' RETURN eb",
                        baseNode.${property} <> "${data[property]}",
                        "SET eb.${property} = baseNode.${property} RETURN eb"],
                        "RETURN eb",
                        {baseNode: baseNode, eb:eb}
                    ) YIELD value
                    WITH baseNode, eb
            `
        } else {
            return `
                ${str}
                    CALL apoc.do.when (
                        baseNode.${property} IS NOT NULL,
                        "SET eb.${property} = baseNode.${property} RETURN eb",
                        "RETURN eb",
                        {baseNode: baseNode, eb:eb}
                    ) YIELD value
                WITH baseNode, eb
            `            
        }
    }, queryStr);
    
    //Copy old relationships (as pbotID arrays) into ENTERED_BY. Also, go ahead and delete the relationships here for convenience.
    queryStr = relationships.reduce((str, relationship) => {
        if (Array.isArray(data[relationship.graphqlName])) {
            return `
                ${str}
                    OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                    WITH baseNode, eb, collect(remoteNode.pbotID) AS remoteNodeIDs, collect(rel) AS oldRels
                    FOREACH (r IN oldRels | DELETE r)
                    WITH distinct baseNode, remoteNodeIDs, apoc.coll.disjunction(remoteNodeIDs, ${JSON.stringify(data[relationship.graphqlName])} ) AS diffList, eb
                    CALL
                        apoc.do.case([
                            size(remoteNodeIDs) = 0 AND size(diffList) <> 0,
                            "SET eb.${relationship.graphqlName} = 'not present' RETURN eb",
                            size(diffList)<>0,
                            "SET eb.${relationship.graphqlName} = remoteNodeIDs RETURN eb"],
                            "RETURN eb",
                            {diffList: diffList, remoteNodeIDs: remoteNodeIDs, eb: eb}
                        )
                    YIELD value
                    WITH baseNode, eb
            `
        } else {
            if (data[relationship.graphqlName]) {
                return `
                    ${str}
                        OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                        DELETE rel
                        WITH baseNode, eb, remoteNode 	
                            CALL apoc.do.case([
                                    remoteNode IS NULL,
                                    "SET eb.${relationship.graphqlName} = 'not present' RETURN eb",
                                    remoteNode.pbotID  <> ${JSON.stringify(data[relationship.graphqlName])},
                                    "SET eb.${relationship.graphqlName} = remoteNode.pbotID RETURN eb"],
                                    "RETURN eb",
                                    {remoteNode: remoteNode, eb: eb}
                                ) YIELD value
                        WITH baseNode, eb
                `
            } else {
                return `
                    ${str}
                        OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                        DELETE rel
                        WITH baseNode, eb, remoteNode 	
                        CALL apoc.do.when(
                                remoteNode IS NOT NULL,
                                "SET eb.${relationship.graphqlName} = remoteNode.pbotID RETURN eb",
                                "RETURN eb",
                                {remoteNode: remoteNode, eb: eb}
                            ) YIELD value
                        WITH baseNode, eb
                `
            }
        }

    }, queryStr);
    
    //Set new property values in base node
    queryStr += `
        SET
    `;
    queryStr = properties.reduce((str, property) => `
        ${str}
            baseNode.${property} = ${JSON.stringify(data[property])},
    `, queryStr);
    queryStr = `
        ${queryStr.slice(0, queryStr.lastIndexOf(','))}
        WITH baseNode
    `;
    
    //Create new relationships
    queryStr = relationships.reduce((str, relationship) => {
        if (data[relationship.graphqlName] && data[relationship.graphqlName].length > 0) {
            return `
                ${str}
                    UNWIND ${JSON.stringify(data[relationship.graphqlName])} AS iD
                        CALL
                            apoc.do.when(
                                iD IS NULL,
                                "RETURN baseNode",
                                "MATCH (remoteNode) WHERE remoteNode.pbotID = iD CREATE (baseNode)${relationship.direction === "in" ? "<-" : "-"}[:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode) RETURN baseNode",
                                {iD:iD, baseNode:baseNode}
                            ) YIELD value
                    WITH distinct baseNode
            `
        } else {
            return str;
        }
    }, queryStr);
    
    queryStr = `
        ${queryStr}
        RETURN {
            pbotID: baseNode.pbotID
        }
    `;
        
    console.log(queryStr);
    
    const result = await session.run(queryStr);
    return result;
}

const handleCreate = async (session, nodeType, data) => {
    console.log("handleCreate");
    
    const pbotID = data.pbotID;
    const enteredByPersonID = data.enteredByPersonID
    
    const properties = schemaMap[nodeType].properties || [];
    const relationships = schemaMap[nodeType].relationships || [];
    
    //Get person node and create new ENTERED_BY relationship
    let queryStr = `
        MATCH 
            (ePerson:Person {pbotID: "${enteredByPersonID}"})
        WITH ePerson					
            CREATE
                (baseNode:${nodeType} {
                    pbotID: apoc.create.uuid()})-[eb:ENTERED_BY {timestamp: datetime(), type:"CREATE"}]->(ePerson)
        WITH baseNode	
        SET
    `;
    queryStr = properties.reduce((str, property) => `
        ${str}
            baseNode.${property} = ${JSON.stringify(data[property])},
    `, queryStr);
    queryStr = `
        ${queryStr.slice(0, queryStr.lastIndexOf(','))}
        WITH baseNode
    `;
    
    //Create new relationships
    queryStr = relationships.reduce((str, relationship) => {
        if (data[relationship.graphqlName] && data[relationship.graphqlName].length > 0) {
            return `
                ${str}
                    UNWIND ${JSON.stringify(data[relationship.graphqlName])} AS iD
                        MATCH (remoteNode) WHERE remoteNode.pbotID = iD 
                        CREATE (baseNode)${relationship.direction === "in" ? "<-" : "-"}[:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                    WITH distinct baseNode
            `
        } else {
            if (relationship.required) {
                throw new ValidationError(`Missing required relationship ${relationship.graphqlName}`);
            } else {
                return str;
            }
        }
    }, queryStr);
    
    queryStr = `
        ${queryStr}
        RETURN {
            pbotID: baseNode.pbotID
        }
    `;
        
    console.log(queryStr);
    
    const result = await session.run(queryStr);
    return result;
}

const mutateNode = async (context, nodeType, data, type) => {
    const driver = context.driver;
    const session = driver.session()
    
    try {
        const result = await session.writeTransaction(async tx => {
            let result;
            switch (type) {
                case "create": 
                    result = await handleCreate(
                        tx, 
                        nodeType, 
                        data       
                    );
                    break;
                case "update":
                    result = await handleUpdate(
                        tx, 
                        nodeType, 
                        data       
                    );
                    break;
                case "delete":
                    const pbotID = data.pbotID;
                    const enteredByPersonID = data.enteredByPersonID;
                    const cascade = data.cascade || false;
                   
                    console.log(cascade ? 
                            schemaDeleteMap[nodeType].blockingRelationships : 
                            [...schemaDeleteMap[nodeType].blockingRelationships, ...schemaDeleteMap[nodeType].cascadeRelationships]);
                    const blockingRelationships = await getRelationships(
                        tx, 
                        pbotID, 
                        cascade ? 
                            schemaDeleteMap[nodeType].blockingRelationships : 
                            [...schemaDeleteMap[nodeType].blockingRelationships, ...schemaDeleteMap[nodeType].cascadeRelationships]
                    );
                    if (blockingRelationships.length > 0) {
                        console.log("cannot delete");
                        throw new ValidationError(`${nodeType} has blocking relationships`);
                    } else {
                        if (cascade) {
                            const remoteNodes = await getRelationships(
                                tx, 
                                pbotID, 
                                schemaDeleteMap[nodeType].cascadeRelationships
                            );
                            console.log("remoteNodes");
                            console.log(remoteNodes);
                            await Promise.all(remoteNodes.map(node => {
                                console.log(node);
                                return mutateNode(context, node.nodeType, {pbotID: node.pbotID, enteredByPersonID: enteredByPersonID, cascade: cascade}, "delete")
                            })).catch(error => {
                                console.log(error);
                                throw new ValidationError(`Unable to cascade delete ${nodeType}`);
                            });
                        }
                            
                        result = await handleDelete(
                            tx, 
                            nodeType, 
                            pbotID, 
                            enteredByPersonID, 
                            schemaDeleteMap[nodeType].nonblockingRelationships        
                        );
                    }
                    break;
                default: 
                    throw new Exception("Invalid mutation type");
            }
                    
            console.log("result");
            console.log(result);
            return result.records[0]._fields[0];
        });
        return result;            
    } finally {
        await session.close();
    }
}

export const Resolvers = {
    Mutation: {
        DeleteReference: async (obj, args, context, info) => {
            console.log("DeleteReference");
            return await mutateNode(context, "Reference", args.data, "delete");
        },

        DeleteSchema: async (obj, args, context, info) => {
            console.log("DeleteSchema");
            return await mutateNode(context, "Schema", args.data, "delete");
        },
        
        DeleteCharacter: async (obj, args, context, info) => {
            console.log("DeleteCharacter");
            return await mutateNode(context, "Character", args.data, "delete");
        },

        DeleteState: async (obj, args, context, info) => {
            console.log("DeleteCharacter");
            return await mutateNode(context, "State", args.data, "delete");
        },

        DeleteDescription: async (obj, args, context, info) => {
            console.log("DeleteDescription");
            return await mutateNode(context, "Description", args.data, "delete");
        },

        DeleteCharacterInstance: async (obj, args, context, info) => {
            console.log("DeleteCharacterInstance");
            return await mutateNode(context, "CharacterInstance", args.data, "delete");
        },

        DeleteSpecimen: async (obj, args, context, info) => {
            console.log("DeleteSpecimen");
            return await mutateNode(context, "Specimen", args.data, "delete");
        },        

        DeleteGroup: async (obj, args, context, info) => {
            console.log("DeleteGroup");
            return await mutateNode(context, "Group", args.data, "delete");
        },

        DeletePerson: async (obj, args, context, info) => {
            console.log("DeletePerson");
            throw new ValidationError(`Cannot delete Person nodes`);
        },        

        DeleteOrgan: async (obj, args, context, info) => {
            console.log("DeleteOrgan");
            throw new ValidationError(`Cannot delete Organ nodes`);
        },        
     
        UpdateGroup: async (obj, args, context, info) => {
            console.log("UpdateGroup");
            return await mutateNode(context, "Group", args.data, "update");
        },

        UpdatePerson: async (obj, args, context, info) => {
            console.log("UpdatePerson");
            return await mutateNode(context, "Person", args.data, "update");
        },

        UpdateReference: async (obj, args, context, info) => {
            console.log("UpdateReference");
            return await mutateNode(context, "Reference", args.data, "update");
        },

        UpdateSchema: async (obj, args, context, info) => {
            console.log("UpdateSchema");
            return await mutateNode(context, "Schema", args.data, "update");
        },
        
        UpdateCharacter: async (obj, args, context, info) => {
            console.log("UpdateCharacter");
            return await mutateNode(context, "Character", args.data, "update");
        },

        UpdateState: async (obj, args, context, info) => {
            console.log("UpdateState");
            return await mutateNode(context, "State", args.data, "update");
        },
        
        UpdateDescription: async (obj, args, context, info) => {
            console.log("UpdateDescription");
            return await mutateNode(context, "Description", args.data, "update");
        },

        UpdateSpecimen: async (obj, args, context, info) => {
            console.log("UpdateSpecimen");
            return await mutateNode(context, "Specimen", args.data, "update");
        },

        UpdateOrgan: async (obj, args, context, info) => {
            console.log("UpdateOrgan");
            return await mutateNode(context, "Organ", args.data, "update");
        },
        
        CreateGroup: async (obj, args, context, info) => {
            console.log("CreateGroup");
            return await mutateNode(context, "Group", args.data, "create");
        },

        CreatePerson: async (obj, args, context, info) => {
            console.log("CreatePerson");
            return await mutateNode(context, "Person", args.data, "create");
        },

        CreateReference: async (obj, args, context, info) => {
            console.log("CreateReference");
            return await mutateNode(context, "Reference", args.data, "create");
        },
        
        CreateSchema: async (obj, args, context, info) => {
            console.log("CreateSchema");
            return await mutateNode(context, "Schema", args.data, "create");
            
        },
        
        CreateCharacter: async (obj, args, context, info) => {
            console.log("CreateCharacter");
            return await mutateNode(context, "Character", args.data, "create");
            
        },
        
        CreateState: async (obj, args, context, info) => {
            console.log("CreateState");
            return await mutateNode(context, "State", args.data, "create");
            
        },
        
        CreateDescription: async (obj, args, context, info) => {
            console.log("CreateDescription");
            return await mutateNode(context, "Description", args.data, "create");
            
        },

        CreateSpecimen: async (obj, args, context, info) => {
            console.log("CreateSpecimen");
            return await mutateNode(context, "Specimen", args.data, "create");
            
        },

        CreateOrgan: async (obj, args, context, info) => {
            console.log("CreateOrgan");
            return await mutateNode(context, "Organ", args.data, "create");
            
        },

    }
};
