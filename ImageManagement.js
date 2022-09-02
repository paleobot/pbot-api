import fs from 'fs'
import path from 'path'

import jwt from 'jsonwebtoken';
import ejwt from 'express-jwt';
import bcrypt from 'bcrypt';
import {getUser} from './UserManagement.js';

const imageDir = '../../images'; //TODO: get from config

const handleImages = async (req, res, driver) => {
    console.log("handleImages");
    
    //Make sure user is authorized for this image
    const token = req.headers.authorization;
    console.log(token);

    let authorized = false;
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
    console.log("user.pbotID");
    console.log(user.pbotID);
    const session = driver.session();
    await session.run(`
        MATCH 
            (person:Person {pbotID: $userID})-[:MEMBER_OF]->(:Group)<-[:ELEMENT_OF]-(s:Specimen {pbotID: $specimenID})
        RETURN 
            person      
        `, {
            userID: user.pbotID,
            specimenID: req.params.pbotID
        }
    )
    .then(result => {
        console.log("cypher success");
        let person;
        result.records.forEach(record => {
            person = record.get('person');
        })
        if (person) {
            authorized = true;
        }
    })
    .finally(() => {
        console.log("closing session");
        session.close();
    });
    
    if (!authorized) {
        return res.status(401).send({
            code: 401, 
            msg: "Not authorized to access this resource",
        });
    } else {
        if (req.method === "GET") {
            console.log("image, GET");
            res.sendFile(path.resolve(imageDir, req.params.pbotID, req.params.image)); 
        } else {
            console.log("image, POST");
            return res.status(501).send({
                code: 501, 
                msg: "POST not implemented",
            });
        }  
    }
}

export {handleImages}
