import neo4j from 'neo4j-driver'
import fs from 'fs'
import path from 'path'

import jwt from 'jsonwebtoken';
import ejwt from 'express-jwt';
import bcrypt from 'bcrypt';


const getUser = async (driver, email) => {
    console.log("getUser");
    console.log(driver);
    console.log(email);
    if (!email) return {surname: 'dummy'};
    
    const session = driver.session();
    //The replace razzle-dazzle below is just to get a list of role strings rather than objects.
    return session.run(`
        MATCH 
            (person:Person {email : $email})
        OPTIONAL MATCH (person)-[:HAS_ROLE]->(role:Role) 
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

const createUser = async (driver, user) => {
    console.log("createUser");
    console.log(driver);
    console.log(user);
    
    const pwHash = bcrypt.hashSync(user.password, 10);
    console.log(pwHash);
    
    const session = driver.session();
    //The replace razzle-dazzle below is just to get a list of role strings rather than objects.
    return session.run(`
        MATCH
            (role:Role {name: "user"})
        MERGE 
            (person:Person {email : $email})
            ON CREATE SET
                person.personID = apoc.create.uuid(),
                person.given = $given,
                person.surname = $surname,
                person.password = $password
            ON MATCH SET
                person.password = $password
        MERGE
            (person)-[:HAS_ROLE]->(role) 	
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
            email: user.email,
            given: user.givenName,
            surname: user.surname,
            password: pwHash
        }
    )
    .then(result => {
        console.log("cypher success");
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
        console.log("closing session");
        session.close();
        return user;
    })    
}


//login
const handleLogin = async (req, res, driver) => {
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
                if (!bcrypt.compareSync(req.body.password, user.password)) {
                    res.status(400).json({msg: "Wrong password"});
                } else {
                    const token = jwt.sign({
                        username: req.body.username
                    }, process.env.JWT_SECRET, { expiresIn: '1h' });
                    res.json({ token: token }); //TODO: error handling and reporting through API
                }
            } else {
                res.status(400).json({msg: "User not found"});
            }
        }
    }

    
//register
const handleRegistration = async (req, res, driver) => {
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
            let user = await getUser(driver, req.body.email);
            console.log(user);
            if (user && user.surname !== "dummy") {
                if (user.password) {
                    res.status(400).send({
                        code: 400, 
                        msg: "User already exists",
                    });
                } else {
                    if (req.body.useExistingUser) {
                        user = await createUser(driver, req.body);
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
                user = await createUser(driver, req.body);
                res.status(200).json({msg: "User created"});
            }
        }
    }

export {getUser, createUser, handleLogin, handleRegistration}
