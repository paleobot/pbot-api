//import * as neo4j from 'neo4j-driver';

const hasRelationships = async (session, pbotID, relationships) => {
    let queryStr = relationships.reduce((str, relationship) => `
        ${str}
        MATCH
            (n) WHERE n.pbotID="${pbotID}"
        WITH n
            OPTIONAL MATCH 
                (n)-[r:${relationship}]-()
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
    result = result.records.length > 0; //TODO: !!!!!!!this doesn't work. Need to check each record for null

    console.log("returning " + result);
    return result;
}

/*
const generateRelationshipDelete = async (session, nodeName, relationships) => {
    let queryStr = `
        WITH ${nodeName}
    `;
    queryStr = relationships.reduce((str, relationship) => `
        ${str}
            OPTIONAL MATCH (${nodeName})-[rel:${relationship}]->(node1)
            CALL apoc.do.when(
                rel IS NOT NULL,
                "CREATE (${nodeName})-[archivedRel:_${relationship}]->(node) SET archivedRel = rel DELETE rel RETURN ${nodeName}",
                "RETURN ${nodeName}",
                {${nodeName}: ${nodeName}, node: node1, rel: rel}
            ) YIELD value
        WITH distinct value.${nodeName} AS ${nodeName} 
    `, queryStr);
    console.log(queryStr);
    
    return queryStr;
}
*/

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
            OPTIONAL MATCH (baseNode)-[rel:${relationship}]->(remoteNode)
            CALL apoc.do.when(
                rel IS NOT NULL,
                "CREATE (baseNode)-[archivedRel:_${relationship}]->(node) SET archivedRel = rel DELETE rel RETURN baseNode",
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
    
    return queryStr;
}


export const DeletionResolvers = {
    Mutation: {
        CustomDeleteReference: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            if (await hasRelationships(session, args.data.pbotID, ["CITED_BY"])) {
                console.log("cannot delete");
                return {pbotID: "Cannot delete " + args.data.pbotID}
            } else {
                console.log("can delete");
                //return {pbotID: "Can delete " + args.data.pbotID}
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
                console.log("result");
                console.log(result);
                return result.records[0]._fields[0];
            }
            
        },
        
        CustomDeleteSchema: async (obj, args, context, info) => {
            console.log("CustomDeleteSchema");
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            if (await hasRelationships(session, args.data.pbotID, ["APPLICATION_OF", "CHARACTER_OF"])) {
                console.log("cannot delete");
                handleDelete(session, 'Schema', args.data.pbotID, args.data.enteredByPersonID, ["AUTHORED_BY", "ENTERED_BY", "CITED_BY"]);
                return {pbotID: "Cannot delete " + args.data.pbotID}
            } else {
                console.log("can delete");
                handleDelete(session, 'Schema', args.data.pbotID, args.data.enteredByPersonID, ["AUTHORED_BY", "ENTERED_BY", "CITED_BY"]);
                //return {pbotID: "Can delete " + args.data.pbotID}
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
                console.log("result");
                console.log(result);
                return result.records[0]._fields[0];
            }
            
        },
        
    }
};

