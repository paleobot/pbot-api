//import * as neo4j from 'neo4j-driver';
import {ValidationError} from 'apollo-server';

const relationshipMap = {
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

const updateMap = {
    Group: {
        properties: ["name"],
        relationships: [{
            type: "MEMBER_OF",
            direction: "in",
            graphqlName: "members"
        }]
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
        relationships: [{
            type: "AUTHORED_BY",
            direction: "out",
            graphqlName: "authors"
        }]
    }
        
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

const deleteNode = async (context, nodeType, pbotID, enteredByPersonID, cascade = false) => {
    console.log("cascade=" + cascade);
    
    const driver = context.driver;
    const session = driver.session()
    
    try {
        const result = await session.writeTransaction(async tx => {
            console.log(cascade ? 
                    relationshipMap[nodeType].blockingRelationships : 
                    [...relationshipMap[nodeType].blockingRelationships, ...relationshipMap[nodeType].cascadeRelationships]);
            const blockingRelationships = await getRelationships(
                tx, 
                pbotID, 
                cascade ? 
                    relationshipMap[nodeType].blockingRelationships : 
                    [...relationshipMap[nodeType].blockingRelationships, ...relationshipMap[nodeType].cascadeRelationships]
            );
            if (blockingRelationships.length > 0) {
                console.log("cannot delete");
                throw new ValidationError(`${nodeType} has blocking relationships`);
            } else {
                if (cascade) {
                    const remoteNodes = await getRelationships(
                        tx, 
                        pbotID, 
                        relationshipMap[nodeType].cascadeRelationships
                    );
                    console.log("remoteNodes");
                    console.log(remoteNodes);
                    await Promise.all(remoteNodes.map(node => {
                        console.log(node);
                        return deleteNode(context, node.nodeType, node.pbotID, enteredByPersonID, cascade)
                    })).catch(error => {
                        console.log(error);
                        throw new ValidationError(`Unable to cascade delete ${nodeType}`);
                    });
                }
                    
                const result = await handleDelete(
                    tx, 
                    nodeType, 
                    pbotID, 
                    enteredByPersonID, 
                    relationshipMap[nodeType].nonblockingRelationships        
                );
                console.log("result");
                console.log(result);
                return result.records[0]._fields[0];
            }
        });
        return result;            
    } finally {
        await session.close();
    }
}




const handleUpdate = async (session, nodeType, data) => {
    console.log("handleUpdate");
    
    const pbotID = data.pbotID;
    const enteredByPersonID = data.enteredByPersonID
    
    const properties = updateMap[nodeType].properties;
    const relationships = updateMap[nodeType].relationships;
    
    let queryStr = `
        MATCH 
            (baseNode:${nodeType} {pbotID: "${pbotID}"}),
            (ePerson:Person {pbotID: "${enteredByPersonID}"})
        WITH baseNode, ePerson					
            CREATE
                (baseNode)-[eb:ENTERED_BY {timestamp: datetime(), type:"EDIT"}]->(ePerson)
        WITH baseNode, eb	
    `;
    
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
                    CALL apoc.do.when ([
                        baseNode.${property} IS NOT NULL
                        "SET eb.${property} = baseNode.${property} RETURN eb"],
                        "RETURN eb",
                        {baseNode: baseNode, eb:eb}
                    ) YIELD value
                WITH baseNode, eb
            `            
        }
    }, queryStr);
    
    queryStr = relationships.reduce((str, relationship) => `
        ${str}
            OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
            WITH baseNode, eb, collect(remoteNode.pbotID) AS remoteNodeIDs, collect(rel) AS oldRels
            FOREACH (r IN oldRels | DELETE r)
            WITH distinct baseNode, remoteNodeIDs, apoc.coll.disjunction(remoteNodeIDs, ${JSON.stringify(data[relationship.graphqlName])} ) AS diffList, eb
            CALL
                apoc.do.when(
                    SIZE(diffList)<>0,
                    "SET eb.${relationship.graphqlName} = remoteNodeIDs RETURN eb",
                    "RETURN eb",
                    {diffList: diffList, remoteNodeIDs: remoteNodeIDs, eb: eb}
                )
            YIELD value
            WITH baseNode, eb
    `, queryStr);
    
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

const updateNode = async (context, nodeType, data) => {
    const driver = context.driver;
    const session = driver.session()
    
    try {
        const result = await session.writeTransaction(async tx => {
                //I'm leaving this is for a while as record for how to get at the properties if we don't use an explicit map:
                //This is a little weird. We want a list of the properties of this node type. But we don't want the pbotID and entererByPersonID. That parts easy. But we also don't want properties that are arrays (those are relationships). The best way I've found is the weird ofType thing below. I don't like it, but it works.
                //const properties = Object.keys(context.schema._typeMap.GroupInput._fields).filter(property => !["pbotID", "enteredByPersonID"].includes(property) && !context.schema._typeMap.GroupInput._fields[property].type.ofType)
                //console.log(properties);

            const result = await handleUpdate(
                    tx, 
                    nodeType, 
                    data       
                );
                console.log("result");
                console.log(result);
                return result.records[0]._fields[0];
        });
        return result;            
    } finally {
        await session.close();
    }
}





export const DeletionResolvers = {
    Mutation: {
        DeleteReference: async (obj, args, context, info) => {
            console.log("DeleteReference");
            return await deleteNode(context, "Reference", args.data.pbotID, args.data.enteredByPersonID);
        },

        DeleteSchema: async (obj, args, context, info) => {
            console.log("DeleteSchema");
            return await deleteNode(context, "Schema", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
        },
        
        DeleteCharacter: async (obj, args, context, info) => {
            console.log("DeleteCharacter");
            return await deleteNode(context, "Character", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
        },

        DeleteState: async (obj, args, context, info) => {
            console.log("DeleteCharacter");
            return await deleteNode(context, "State", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
        },

        DeleteDescription: async (obj, args, context, info) => {
            console.log("DeleteDescription");
            return await deleteNode(context, "Description", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
        },

        DeleteCharacterInstance: async (obj, args, context, info) => {
            console.log("DeleteCharacterInstance");
            return await deleteNode(context, "CharacterInstance", args.data.pbotID, args.data.enteredByPersonID);
        },

        DeleteSpecimen: async (obj, args, context, info) => {
            console.log("DeleteSpecimen");
            return await deleteNode(context, "Specimen", args.data.pbotID, args.data.enteredByPersonID);
        },        

        DeleteGroup: async (obj, args, context, info) => {
            console.log("DeleteGroup");
            console.log(Object.keys(context.schema._typeMap.GroupInput._fields));
            return await deleteNode(context, "Group", args.data.pbotID, args.data.enteredByPersonID);
        },

        DeletePerson: async (obj, args, context, info) => {
            console.log("DeletePerson");
            throw new ValidationError(`Cannot delete Person nodes`);
        },        

        DeleteOrgan: async (obj, args, context, info) => {
            console.log("DeleteOrgan");
            throw new ValidationError(`Cannot delete Organ nodes`);
        },        
     
        CustomUpdateGroup: async (obj, args, context, info) => {
            console.log("CustomUpdateGroup");
            return await updateNode(context, "Group", args.data);
        },

        CustomUpdatePerson: async (obj, args, context, info) => {
            console.log("CustomUpdatePerson");
            return await updateNode(context, "Person", args.data);
        },

        CustomUpdateReference: async (obj, args, context, info) => {
            console.log("CustomUpdateReference");
            return await updateNode(context, "Reference", args.data);
        },
        
    }
};

