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

import { applyMiddleware } from "graphql-middleware";

import  permissions  from './permissions.js';

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

const getUser = async (driver, email) => {
    console.log("getUser");
    console.log(driver);
    console.log(email);
    if (!email) return {surname: 'dummy'};
    
    const session = driver.session();
    //The replace razzle-dazzle below is just to get a list of role strings rather than objects.
    return session.run(`
        MATCH 
            (person:Person {email : $email})-[:HAS_ROLE]->(role:Role) 
        RETURN 
            person{
                .given, 
                .surname, 
                .email,
                .password,
                roles:collect(
                    replace(
                        replace(
                            apoc.convert.toString(role{.name}), 
                            "{name=", 
                            ""
                        ),
                        "}",
                        ""
                    )
                )
            }           
        `, {
            email: email//'douglasm@arizona.edu'
        }
    )
    .then(result => {
        let user;
        result.records.forEach(record => {
            console.log(record.get('person'));
            user = record.get('person');
        })
        //console.log(user.get('given') + " " + user.get('surname'));
        console.log(user);
        return user;
    })
    .catch(error => {
        console.log(error)
    })
    .then((user) => {
        session.close();
        return user;
    })    
}

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
    async ({ req }) => {
        console.log("setting up context");
        // Get the user token from the headers.
        const token = req.headers.authorization;
        console.log(token);

        // Try to retrieve a user with the token
        //const user = await getUser(driver, token);

        let email;
        if (token) {
            const decodedToken = jwt.verify(token.split(' ')[1], "secret");
            console.log(decodedToken);
            email = decodedToken.username;
        }
        const user = await getUser(driver, email);

        console.log("From context, user");
        console.log(user);
        // Add the user to the context
        return { 
            user,
            driver,
            driverConfig: { database: process.env.NEO4J_DATABASE || 'neo4j' },
        };
    },   
  schema: applyMiddleware(schema, permissions),
  introspection: true,
  playground: true,
})

// Specify host, port and path for GraphQL endpoint
const port = process.env.GRAPHQL_SERVER_PORT || 4001
const pth = process.env.GRAPHQL_SERVER_PATH || '/graphql'
const host = process.env.GRAPHQL_SERVER_HOST || '0.0.0.0'

/*
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
            if (req.body.query && req.body.query.match(/^mutation/)) {
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
            if (req.body.query && req.body.query.match(/^mutation/)) {
                console.log("mutation");
                return false;
            } else {
                console.log("not mutation");
                return true;
            }
        }
    })
);
*/

/*
 * Optionally, apply Express middleware for authentication, etc
 * This also also allows us to specify a path for the GraphQL endpoint
 */
server.applyMiddleware({ app, pth })

app.post('/login',
    async (req, res) => {
        if (!req.body.username || !req.body.password) {
            res.status(400).send({
                code: 400, 
                msg: "Please pass username and password",
            });
        } else {
            //TODO: check password
            const user = await getUser(driver, req.body.username);
            console.log("login");
            console.log(user);
            if (user && user.surname !== "dummy") {
                const token = jwt.sign({
                    username: req.body.username
                }, 'secret', { expiresIn: '1h' });
                res.json({ token: token }); //TODO: error handling and reporting through API
            } else {
                res.status(400).json({msg: "User not found"});
            }
        }
    }
);

app.post('/register',
    async (req, res) => {
        console.log("register");
        if (!req.body.givenName ||
            !req.body.surname ||
            !req.body.email ||
            !req.body.password) {
            res.status(400).send({
                code: 400, 
                msg: "Please pass given name, surname, email, and password",
            });
        } else {
            //TODO: check if user already exists
            const user = await getUser(driver, req.body.email);
            console.log(user);
            if (user && user.surname !== "dummy") {
                if (user.password) {
                    res.status(400).send({
                        code: 400, 
                        msg: "User already exists",
                    });
                } else {
                    if (req.body.useExistingUser) {
                        //createUser();
                        res.status(200).json({msg: "User created"}); //TODO: clean up logic so there is only one of these
                    } else {
                        res.status(400).send({
                            code: 400, 
                            msg: "Unregistered user with that email found",
                        });
                    }
                }
                //TODO: If no password, go ahead and add and return success
            } else {
                //TODO: create user
                res.status(200).json({msg: "User created"});
            }
        }
    }
);

app.listen({ host, port, path }, () => {
  console.log(`GraphQL server ready at http://${host}:${port}${pth}`)
})
