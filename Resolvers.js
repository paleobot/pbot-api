//import * as neo4j from 'neo4j-driver';
import {ValidationError} from 'apollo-server';
import {cypherQuery} from 'neo4j-graphql-js';
import  GraphQLUpload  from 'graphql-upload/GraphQLUpload.mjs';
import fs from 'fs'
import path from 'path'
import crypto from 'crypto';
import { GraphQLScalarType, Kind, GraphQLError } from 'graphql';

import {schemaDeleteMap, schemaMap} from './SchemaMaps.js';
import {uploadFile, renameFile, deleteFile} from './ImageManagement.js';


const isPublic = async (session, pbotID) => {
    const queryStr = `
        MATCH
            (n)-[:ELEMENT_OF]->(:Group {name: "public"})
        WHERE
            n.pbotID = $pbotID
        RETURN 
            n
    `;
    console.log(queryStr);
        
    const result = await session.run(
        queryStr,
        {pbotID: pbotID}
    );
    return result.records.length > 0;
}

const isSynonym = async (session, otus) => {
    const queryStr = `
        MATCH
            (:OTU {pbotID: "${otus[0]}"})-[:SAME_AS]->(s:Synonym)<-[:SAME_AS]-(:OTU {pbotID: "${otus[1]}"})
        RETURN
            s    
    `;
    console.log(queryStr);
        
    const result = await session.run(
        queryStr,
        {otus: otus}
    );
    return result.records.length > 0;
}

const getPerson = async (session, email) => {
    const queryStr = `
        MATCH
            (p:Person {email: "${email}"})
        RETURN 
            p
    `;
    console.log(queryStr);
        
    const result = await session.run(
        queryStr,
        {email: email}
    )
    return result.records.length > 0 ? result.records[0].get(0) : null;
}

