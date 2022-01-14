//import * as neo4j from 'neo4j-driver';
import {ValidationError} from 'apollo-server';

const relationshipMap = {
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

const deleteNode = async (tx, nodeType, pbotID, enteredByPersonID, cascade = false) => {
    console.log("cascade=" + cascade);
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
                return deleteNode(tx, node.nodeType, node.pbotID, enteredByPersonID, cascade)
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
}


export const DeletionResolvers = {
    Mutation: {
        DeleteReference: async (obj, args, context, info) => {
            console.log("DeleteReference");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {
                    return await deleteNode(tx, "Reference", args.data.pbotID, args.data.enteredByPersonID);
                });
            } finally {
                await session.close();
            }
            return result;            
        },

        DeleteSchema: async (obj, args, context, info) => {
            console.log("DeleteSchema");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {
                    return await deleteNode(tx, "Schema", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
                });
            } finally {
                await session.close();
            }
            return result;            
        },
        
        DeleteCharacter: async (obj, args, context, info) => {
            console.log("DeleteCharacter");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {
                    return await deleteNode(tx, "Character", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
                });
            } finally {
                await session.close();
            }
            return result;            
        },

        DeleteState: async (obj, args, context, info) => {
            console.log("DeleteCharacter");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {
                    return await deleteNode(tx, "State", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
                });
            } finally {
                await session.close();
            }
            return result;            
        },

        DeleteDescription: async (obj, args, context, info) => {
            console.log("DeleteDescription");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {
                    return await deleteNode(tx, "Description", args.data.pbotID, args.data.enteredByPersonID, args.data.cascade);
                });
            } finally {
                await session.close();
            }
            return result;            
        },

        DeleteCharacterInstance: async (obj, args, context, info) => {
            console.log("DeleteCharacterInstance");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {
                    return await deleteNode(tx, "CharacterInstance", args.data.pbotID, args.data.enteredByPersonID);
                });
            } finally {
                await session.close();
            }
            return result;            
        },

        DeleteSpecimen: async (obj, args, context, info) => {
            console.log("DeleteSpecimen");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {
                    return await deleteNode(tx, "Specimen", args.data.pbotID, args.data.enteredByPersonID);
                });
            } finally {
                await session.close();
            }
            return result;            
        },        

        DeletePerson: async (obj, args, context, info) => {
            console.log("DeletePerson");
            throw new ValidationError(`Cannot delete Person nodes`);
        },        

        DeleteOrgan: async (obj, args, context, info) => {
            console.log("DeleteOrgan");
            throw new ValidationError(`Cannot delete Organ nodes`);
        },        
        
    }
};

