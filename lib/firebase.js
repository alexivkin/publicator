'use strict'
import {writeFileSync} from "fs"
import fbt from 'firebase-tools'
import Configstore from 'configstore'
import gapi from 'googleapis'
import path from 'path'
import debuglog from 'debug'

const debug = debuglog('publicator:firebase')
const conf = new Configstore('publicator'); // can get from process.env.npm_package_name if run via "npm start"

const __dirname = path.resolve(); // or const __dirname = path.dirname(new URL(import.meta.url).pathname);

const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/firebase'
]

async function sitePublisher(logger) {
    var serviceAccount = conf.get("firebase");

    // promisify token generator
    function GAuth() {
        return new Promise(resolve => {
            var jwtClient = new gapi.google.auth.JWT(serviceAccount.client_email, null, serviceAccount.private_key, SCOPES, null);
            jwtClient.authorize((err, tokens) => {
                if (err) { throw err }
                resolve(tokens.access_token);
            });
        })
    }

    let token = await GAuth()
    if (!token){ throw "Can not generate firebase token" }
    let data = await fbt.projects.list({token,json: true})
    if (!data) { throw "Can not get the project for the firebase account" }

    logger(`Publishing to ${data[0].projectId}...`)
    await fbt.deploy({project: data[0].projectId,token,cwd: __dirname + "/superstatic/",only:"hosting",json: true}).then((data)=>{
        writeFileSync(__dirname + '/superstatic/.published.timestamp', new Date().toISOString())
        debug(data)
        logger("done\n")
    }).catch(err => {throw err});
}

export {sitePublisher}