const getGroups = async (session, data) => {
    const rootID = data.schemaID || data.descriptionID || data.collection || null;
    
    if (rootID !== null) {
        const queryStr = `
            MATCH
                (n)-[:ELEMENT_OF]-(g:Group)
            WHERE 
                n.pbotID = "${rootID}"
            RETURN
                g
        `;
        console.log(queryStr);
        
        const result = await session.run(
            queryStr,
            {rootID: rootID}
        )
        
        console.log("------result----------");
        console.log(result);
        console.log("records returned: " + result.records.length)
        const res = result.records.map((rec) => (rec.get(0).properties.pbotID));
        console.log("res");
        console.log(res);
        return res;
    } else {
        throw new ValidationError(`Cannot find groups`); //TODO: good enough?
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
    
const handleUpdate = async (session, nodeType, data) => {
    console.log("handleUpdate");
    
    const pbotID = data.pbotID;
    const enteredByPersonID = data.enteredByPersonID
    
    let properties;
    let relationships;
    if (data.groupCascade) {
        //all we want to do in this case is update the groups
        properties = [];
        relationships = [{
                type: "ELEMENT_OF",
                direction: "out",
                graphqlName: "groups",
                required: true,
                updatable: true
        }];
    } else {
        properties = schemaMap[nodeType].properties || []; 
        relationships = schemaMap[nodeType].relationships || [];
        relationships = relationships.filter(r => r.updatable);
    }
    
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
    //I'm not going to lie: this code is pretty stinky. In order to track changes to relationship properties and get them recorded 
    //in the ENTERED_BY, we have to create these weird string concats with the remote node ID and the properties. This is then
    //used by an apoc disjunction test in the cypher. This is made a bit more ugly yet by the fact that I have chosen to support
    //the original array or ID strings as well as the new array of objects.
    queryStr = relationships.reduce((str, relationship) => {
        if (Array.isArray(data[relationship.graphqlName])) {
            let newRemoteIDs = [];
            if (data[relationship.graphqlName].length > 0) {
                newRemoteIDs = data[relationship.graphqlName].map(r => {
                    console.log(r);
                    let retStr;
                    if (typeof r === "string") {
                        retStr = r + "{}";
                    } else {
                        retStr = r.pbotID + JSON.stringify(Object.keys(r).reduce((t,propKey) => {
                            console.log(propKey);
                            if ("pbotID" !== propKey) {
                                console.log(r[propKey]);
                                t[propKey] = r[propKey];
                            }
                            return t;
                        }, {}));
                    }
                    console.log(retStr);
                    return retStr;
                });
            }
            console.log("newRemoteIDs");
            console.log(newRemoteIDs);
            
            return `
                ${str}
                    OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                    WITH baseNode, eb, collect(remoteNode.pbotID + apoc.convert.toJson(properties(rel))) AS remoteNodeIDs, collect(apoc.convert.toJson(rel)) AS oldRelsJSON, collect(rel) AS oldRels
                    FOREACH (r IN oldRels | DELETE r)
                    WITH distinct baseNode, remoteNodeIDs, oldRelsJSON, apoc.coll.disjunction(remoteNodeIDs, ${JSON.stringify(newRemoteIDs)} ) AS diffList, eb
                    CALL
                        apoc.do.case([
                            size(remoteNodeIDs) = 0 AND size(diffList) <> 0,
                            "SET eb.${relationship.graphqlName} = 'not present' RETURN eb",
                            size(diffList)<>0,
                            "SET eb.${relationship.graphqlName} = oldRelsJSON RETURN eb"],
                            "RETURN eb",
                            {diffList: diffList, oldRelsJSON: oldRelsJSON, eb: eb}
                        )
                    YIELD value
                    WITH baseNode, eb
            `
        } else { //single relationship, no array
            if (data[relationship.graphqlName]) {
                const newRemoteID = typeof data[relationship.graphqlName][0] === "string" ?
                    data[relationship.graphqlName] + "{}" :
                    r.pbotID + JSON.stringify(Object.keys(r).reduce((t,propKey) => {
                        console.log(propKey);
                        if ("pbotID" !== propKey) {
                            console.log(r[propKey]);
                            t[propKey] = r[propKey];
                        }
                        return t;
                    }, {}));
                console.log("newRemoteID");
                console.log(newRemoteID);
                
                return `
                    ${str}
                        OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                        WITH baseNode, eb, remoteNode, remoteNode.pbotID + apoc.convert.toJson(properties(rel)) AS remoteNodeID, apoc.convert.toJson(rel) AS relJSON, rel
                        DELETE rel
                        WITH baseNode, eb, remoteNode, remoteNodeID, relJSON 	
                            CALL apoc.do.case([
                                    remoteNode IS NULL,
                                    "SET eb.${relationship.graphqlName} = 'not present' RETURN eb",
                                    remoteNodeID  <> ${JSON.stringify(newRemoteID)},
                                    "SET eb.${relationship.graphqlName} = relJSON RETURN eb"],
                                    "RETURN eb",
                                    {remoteNode: remoteNode, remoteNodeID: remoteNodeID, relJSON: relJSON, eb: eb}
                                ) YIELD value
                        WITH baseNode, eb
                `
            } else {
                return `
                    ${str}
                        OPTIONAL MATCH (baseNode)${relationship.direction === "in" ? "<-" : "-"}[rel:${relationship.type}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                        WITH baseNode, eb, remoteNode, apoc.convert.toJson(rel) AS relJSON, rel
                        DELETE rel
                        WITH baseNode, eb, remoteNode, relJSON 	
                        CALL apoc.do.when(
                                remoteNode IS NOT NULL,
                                "SET eb.${relationship.graphqlName} = relJSON RETURN eb",
                                "RETURN eb",
                                {remoteNode: remoteNode, relJSON: relJSON, eb: eb}
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
    
    /*
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
    */
    
    //Create new relationships
    queryStr = relationships.reduce((str, relationship) => { //iterate the relationship types for the node type
        if (data[relationship.graphqlName] && data[relationship.graphqlName].length > 0) { //if there is data for the relationship type
            //For singular relationships, only the pbotID string is passed. We need to encapsulte that in an array for the following logic
            if (!Array.isArray(data[relationship.graphqlName])) data[relationship.graphqlName] = [data[relationship.graphqlName]];

            return data[relationship.graphqlName].reduce((str, relInstance) => { //iterate the instances of this relationship type
                let remoteID;
                let relProps = '';
                
                if (relationship.properties) {
                    console.log("relationship.properties");
                    remoteID = relInstance.pbotID;
                    relProps = relationship.properties.reduce((str, prop) => { //iterate each property to build string for create
                            return (prop !== "pbotID" && relInstance[prop]) ?
                                `${str}${prop}: "${relInstance[prop]}",` :
                                `${str}`;
                        }, '');
                } else {
                    remoteID = relInstance; //For relationships without properties, only the pbotID string is passed
                }
                relProps = "{" + relProps.replace(/,$/,'') + "}"; //trim final comma and wrap in brackets
                
                console.log("relProps");
                console.log(relProps);
                
                return `
                    ${str}
                    MATCH (remoteNode) WHERE remoteNode.pbotID = "${remoteID}" 
                    CREATE (baseNode)${relationship.direction === "in" ? "<-" : "-"}[:${relationship.type} ${relProps}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                    WITH baseNode
                `;
            }, str);
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

const handleCreate = async (session, nodeType, data) => {
    console.log("handleCreate");
    console.log(data);
    console.log(data.groups);
    
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
        WITH baseNode, ePerson	
        SET
    `;
    queryStr = properties.reduce((str, property) => `
        ${str}
            baseNode.${property} = ${JSON.stringify(data[property])},
    `, queryStr);
    queryStr = `
        ${queryStr.slice(0, queryStr.lastIndexOf(','))}
        WITH baseNode, ePerson
    `;
    
    //Create new relationships
    queryStr = relationships.reduce((str, relationship) => { //iterate the relationship types for the node type
        if (data[relationship.graphqlName] && data[relationship.graphqlName].length > 0) { //if there is data for the relationship type
            //For singular relationships, only the pbotID string is passed. We need to encapsulte that in an array for the following logic
            if (!Array.isArray(data[relationship.graphqlName])) data[relationship.graphqlName] = [data[relationship.graphqlName]];

            return data[relationship.graphqlName].reduce((str, relInstance) => { //iterate the instances of this relationship type
                let remoteID;
                let relProps = '';
                
                if (relationship.properties) {
                    console.log("relationship.properties");
                    remoteID = relInstance.pbotID;
                    relProps = relationship.properties.reduce((str, prop) => { //iterate each property to build string for create
                            return (prop !== "pbotID" && relInstance[prop]) ?
                                `${str}${prop}: "${relInstance[prop]}",` :
                                `${str}`;
                        }, '');
                } else {
                    remoteID = relInstance; //For relationships without properties, only the pbotID string is passed
                }
                relProps = "{" + relProps.replace(/,$/,'') + "}"; //trim final comma and wrap in brackets
                
                console.log("relProps");
                console.log(relProps);
                
                return `
                    ${str}
                    MATCH (remoteNode) WHERE remoteNode.pbotID = "${remoteID}" 
                    CREATE (baseNode)${relationship.direction === "in" ? "<-" : "-"}[:${relationship.type} ${relProps}]${relationship.direction === "in" ? "-" : "->"}(remoteNode)
                    WITH baseNode, ePerson
                `;
            }, str);
        } else {
            if (relationship.required) {
                throw new ValidationError(`Missing required relationship ${relationship.graphqlName}`);
            } else {
                return str;
            }
        }
    }, queryStr);
                            
    //Groups must be elements of themselves; the creator must be a member, if not already
    queryStr = "Group" === nodeType ? ` 
        ${queryStr}
        CREATE
            (baseNode)-[:ELEMENT_OF]->(baseNode)
        MERGE
            (ePerson)-[:MEMBER_OF]->(baseNode)
    ` :
    queryStr;
    
    
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
    
    console.log("mutateNode");
    console.log(data);
    
    try {
        //First, check that public group setting is exclusive
        const queryStr = `
            MATCH
                (g:Group {name:"public"})
            RETURN
                g
        `;
        
        const pgResult = await session.run(
            queryStr
        );
        const publicGroupID = pgResult.records.length > 0 ? pgResult.records[0].get(0).properties.pbotID : null;    

        if (data.references) {
            const testSet = new Set();
            data.references.forEach(ref => {
                testSet.add(ref.pbotID);
            });
            if (testSet.size < data.references.length) {
                throw new ValidationError(`Cannot not have duplicate references`);
            }
        }
               
        if ("Person" !== nodeType && data.groups && data.groups.includes(publicGroupID) && data.groups.length > 1) {
            throw new ValidationError(`A public ${nodeType} cannot be in other groups.`);
        }
    
        if ("OTU" === nodeType && !data.exampleSpecimens.includes(data.holotype)) {
            throw new ValidationError(`Holotype must also be an example specimen`);
        }
            
        const result = await session.writeTransaction(async tx => {
            let result;
            switch (type) {
                case "create": 
                    if ("Person" === nodeType) {
                        const person = await getPerson(tx, data.email);  
                        console.log("Person:");
                        console.log(person);
                        if (person) {
                            console.log("person already exists");
                            throw new ValidationError(`${nodeType} with that email already exists`);
                        }
                    } else if ("Synonym" === nodeType) {
                        if (await isSynonym(tx, data.otus)) {
                            throw new ValidationError(`${nodeType} already exists`);
                        }
                    } else if ("Character" === nodeType || "State" === nodeType || "CharacterInstance" === nodeType || "Specimen" === nodeType) {
                        console.log("++++++++++++++++++++++fetching groups++++++++++++++++++");
                        //fetch groups from root and put in data
                        const groups = await getGroups(tx, data);
                        console.log("Groups:");
                        console.log(groups);
                        data["groups"] = groups;
                    }
                    result = await handleCreate(
                        tx, 
                        nodeType, 
                        data       
                    );
                    break;
                case "update":
                    console.log("Updating");

                    let doGroupCascade = true;
                    if ("Person" === nodeType) {
                        const person = await getPerson(tx, data.email);                    
                        if (person && person.properties.pbotID !== data.pbotID) {
                            console.log("person already exists");
                            throw new ValidationError(`${nodeType} with that email already exists`);
                        }
                        if (person) {
                            if (person.properties.password && person.properties.pbotID !== data.enteredByPersonID) {
                                console.log("attempt to edit registered user");
                                throw new ValidationError(`Cannot edit registered users other than yourself`);
                            } else if (person.properties.pbotID !== data.pbotID) {
                                console.log("person already exists");
                                throw new ValidationError(`${nodeType} with that email already exists`);
                            }
                        }
                    } else if (("Character" === nodeType || "State" === nodeType) && !data.groupCascade) {
                        console.log("++++++++++++++++++++++fetching groups++++++++++++++++++");
                        //fetch groups from Schema and put in data
                        const groups = await getGroups(tx, data);
                        console.log("Groups:");
                        console.log(groups);
                        data["groups"] = groups;
                        //We are moving a Character or State to a new parent within same Schema. 
                        //Groups are not changing so no need to cascade.
                        doGroupCascade = false; 
                    }
                    
                    //Prevent privatization of public nodes
                    if (await isPublic(tx, data.pbotID) && !data.groups.includes(publicGroupID)) {
                        throw new ValidationError(`This ${nodeType} is public. Cannot change groups`);
                    }
                    
                    //TODO: If setting to newly public, clean out old DELETE data
                        
                    if (doGroupCascade) {
                        const groupCascadeRelationships = schemaDeleteMap[nodeType].cascadeRelationships || [];
                        const remoteNodes = await getRelationships(
                            tx, 
                            data.pbotID, 
                            groupCascadeRelationships
                        );
                        //console.log("remoteNodes");
                        //console.log(remoteNodes);
                        console.log("cascading groups");
                        await Promise.all(remoteNodes.map(node => {
                            node.groups = data.groups;
                            node.groupCascade = true;
                            node.enteredByPersonID = data.enteredByPersonID;
                            console.log("node after");
                            console.log(node);
                            return mutateNode(context, node.nodeType, node, "update")
                        })).catch(error => {
                            console.log(error);
                            throw new ValidationError(`Unable to cascade groups for ${nodeType}`);
                        });
                    }
                    
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
        

// Validation functions for checking latitude/longitude
//Based on https://www.apollographql.com/docs/apollo-server/schema/custom-scalars/
function latValue(value) {
    if (typeof value === 'number' && value >= -90 && value <= 90) {
        return value;
    }
    throw new GraphQLError(
        `Provided value (${value}, ${typeof value}) is not avalid latitude`, 
        {
            extensions: { code: 'BAD_USER_INPUT' },
        }
    );
}   

function lonValue(value) {
    if (typeof value === 'number' && value >= -180 && value <= 180) {
        return value;
    }
    throw new GraphQLError(
        `Provided value (${value}, ${typeof value}) is not a valid longitude`, 
        {
            extensions: { code: 'BAD_USER_INPUT' },
        }
    );
}  

export const Resolvers = {

    Latitude: new GraphQLScalarType({
        name: 'Latitude',
        description: 'Latitude custom scalar type',
        parseValue: latValue,
        serialize: latValue,
        parseLiteral(ast) {
            if (ast.kind === Kind.FLOAT) {
                return latValue(parseFloat(ast.value));
            }
            throw new GraphQLError('Provided value is not a valid latitude', {
                extensions: { code: 'BAD_USER_INPUT' },
            });
        },
    }),
    Query: {
        echoLat(_, { lat }) {
            return lat;
        },
    },

      Longitude: new GraphQLScalarType({
        name: 'Longitude',
        description: 'Longitude custom scalar type',
        parseValue: lonValue,
        serialize: lonValue,
        parseLiteral(ast) {
            if (ast.kind === Kind.FLOAT) {
                return lonValue(parseFloat(ast.value));
            }
            throw new GraphQLError('Provided value is not a valid longitude', {
                extensions: { code: 'BAD_USER_INPUT' },
            });
        },
    }),
    Query: {
        echoLon(_, { lon }) {
            return lon;
        },
    },
    
    Upload: GraphQLUpload,
    Person: {
        email: (parent, args, context, info) => {
            return context.user.password ?
                parent.email :
                null;
        }
    },
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

        DeleteOTU: async (obj, args, context, info) => {
            console.log("DeleteOTU");
            return await mutateNode(context, "OTU", args.data, "delete");
        },        

        DeleteSynonym: async (obj, args, context, info) => {
            console.log("DeleteSynonym");
            return await mutateNode(context, "Synonym", args.data, "delete");
        },        

        DeleteComment: async (obj, args, context, info) => {
            console.log("DeleteComment");
            return await mutateNode(context, "Comment", args.data, "delete");
        },        

        DeleteSpecimen: async (obj, args, context, info) => {
            console.log("DeleteSpecimen");
            return await mutateNode(context, "Specimen", args.data, "delete");
        },        

        DeleteCollection: async (obj, args, context, info) => {
            console.log("DeleteCollection");
            return await mutateNode(context, "Collection", args.data, "delete");
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
     
        DeletePreservationMode: async (obj, args, context, info) => {
            console.log("DeletePreservationMode");
            throw new ValidationError(`Cannot delete PreservationMode nodes`);
        },        
     
        DeleteImage: async (obj, args, context, info) => {
            console.log("DeleteImage");
            //throw new ValidationError(`Delete of Image nodes not yet implemented`);
             return await mutateNode(context, "Image", args.data, "delete");
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

        UpdateOTU: async (obj, args, context, info) => {
            console.log("UpdateOTU");
            return await mutateNode(context, "OTU", args.data, "update");
        },

        UpdateSynonym: async (obj, args, context, info) => {
            console.log("UpdateSynonym");
            return await mutateNode(context, "Synonym", args.data, "update");
        },

        UpdateComment: async (obj, args, context, info) => {
            console.log("UpdateComment");
            return await mutateNode(context, "Comment", args.data, "update");
        },

        UpdateSpecimen: async (obj, args, context, info) => {
            console.log("UpdateSpecimen");
            return await mutateNode(context, "Specimen", args.data, "update");
        },

        UpdateCollection: async (obj, args, context, info) => {
            console.log("UpdateCollection");
            return await mutateNode(context, "Collection", args.data, "update");
        },

        UpdateOrgan: async (obj, args, context, info) => {
            console.log("UpdateOrgan");
            return await mutateNode(context, "Organ", args.data, "update");
        },
        
        UpdatePreservationMode: async (obj, args, context, info) => {
            console.log("UpdatePreservationMode");
            return await mutateNode(context, "PreservationMode", args.data, "update");
        },
        
        UpdateImage: async (obj, args, context, info) => {
            console.log("UpdateImage");
            //throw new ValidationError(`Update of Image nodes not yet implemented`);
            if (!args.data.link) {
                if (!args.data.image) {
                    throw new ValidationError(`Must supply either url link to image or image to upload`);
                } else {
                    //We don't want to delete the old image until after the mutation. Rename it first, then upload the new one, then mutate, then delete the renamed image. Fix stuff if anything bad happens along the way.
                    const tmpFilePath = await renameFile(context, args.data.pbotID);
                    let image;
                    try {
                        image = await uploadFile(args.data.image, args.data.imageOf)
                    } catch(error) {
                        console.log("upload failed");
                        //revert tmp file to original file name
                        await renameFile(context, args.data.pbotID, true);
                        console.log("rethrowing");
                        throw error;
                    } 
                    args.data.link = image.link;
                    
                    let retVal;
                    try {
                        retVal = await mutateNode(context, "Image", args.data, "update")
                    } catch(error) {
                        console.log("mutate failed");
                        //delete new file
                        await deleteFile(image.path);
                        //revert tmp file to original file name
                        await renameFile(context, args.data.pbotID, true);
                        console.log("rethrowing");
                        throw error;
                    }
                    
                    //all good
                    await deleteFile(tmpFilePath);
                    return retVal;
                }
            }
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

        CreateOTU: async (obj, args, context, info) => {
            console.log("CreateOTU");
            return await mutateNode(context, "OTU", args.data, "create");
            
        },

        CreateSynonym: async (obj, args, context, info) => {
            console.log("CreateSynonym");
            return await mutateNode(context, "Synonym", args.data, "create");
            
        },

        CreateComment: async (obj, args, context, info) => {
            console.log("CreateComment");
            return await mutateNode(context, "Comment", args.data, "create");
            
        },

        CreateSpecimen: async (obj, args, context, info) => {
            console.log("CreateSpecimen");
            return await mutateNode(context, "Specimen", args.data, "create");
            
        },

        CreateCollection: async (obj, args, context, info) => {
            console.log("CreateCollection");
            return await mutateNode(context, "Collection", args.data, "create");
            
        },

        CreateOrgan: async (obj, args, context, info) => {
            console.log("CreateOrgan");
            return await mutateNode(context, "Organ", args.data, "create");
            
        },
        
        CreatePreservationMode: async (obj, args, context, info) => {
            console.log("CreatePreservationMode");
            return await mutateNode(context, "PreservationMode", args.data, "create");
            
        },
        
        CreateImage: async (obj, args, context, info) => {
            console.log("CreateImage");
            if (!args.data.link) {
                if (!args.data.image) {
                    throw new ValidationError(`Must supply either url link to image or image to upload`);
                } else {
                    const image = await uploadFile(args.data.image, args.data.imageOf); //upload image and replace with its url
                    args.data.link = image.link;
                }
            }
            return await mutateNode(context, "Image", args.data, "create");
            
        },
        
        UploadImage: async (obj, args, context, info) => {
            console.log("UploadImage");
            return await uploadFile(args.image, args.specimenID); 
        },
        
    }
};

