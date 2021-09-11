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

const getScope = (token) => {
    console.log("getScope");
    console.log(token);
    if (token) {
        return "ADMIN";
    } else {
        return "PEON";
    }
}

const app = express()

app.use(express.json());
app.post('/login',
    (req, res) => {
        if (!req.body.username || !req.body.password) {
            res.status(400).send({
                code: 400, 
                msg: "Please pass username and password",
            });
        } else {        
            const token = jwt.sign({
                username: req.body.username
            }, 'secret', { expiresIn: '1h' });
            res.json({ token: token }); //TODO: error handling and reporting through API
        }
    }
);

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
/*
 * something about passing auth through context. 
const server = new ApolloServer({
    context: ({ req }) => {
        return {
            driver,
            driverConfig: { database: process.env.NEO4J_DATABASE || 'neo4j' },
            authScope: getScope(req.headers.authorization)
        }
    },
    schema: schema,
    resolvers: {
        Mutation: 
            (parent, args, context, info) => {
                console.log(context.authScope);
               if(context.authScope !== ADMIN) throw new AuthenticationError('not admin');            
            }
        
    },
    introspection: true,
    playground: true,
});
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
app.post(pth, async (req, res, next) => {
    console.log("here!");
    if (req.body.query.match(/^mutation/)) {
        console.log("mutation!");
        const token = req.get("Authorization").replace(/^Bearer /, '');
        console.log(token);
        const payload = jwt.verify(token, 'secret');
        console.log(payload.username);
        //TODO: verify password
        return next();
        //return next(new ForbiddenError());
        //return res.status(401).json({msg: "Not authorized"});
    } else {
        console.log("query");
        return next();
    }
});
*/
const checkUser = (req, res, next) =>{
    console.log(req.token);
    if (req.token.username === "douglas") {
        return next();
    } else {
        return res.status(401).send('Action not allowed');
    }
}
checkUser.unless = unless;

app.use(
    ejwt({ 
        secret: 'secret', 
        algorithms: ['HS256'],
        userProperty: 'token'
    }).unless({
        custom: req => {
            if (req.body.query.match(/^mutation/)) {
                console.log("mutation");
                return false;
            } else {
                console.log("not mutation");
                return true;
            }
        }
    }),
    checkUser.unless({
        custom: req => {
            if (req.body.query.match(/^mutation/)) {
                console.log("mutation");
                return false;
            } else {
                console.log("not mutation");
                return true;
            }
        }
    })
);

/*
 * Optionally, apply Express middleware for authentication, etc
 * This also also allows us to specify a path for the GraphQL endpoint
 */
server.applyMiddleware({ app, pth })

app.listen({ host, port, path }, () => {
  console.log(`GraphQL server ready at http://${host}:${port}${pth}`)
})
