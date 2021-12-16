//import * as neo4j from 'neo4j-driver';

const hasRelationships = async (session, pbotID, relationship) => {
    let result;
    result = await session.run(
            `
            MATCH 
                (n) WHERE n.pbotID = $pbotID
            WITH n
                MATCH (n)-[ab:${relationship}]-()
            RETURN
                ab
            `,
        {pbotID: pbotID}
    )
    console.log("------result----------");
    console.log(result);
    console.log("records returned: " + result.records.length)
    result = result.records.length > 0;

    console.log("returning " + result);
    return result;
}

export const DeletionResolvers = {
    Mutation: {
        CustomDeleteReference: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            if (await hasRelationships(session, args.data.pbotID, "CITED_BY")) {
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
            
        }
    }
};

