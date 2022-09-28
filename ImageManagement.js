import fs from 'fs'
import path from 'path'

import jwt from 'jsonwebtoken';
import ejwt from 'express-jwt';
import bcrypt from 'bcrypt';
import { promises as streamPromises } from 'stream';
import {getUser} from './UserManagement.js';

import dotenv from "dotenv"

dotenv.config();

const imageDir = process.env.IMAGE_DIR;
const imageLinkPre = process.env.IMAGE_LINK_PRE;

export const handleImages = async (req, res, driver) => {
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
    console.log("email");
    console.log(email)
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

export const uploadFile = async ( file, imagedID ) => {
    console.log("uploadFile");
    
    try {
        const { createReadStream, filename, mimetype, encoding } = await file;
        
        // Invoking the `createReadStream` will return a Readable Stream.
        // See https://nodejs.org/api/stream.html#stream_readable_streams
        const stream = createReadStream();

        if (!fs.existsSync(path.resolve(imageDir, imagedID))){
            fs.mkdirSync(path.resolve(imageDir, imagedID), { recursive: true });
        }
        
        //const newFilename = `${crypto.randomUUID()}--${filename}`;
        const newFilename = filename; //TODO: Not worrying about collisions for now. This makes Update easier.
        
        // TODO: get pbotID and imageDir
        const filePath = path.resolve(imageDir, imagedID, newFilename);
        
        const out = fs.createWriteStream(filePath);
        stream.pipe(out);
        await streamPromises.finished(out);

        //TODO: build this from stuff
        return {
            path: filePath,
            link: imageLinkPre + "/" + imagedID + "/" + newFilename
        
        };
    } catch (error) {
        throw new Error(`Unable to upload file: ${error.message}`);
    }
    
}
        
export const renameFile = async ( context, pbotID, revert ) => {
    console.log("---------------rename file--------------------");
    console.log(pbotID);
    
    const driver = context.driver;
    const session = driver.session()

    const queryStr = `
        MATCH 
            (n)
        WHERE
            n.pbotID = "${pbotID}"
        RETURN
            n
    `;
    
    const pgResult = await session.run(
        queryStr
    );
    const link = pgResult.records.length > 0 ? pgResult.records[0].get(0).properties.link : null;    
    console.log(link);
    
    const regex = /([^\/]*\/[^\/]+)$/g;    
    const filePath = new URL(link).pathname.match(regex)[0];
    const tmpFilePath = `${filePath}.sav`;
    
    let oldFullPath, newFullPath;
    if (revert) {
        newFullPath = path.join(imageDir, filePath);
        oldFullPath = path.join(imageDir, tmpFilePath);
    } else {
        oldFullPath = path.join(imageDir, filePath);
        newFullPath = path.join(imageDir, tmpFilePath);
    }
    
    console.log(oldFullPath);
    console.log(newFullPath);
    
    try {
        await fs.renameSync(oldFullPath, newFullPath);
    } catch (error) {
        throw new Error(`Unable to rename file ${oldFullPath}: ${error.message}`);
    }    
    
    return newFullPath;
    
}

export const deleteFile = async ( filePath ) => {
    console.log("---------------delete file--------------------");
    console.log(filePath);
        
    try {
        await fs.unlinkSync(filePath);
    } catch (error) {
        throw new Error(`Unable to delete file ${filePath}: ${error.message}`);
    }    
    
    return `${filePath} deleted`;
    
}

