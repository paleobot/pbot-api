//import * as neo4j from 'neo4j-driver';

const hasAuthoredBys = async (session, pbotID) => {
    let result
    
    result = await session.run(
            `
            MATCH 
                (:Person {pbotID: $pbotID})<-[ab:AUTHORED_BY]-()
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
        CustomDeletePerson: async (obj, args, context, info) => {
            const driver = context.driver;
            const session = driver.session()
            
            console.log("args");
            console.log(args);
            
            if (await hasAuthoredBys(session, args.data.pbotID)) {
                return {pbotID: "Cannot delete " + args.data.pbotID}
            } else {
                //return {pbotID: "Can delete " + args.data.pbotID}
                const result = await session.run(
                    `
                    MATCH 
                        (person:Person {pbotID: $data.pbotID}),
                        (ePerson:Person {pbotID: $data.enteredByPersonID})
                    WITH person, ePerson					
                        CREATE
                            (person)-[:ENTERED_BY {timestamp: datetime(), type:"DELETE"}]->(ePerson)
                    WITH person	
                        REMOVE person:Person SET person:_Person
                    WITH person
                        OPTIONAL MATCH (person)<-[enteredBy:ENTERED_BY]-(node)
                        CALL apoc.do.when(
                            enteredBy IS NOT NULL,
                            "CREATE (person)<-[archivedEnteredBy:_ENTERED_BY]-(node) SET archivedEnteredBy = enteredBy DELETE enteredBy RETURN person",
                            "RETURN person",
                            {person: person, node: node, enteredBy: enteredBy}
                        ) YIELD value
                    WITH distinct value.person AS person 
                    RETURN {
                        pbotID: person.pbotID + " deleted"
                    }
                    `,
                    {pbotID: args.data.pbotID, enteredByPersonID: args.data.enteredByPersonID}
                );
                console.log("result");
                console.log(result);
                return result.records[0];
            }
            
        }
    }
};

