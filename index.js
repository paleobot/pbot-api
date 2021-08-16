import { ApolloServer } from 'apollo-server-express'
import express from 'express'
import neo4j from 'neo4j-driver'
import { makeAugmentedSchema } from 'neo4j-graphql-js';
import { inferSchema } from 'neo4j-graphql-js';
import fs from 'fs'
import path from 'path'

const app = express()

const typeDefs = fs
  .readFileSync(
    //process.env.GRAPHQL_SCHEMA || path.join(__dirname, 'schema.graphql')
    process.env.GRAPHQL_SCHEMA || './schema.graphql'
  )
  .toString('utf-8')

  console.log(typeDefs);

/*
 * Create a Neo4j driver instance to connect to the database
 * using credentials specified as environment variables
 * with fallback to defaults
 */
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'password'
  )
)


// Connect to existing Neo4j instance, infer GraphQL typedefs
// generate CRUD GraphQL API using makeAugmentedSchema
const schema = makeAugmentedSchema({
      typeDefs: typeDefs
     });

console.log(schema);
console.log(schema._typeMap.Query);

/*
 * Create a new ApolloServer instance, serving the GraphQL schema
 * created using makeAugmentedSchema above and injecting the Neo4j driver
 * instance into the context object so it is available in the
 * generated resolvers to connect to the database.
 */
const server = new ApolloServer({
  context: {
    driver,
    driverConfig: { database: process.env.NEO4J_DATABASE || 'neo4j' },
  },
  schema: schema,
  introspection: true,
  playground: true,
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

app.listen({ host, port, path }, () => {
  console.log(`GraphQL server ready at http://${host}:${port}${pth}`)
})
