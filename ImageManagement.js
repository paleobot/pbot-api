import fs from 'fs'
import path from 'path'

import jwt from 'jsonwebtoken';
import ejwt from 'express-jwt';
import bcrypt from 'bcrypt';

const handleImages = async (req, res, driver) => {
    console.log("handleImages");
    
    /*
    //TODO: what about public specimens? Might need to pull pbotID from url, then check group 
    // Get the user token from the headers.
    const token = req.headers.authorization;
    console.log(token);
    if (!token) {
        return res.status(401).send({
            code: 401, 
            msg: "Not authorized to access this resource",
        });
    }
    */
    
    if (req.method === "GET") {
        console.log("reset, GET");
        console.log(process.cwd());
        /*
        return res.status(501).send({
            code: 501, 
            msg: "GET not implemented",
        });
        */
        //parse url to get pbotID as directory name
        const parts = req.path.split('/');
        console.log(parts);
        res.sendFile(path.resolve('../../images/' + parts[2] + '/' + parts[3])); // put your app.html's         //res.sendFile(path.resolve('../../images/STScI-01GA6KNV1S3TP2JBPCDT8G826T.png')); // put your app.html's relative path        
    } else {
        console.log("reset, POST");
        return res.status(501).send({
            code: 501, 
            msg: "POST not implemented",
        });
    }    
}

export {handleImages}
