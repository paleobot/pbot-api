//import * as neo4j from 'neo4j-driver';

const hasRelationships = async (session, pbotID, relationships) => {
    let queryStr = relationships.reduce((str, relationship) => `
        ${str}
        MATCH
            (n) WHERE n.pbotID="${pbotID}"
        WITH n
            OPTIONAL MATCH 
                (n)${relationship.direction === "in" ? "<-" : "-"}[r:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}()
        RETURN 
            r
        UNION ALL
    `,'');
    queryStr = queryStr.substring(0, queryStr.lastIndexOf("UNION ALL"))
    console.log(queryStr);
    
    let result;
    result = await session.run(
        queryStr,
        {pbotID: pbotID}
    )
    console.log("------result----------");
    console.log(result);
    console.log("records returned: " + result.records.length)
    //check each record for non-null
    const res = result.records.reduce((acc, rec) => acc || (rec._fields[0] !== null), false);
    //result = result.records.length > 0; //TODO: !!!!!!!this doesn't work. Need to check each record for null
    //console.log("res = " + res);
    //console.log("returning " + result);
    //return result;
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
            pbotID: baseNode.pbotID + " deleted"
        }
    `;
        
    console.log(queryStr);
    //return queryStr;
    
    const result = await session.run(queryStr);
    return result;
}


export const DeletionResolvers = {
    Mutation: {
        CustomDeleteReference: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {           
                    if (await hasRelationships(
                        tx, 
                        args.data.pbotID, 
                        [{
                            type: "CITED_BY",
                            direction: "out"
                        }]
                    )) {
                        console.log("cannot delete");
                        return {pbotID: "Cannot delete " + args.data.pbotID}
                    } else {
                        console.log("can delete");
                        const result = await handleDelete(
                            tx, 
                            'Reference', 
                            args.data.pbotID, 
                            args.data.enteredByPersonID, 
                            [{
                                type: "AUTHORED_BY",
                                direction: "out"
                            }, {
                                type: "ENTERED_BY",
                                direction: "out"
                            }]
                        );
                        //return {pbotID: "Can delete " + args.data.pbotID}
                        /*
                        * handleDelete generates this, but with generalized variable names
                        const result = await session.run(
                            `
                            MATCH 
                                (reference:Reference {pbotID: $pbotID}),
                                (ePerson:Person {pbotID: $enteredByPersonID})
                            WITH reference, ePerson					
                                CREATE
                                    (reference)-[:ENTERED_BY {timestamp: datetime(), type:"DELETE"}]->(ePerson)
                            WITH reference	
                                REMOVE reference:Reference SET reference:_Reference
                            WITH reference
                                OPTIONAL MATCH (reference)-[authoredBy:AUTHORED_BY]->(node)
                                CALL apoc.do.when(
                                    authoredBy IS NOT NULL,
                                    "CREATE (reference)-[archivedAuthoredBy:_AUTHORED_BY]->(node) SET archivedAuthoredBy = authoredBy DELETE authoredBy RETURN reference",
                                    "RETURN reference",
                                    {reference: reference, node: node, authoredBy: authoredBy}
                                ) YIELD value
                            WITH distinct value.reference AS reference 
                            RETURN {
                                pbotID: reference.pbotID + " deleted"
                            } 
                            `,
                            {pbotID: args.data.pbotID, enteredByPersonID: args.data.enteredByPersonID}
                        );
                        */
                        console.log("result");
                        console.log(result);
                        return result.records[0]._fields[0];
                    }
                });
            } finally {
                await session.close();
            }
            return result;
            
        },
        
        CustomDeleteSchema: async (obj, args, context, info) => {
            console.log("CustomDeleteSchema");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {           
                    if (await hasRelationships(
                        tx, 
                        args.data.pbotID, 
                        [{
                            type: "APPLICATION_OF",
                            direction: "in"
                        }, {
                            type: "CHARACTER_OF",
                            direction: "in"
                        }]
                    )) {
                        console.log("cannot delete");
                        return {pbotID: "Cannot delete " + args.data.pbotID}
                    } else {
                        console.log("can delete");
                        const result = await handleDelete(
                            tx, 
                            'Schema', 
                            args.data.pbotID, 
                            args.data.enteredByPersonID, 
                            [{
                                type: "AUTHORED_BY",
                                direction: "out"
                            }, {
                                type: "ENTERED_BY",
                                direction: "out"
                            }, {
                                type: "CITED_BY",
                                direction: "in"
                            }]);
                        //return {pbotID: "Can delete " + args.data.pbotID}
                        /*
                        * handleDelete generates this, but with generalized variable names
                        const result = await session.run(
                            `
                            MATCH 
                                (schema:Schema {pbotID: $pbotID}),
                                (ePerson:Person {pbotID: $enteredByPersonID})
                            WITH schema, ePerson					
                                CREATE
                                    (schema)-[:ENTERED_BY {timestamp: datetime(), type:"DELETE"}]->(ePerson)
                            WITH schema	
                                REMOVE schema:Schema SET schema:_Schema
                            WITH schema
                                OPTIONAL MATCH (schema)-[authoredBy:AUTHORED_BY]->(node1)
                                CALL apoc.do.when(
                                    authoredBy IS NOT NULL,
                                    "CREATE (schema)-[archivedAuthoredBy:_AUTHORED_BY]->(node) SET archivedAuthoredBy = authoredBy DELETE authoredBy RETURN schema",
                                    "RETURN schema",
                                    {schema: schema, node: node1, authoredBy: authoredBy}
                                ) YIELD value
                            WITH distinct value.schema AS schema 
                                OPTIONAL MATCH (schema)-[enteredBy:ENTERED_BY]->(node2)
                                CALL apoc.do.when(
                                    enteredBy IS NOT NULL,
                                    "CREATE (schema)-[archivedEnteredBy:_ENTERED_BY]->(node) SET archivedEnteredBy = enteredBy DELETE enteredBy RETURN schema",
                                    "RETURN schema",
                                    {schema: schema, node: node2, enteredBy: enteredBy}
                                ) YIELD value
                            WITH distinct value.schema AS schema 
                                OPTIONAL MATCH (schema)<-[citedBy:CITED_BY]-(node3)
                                CALL apoc.do.when(
                                    citedBy IS NOT NULL,
                                    "CREATE (schema)<-[archivedCitedBy:_CITED_BY]-(node) SET archivedCitedBy = citedBy DELETE citedBy RETURN schema",
                                    "RETURN schema",
                                    {schema: schema, node: node3, citedBy: citedBy}
                                ) YIELD value
                            WITH distinct value.schema AS schema
                            RETURN {
                                pbotID: schema.pbotID + " deleted"
                            } 
                            `,
                            {pbotID: args.data.pbotID, enteredByPersonID: args.data.enteredByPersonID}
                        );
                        */
                        console.log("result");
                        console.log(result);
                        return result.records[0]._fields[0];
                    }
                });
            } finally {
                await session.close();
            }
            return result;            
        },

        CustomDeleteCharacter: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            let result;
            try {
                result = await session.writeTransaction(async tx => {           
                    if (await hasRelationships(
                        tx, 
                        args.data.pbotID, 
                        [{
                            type: "STATE_OF",
                            direction: "in"
                        }, {
                            type: "INSTANCE_OF",
                            direction: "in"
                        }]
                    )) {
                        console.log("cannot delete");
                        return {pbotID: "Cannot delete " + args.data.pbotID}
                    } else {
                        console.log("can delete");
                        const result = await handleDelete(
                            tx, 
                            'Character', 
                            args.data.pbotID, 
                            args.data.enteredByPersonID, 
                            [{
                                type: "CHARACTER_OF",
                                direction: "out"
                            }, {
                                type: "ENTERED_BY",
                                direction: "out"
                            }]
                        );
                        console.log("result");
                        console.log(result);
                        return result.records[0]._fields[0];
                    }
                });
            } finally {
                await session.close();
            }
            return result;
        },

        CustomDeleteState: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {           
                    if (await hasRelationships(
                            tx, 
                            args.data.pbotID, 
                            [{
                                type: "STATE_OF",
                                direction: "in"
                            }, {
                                type: "HAS_STATE",
                                direction: "in"
                            }]
                    )) {
                        console.log("cannot delete");
                        return {pbotID: "Cannot delete " + args.data.pbotID}
                    } else {
                        console.log("can delete");
                        const result = await handleDelete(
                            tx, 
                            'State', 
                            args.data.pbotID, 
                            args.data.enteredByPersonID, 
                            [{
                                type: "STATE_OF",
                                direction: "out"
                            }, {
                                type: "ENTERED_BY",
                                direction: "out"
                            }]
                        );
                        console.log("result");
                        console.log(result);
                        return result.records[0]._fields[0];
                    }
                });
            } finally {
                await session.close();
            }
            return result;
        },

        CustomDeleteDescription: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {           
                    if (await hasRelationships(
                            tx, 
                            args.data.pbotID, 
                            [{
                                type: "DEFINED_BY",
                                direction: "out"
                            }, {
                                type: "CANDIDATE_FOR",
                                direction: "in"
                            }]
                    )) {
                        console.log("cannot delete");
                        return {pbotID: "Cannot delete " + args.data.pbotID}
                    } else {
                        console.log("can delete");
                        const result = await handleDelete(
                            tx, 
                            'Description', 
                            args.data.pbotID, 
                            args.data.enteredByPersonID, 
                            [{
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
                        );
                        console.log("result");
                        console.log(result);
                        return result.records[0]._fields[0];
                    }
                });
            } finally {
                await session.close();
            }
            return result;
        },

        CustomDeleteCharacterInstance: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {           
                    const result = await handleDelete(
                        tx, 
                        'CharacterInstance', 
                        args.data.pbotID, 
                        args.data.enteredByPersonID, 
                        [{
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
                    );
                    console.log("result");
                    console.log(result);
                    return result.records[0]._fields[0];
                });
            } finally {
                await session.close();
            }
            return result;
        },

        CustomDeleteSpecimen: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            let result;
            try {
                result = await session.writeTransaction(async tx => {           
                    if (await hasRelationships(
                            tx, 
                            args.data.pbotID, 
                            [{
                                type: "DESCRIBED_BY",
                                direction: "out"
                            }]
                    )) {
                        console.log("cannot delete");
                        return {pbotID: "Cannot delete " + args.data.pbotID}
                    } else {
                        console.log("can delete");
                        const result = await handleDelete(
                            tx, 
                            'Specimen', 
                            args.data.pbotID, 
                            args.data.enteredByPersonID, 
                            [{
                                type: "IS_TYPE",
                                direction: "out"
                            }, {
                                type: "EXAMPLE_OF",
                                direction: "out"
                            }, {
                                type: "ENTERED_BY",
                                direction: "out"
                            }]
                        );
                        console.log("result");
                        console.log(result);
                        return result.records[0]._fields[0];
                    }
                });
            } finally {
                await session.close();
            }
            return result;
        },
        
    }
};

