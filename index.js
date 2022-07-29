import dotenv from "dotenv"
import { ApolloServer, ForbiddenError } from 'apollo-server-express'
import express from 'express'
import neo4j from 'neo4j-driver'
import { makeAugmentedSchema } from 'neo4j-graphql-js';
import { inferSchema } from 'neo4j-graphql-js';
import fs from 'fs'
import path from 'path'

import jwt from 'jsonwebtoken';
import ejwt from 'express-jwt';
import unless from 'express-unless';
import bcrypt from 'bcrypt';

import { applyMiddleware } from "graphql-middleware";

import  permissions  from './permissions.js';
import {getUser, handleLogin, handleRegistration, handleReset} from './UserManagement.js';

import {Resolvers} from './Resolvers.js';

dotenv.config();

const app = express()

app.use(express.json());

const typeDefs = fs
  .readFileSync(
    //process.env.GRAPHQL_SCHEMA || path.join(__dirname, 'schema.graphql')
    process.env.GRAPHQL_SCHEMA || './schema.graphql'
  )
  .toString('utf-8')

  //console.log(typeDefs);

/*
 * Create a Neo4j driver instance to connect to the database
 * using credentials specified as environment variables
 * with fallback to defaults
 */
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER,
    process.env.NEO4J_PASSWORD
  )
)

// Connect to existing Neo4j instance, infer GraphQL typedefs
// generate CRUD GraphQL API using makeAugmentedSchema
const schema = makeAugmentedSchema({
      typeDefs: typeDefs,
      resolvers: Resolvers
});

console.log(schema);
console.log(Object.keys(schema._typeMap.GroupInput._fields));
console.log(schema._typeMap.GroupInput._fields.pbotID);
console.log(schema._typeMap.GroupInput._fields.pbotID.type);
console.log(Object.keys(schema._typeMap.GroupInput._fields.pbotID.type));
console.log(schema._typeMap.GroupInput._fields.pbotID.type.ofType);
console.log(schema._typeMap.GroupInput._fields.elements);
console.log(schema._typeMap.GroupInput._fields.elements.type);
console.log(Object.keys(schema._typeMap.GroupInput._fields.elements.type));
console.log(schema._typeMap.GroupInput._fields.elements.type.ofType);
//console.log(schema._typeMap.Query);

const debugPlugin = {
    // Fires whenever a GraphQL request is received from a client.
    async requestDidStart(requestContext) {
        console.log('Request started! Query:\n' +
            requestContext.request.query);
        console.log(requestContext);

        return {
            // Fires whenever Apollo Server will parse a GraphQL
            // request to create its associated document AST.
            async parsingDidStart(requestContext) {
                console.log('Parsing started!');
            },

            // Fires whenever Apollo Server will validate a
            // request's document AST against your GraphQL schema.
            async validationDidStart(requestContext) {
                console.log('Validation started!');
            },
            
            //Fires when shit does sideways
            async didEncounterErrors(requestContext) {
                console.log("Hogan's goat!");
                console.log(requestContext);
            },
        }
    },
};

//Middleware to add personID from token. This is used in mutations to create ENTERED_BY relationships
const addUserID = async (resolve, root, args, context, info) => {
  console.log("addUserID");
  console.log(context.user);
  console.log(args);
  args.data.enteredByPersonID = context.user.pbotID;
  console.log(args);
  console.log("here goes...");
  const result = await resolve(root, args, context, info)
  console.log(result)
  return result
}

//This is needed to prevent execution of middleware for each field
//(https://github.com/maticzav/graphql-middleware/issues/33)
const middleware = {
  Mutation: addUserID,
}

/*
 * Create a new ApolloServer instance, serving the GraphQL schema
 * created using makeAugmentedSchema above and injecting the Neo4j driver
 * instance into the context object so it is available in the
 * generated resolvers to connect to the database.
 */

/*
const server = new ApolloServer({
  context: {
    driver,
    driverConfig: { database: process.env.NEO4J_DATABASE || 'neo4j' },
  },
  schema: schema,
  introspection: true,
  playground: true,
})
*/

const server = new ApolloServer({
    context:
        async ({ req, res }) => {
            console.log("setting up context");
            // Get the user token from the headers.
            const token = req.headers.authorization;
            console.log(token);

            let email;
            try {
                if (token) {
                    const decodedToken = jwt.verify(token.split(' ')[1], process.env.JWT_SECRET);
                    //console.log(decodedToken);
                    email = decodedToken.username;
                }
            } catch (error) {
                console.log(error);
            }
            const user = await getUser(driver, email);

            //console.log("From context, user");
            //console.log(user);
            // Add the user to the context
            return { 
                user,
                driver,
                driverConfig: { database: process.env.NEO4J_DATABASE || 'neo4j' },
                schema,
                cypherParams: {
                    user: user,
                    cypherMatchPrefix: `(p:Person {pbotID:"${user.pbotID}"})-[:MEMBER_OF]->(g:Group)<-[:ELEMENT_OF|:MEMBER_OF]-`,
                    cypherMatchPostfix: `-[:ELEMENT_OF|:MEMBER_OF]->()<-[:MEMBER_OF]-(p)`,
                    skipPrefixNodeTypes: ["Person", "_SchemaAuthoredBy", "_ReferenceAuthoredBy", "Comment", "_CommentEnteredBy"]
                },
            };
        },   
    schema: applyMiddleware(schema, permissions, middleware),
    introspection: true,
    playground: true,
    //plugins: [
    //    debugPlugin,
    //],
})

// Specify host, port and path for GraphQL endpoint
const port = process.env.GRAPHQL_SERVER_PORT || 4001
const pth = process.env.GRAPHQL_SERVER_PATH || '/graphql'
const host = process.env.GRAPHQL_SERVER_HOST || '0.0.0.0'

/*
 * Optionally, apply Express middleware for authentication, etc
 * This also also allows us to specify a path for the GraphQL endpoint
 */
server.applyMiddleware({ app, pth })

app.post('/login', async (req, res) => {handleLogin(req, res, driver)});

app.post('/register', async (req, res) => {handleRegistration(req, res, driver)});

app.post('/reset', async (req, res) => {handleReset(req, res, driver)});
app.get('/reset', async (req, res) => {handleReset(req, res, driver)});

app.listen({ host, port, path }, () => {
  console.log(`GraphQL server ready at http://${host}:${port}${pth}`)
})
