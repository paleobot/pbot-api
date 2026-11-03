import fs from 'fs'
import path from 'path'

import jwt from 'jsonwebtoken';
import ejwt from 'express-jwt';
import bcrypt from 'bcrypt';
import { promises as streamPromises } from 'stream';
import {ValidationError} from 'apollo-server';
import {getUser} from './UserManagement.js';

import dotenv from "dotenv"

dotenv.config();

const imageDir = process.env.IMAGE_DIR;
const imageLinkPre = process.env.IMAGE_LINK_PRE;

// Every filesystem path built from request or stored data must resolve inside
// this directory. Resolved once so later checks compare against a fixed root.
const imageRoot = imageDir ? path.resolve(imageDir) : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A plain file name: no directory components, no traversal, no NUL.
export const isSafeImageName = (name) =>
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    !/[\/\\\0]/.test(name) &&
    path.basename(name) === name;

export const isImageOwnerID = (id) => typeof id === 'string' && UUID_RE.test(id);

// Throws unless absPath resolves strictly inside IMAGE_DIR.
export const assertInsideImageDir = (absPath) => {
    const resolved = path.resolve(absPath);
    if (!imageRoot || !resolved.startsWith(imageRoot + path.sep)) {
        throw new Error("Refusing to access a path outside the image directory");
    }
    return resolved;
}

// Absolute path for an owner's image directory, or a file within it.
// Throws ValidationError for malformed input; never touches the filesystem.
export const safeImagePath = (imagedID, filename) => {
    if (!isImageOwnerID(imagedID)) {
        throw new ValidationError("Invalid image owner ID");
    }
    if (filename !== undefined && !isSafeImageName(filename)) {
        throw new ValidationError("Invalid image file name");
    }
    const segments = filename === undefined ? [imagedID] : [imagedID, filename];
    return assertInsideImageDir(path.resolve(imageRoot, ...segments));
}

export const handleImages = async (req, res, driver) => {
  try {
    console.log("handleImages");

    //Reject malformed or traversal paths before any DB or filesystem access.
    //404 rather than 400 so probing reveals nothing about what exists.
    if (req.method === "GET") {
        try {
            safeImagePath(req.params.pbotID, req.params.image);
        } catch (error) {
            return res.status(404).send({
                code: 404,
                msg: "Not found",
            });
        }
    }

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
    const user = email ? await getUser(driver, email) : null;
    //Missing/invalid token or unknown user. Previously this dereferenced null
    //inside an unawaited async route, crashing the process.
    if (!user) {
        return res.status(401).send({
            code: 401,
            msg: "Not authorized to access this resource",
        });
    }
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
            //Params were validated above; `root` makes send() independently
            //refuse anything that escapes IMAGE_DIR.
            res.sendFile(
                `${req.params.pbotID}/${req.params.image}`,
                { root: imageRoot, dotfiles: 'deny' },
                (error) => {
                    if (error && !res.headersSent) {
                        res.status(404).send({ code: 404, msg: "Not found" });
                    }
                }
            );
        } else {
            console.log("image, POST");
            return res.status(501).send({
                code: 501,
                msg: "POST not implemented",
            });
        }
    }
  } catch (error) {
    console.log(error);
    if (!res.headersSent) {
        res.status(500).send({ code: 500, msg: "Unable to process image request" });
    }
  }
}

export const uploadFile = async ( file, imagedID ) => {
    console.log("uploadFile");

    const { createReadStream, filename, mimetype, encoding } = await file;

    //Validate before reading the stream or touching the filesystem. Thrown
    //outside the try below so callers receive a ValidationError.
    const dirPath = safeImagePath(imagedID);
    //const newFilename = `${crypto.randomUUID()}--${filename}`;
    const newFilename = filename; //TODO: Not worrying about collisions for now. This makes Update easier.
    const filePath = safeImagePath(imagedID, newFilename);

    try {
        // Invoking the `createReadStream` will return a Readable Stream.
        // See https://nodejs.org/api/stream.html#stream_readable_streams
        const stream = createReadStream();

        if (!fs.existsSync(dirPath)){
            fs.mkdirSync(dirPath, { recursive: true });
        }

        const out = fs.createWriteStream(filePath);
        stream.pipe(out);
        await streamPromises.finished(out);

        //TODO: build this from stuff
        return {
            path: filePath,
            link: imageLinkPre + "/" + imagedID + "/" + encodeURIComponent(newFilename)
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
    
    //filePath is derived from a stored link, so contain it like request input.
    let oldFullPath, newFullPath;
    if (revert) {
        newFullPath = assertInsideImageDir(path.join(imageDir, filePath));
        oldFullPath = assertInsideImageDir(path.join(imageDir, tmpFilePath));
    } else {
        oldFullPath = assertInsideImageDir(path.join(imageDir, filePath));
        newFullPath = assertInsideImageDir(path.join(imageDir, tmpFilePath));
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
        await fs.unlinkSync(assertInsideImageDir(filePath));
    } catch (error) {
        throw new Error(`Unable to delete file ${filePath}: ${error.message}`);
    }    
    
    return `${filePath} deleted`;
    
}

