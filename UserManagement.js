import neo4j from 'neo4j-driver'
import fs from 'fs'
import path from 'path'

import jwt from 'jsonwebtoken';
import ejwt from 'express-jwt';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';

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
    
    const pwHash = bcrypt.hashSync(user.password, process.env.SALT_COUNT);
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

const prepareUserReset = async (driver, email, token) => {
    console.log("prepareUserReset");
    console.log(user);
    console.log(token);
    
    const session = driver.session();
    //The replace razzle-dazzle below is just to get a list of role strings rather than objects.
    return session.run(`
        MATCH 
            (person:Person {email : $email})
        SET
            person.resetToken = $resetToken
        RETURN 
            person{
                .given, 
                .surname, 
                .email,
                .password,
                .resetToken,
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
            email: email,
            resetToken: token
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

const resetUser = async (driver, email, newPassword, token) => {
    console.log("resetUser");
    console.log(user);
    console.log(token);
    
    const pwHash = bcrypt.hashSync(newPassword, process.env.SALT_COUNT);
    
    const session = driver.session();
    //The replace razzle-dazzle below is just to get a list of role strings rather than objects.
    return session.run(`
        MATCH 
            (person:Person {email : $email, resetToken: $resetToken})
        SET
            person.resetToken = null,
            person.password = $newPassword
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
            email: email,
            newPassword: pwHash,
            resetToken: token
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
                    res.json({ token: token }); //TODO: error handling and reporting through API good enough?
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
                if (user.password) {  //if there is a password, this user is already registered
                    res.status(400).send({
                        code: 400, 
                        msg: "User already exists",
                    });
                } else { //This user exists in the db, but is no registered. If told to do so, go ahead.
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
            } else { //No user found. Create one.
                user = await createUser(driver, req.body);
                res.status(200).json({msg: "User created"});
            }
        }
    }
    
    
const sendResetEmail = async (email, token) => {
    console.log("sendResetEmail");
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_ACCOUNT,
            pass: process.env.EMAIL_PASSWORD
        }
    });

    var mailOptions = {
        from: process.env.EMAIL_ACCOUNT,
        to: email,
        subject: 'Sending Email using Node.js',
        text: process.env.SITE_URL + ':' + process.env.GRAPHQL_SERVER_PORT + '/reset?username=' + email + '&token=' + token
    };

    await transporter.sendMail(mailOptions)
    .then(info => {
        console.log('Email sent: ' + info.response);
    })
    .catch(error => {
        console.log(error);
    }) 
}

//reset request
//TODO: This isn't set up correctly. The GET should result in a form to the client. That form submits the new password.
//We can still handle this in the POST handling of this routine, but we'll need to differentiate between the initial 
//reset request (no included password), and the final reset (with included password). Where does the form come from?
//It won't be in the client code.
const handleReset = async (req, res, driver) => {
    console.log("handleReset");
    if (req.method === "GET") {
        console.log("reset, GET");
        //this is the actual reset through the link
        if (!req.query.username && !req.query.token) {
            res.status(400).send({
                code: 400, 
                msg: "Improper reset request",
            });
        } else {
            const user = await getUser(driver, req.query.username);
            console.log("reset");
            console.log(user);
                        
            if (user && user.surname !== "dummy" && user.password) {
                const decodedToken = jwt.verify(req.query.token, process.env.JWT_SECRET);
                console.log(decodedToken);
                //email = decodedToken.username;
                //TODO: handle reset
                res.json({msg: "ok"});
            } else {
                res.status(400).json({msg: "Registered user not found"});
            }
        }
    } else {
        console.log("reset, POST");
        if (!req.body.username) {
            res.status(400).send({
                code: 400, 
                msg: "Please pass username",
            });
        } else {
            if (!req.body.password) { //new reset request, create token and send link
                const token = jwt.sign({
                    username: req.body.username,
                    reset: true
                }, process.env.JWT_SECRET, { expiresIn: '1h' });
                await prepareUserReset(driver, req.body.username, token); //TODO: error handling
                await sendResetEmail(req.body.username, token);
                res.json({ msg: "A reset link has been sent to your email address" }); 
            } else { //final submit of new password
                const token = req.headers.authorization;
                let decodedToken
                if (token) {
                    decodedToken = jwt.verify(token.split(' ')[1], process.env.JWT_SECRET);
                    console.log(decodedToken);
                    email = decodedToken.username;
                }
                await resetUser(driver, req.body.email, req.body.password, decodedToken); //TODO: error handling
                res.json({ msg: "Password has been reset" }); 
            }
        }
    }    
}

export {getUser, createUser, handleLogin, handleRegistration, handleReset}
