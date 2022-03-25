'use strict'
import configstore from 'configstore';
import sse from '../lib/ssesocket.js';
import path from 'path';
import handlebars from 'handlebars';
import schedule from 'node-schedule';
const { compile } = handlebars;
import fs from "fs";
import { siteScraper } from '../lib/scraper.js'
import { sitePublisher } from '../lib/firebase.js'
import debuglog from 'debug'
import pkg from 'googleapis';
const { google } = pkg;

const debug = debuglog('publicator:controller')
const __dirname = path.resolve(); // or const __dirname = path.dirname(new URL(import.meta.url).pathname);

var oauth2Client;
var preview_link; // redirect to the superstatic site
var publishJob; // scheduled publishing job

const conf = new configstore('publicator'); // can get from process.env.npm_package_name if run via "npm start"

const scopes = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export default {
  Root: (req, res) => {
    // if preview url defined use it, otherwise come up with the one on the same host, but different port
    if (conf.get("preview_url")){
      preview_link = conf.get("preview_url")
    } else {
      preview_link = `${req.connection.encrypted ? 'https' : 'http'}://${req.headers.host.replace(/:.*/,'')}:3474/`
    }
    // check if we need to redirect to the preview after login
    if (req.session.viewauthed){
      if (!req.session.authed || req.query.preview) {
        res.redirect(preview_link)
      } else {
        res.redirect('/publisher')
      }
    } else{
      // if not just load index
      res.sendFile(`${path.resolve()}/public/index.html`);
    }
  },

  // Google OAuth authentication
  OAuthStart: (req, res) => {
    let creds = conf.get('oauth2')
    if (creds && creds.id) {
      // todo add state param to protect against CSRF
      oauth2Client = new google.auth.OAuth2(creds.id,creds.secret,creds.redirect_uris[0] || `${req.protocol}://${req.headers.host}/callback`); // in case creds.redirect_uris[0] is not defined
      google.options({auth: oauth2Client});
      const authorizeUrl = oauth2Client.generateAuthUrl({access_type: 'offline',scope: scopes.join(' ')});
      res.redirect(authorizeUrl)
    } else {
      res.send('OAuth2 is not configured. Register the OAuth app and save the keys to ' + conf.path + ' or set env GOOGLE_OAUTH2_ID, GOOGLE_OAUTH2_SECRET')
    }
  },
  // Google OAuth completion
  OAuthCallback: async (req, res) => {
    if (!req.query.code) {
      return res.send('No OAuth2 code supplied for the callback: ' + JSON.stringify(req.query))
    }
    try {
      const {tokens} = await oauth2Client.getToken(req.query.code);
      oauth2Client.credentials = tokens;
      const ppl = google.people('v1');
      debug(oauth2Client)
      // check the groups
      const profile = await ppl.people.get({resourceName: 'people/me', personFields:"names,emailAddresses" });
      // check if authorized
      let admins = conf.get('admins')
      if (profile.data.emailAddresses.some(e => admins.includes(e.value))){
        debug("Authenticated as an admin")
        req.session.authed = true
        req.session.viewauthed = true
        req.session.profile = profile.data
        // resolve(oauth2Client);
        return res.redirect('/publisher')
      }
      try {
        // load the list of viewers from the setup file so it is editable and persistent on a volume
        const scraperconf = JSON.parse(fs.readFileSync(`${__dirname}/superstatic/scraper.json`, 'utf8')) // json loader
        let viewers = scraperconf['viewers']
        if (profile.data.emailAddresses.some(e => viewers.includes(e.value))){
          debug("Authenticated as a viewer")
          req.session.viewauthed = true
          req.session.profile = profile.data
          return res.redirect(preview_link)
        }
      } catch (error) {
        debug(`Trouble with the scraper config: ${error}`)
        return res.redirect('/?error='+encodeURIComponent(error))
      }
      res.redirect('/?error=Unauthorized')
    } catch (error) {
      debug(error);
      res.redirect('/?error='+encodeURIComponent(error))
    }
  },

  Main: (req, res) => {
    if (!req.session.authed) {
      res.redirect(`${req.baseUrl}/?error=${req.session.viewauthed?"Not%20allowed":"Unauthenticated"}`)
    } else {
      var lastgenerated_timestamp
      try {
        lastgenerated_timestamp=fs.readFileSync(`${__dirname}/superstatic/.generated.timestamp`,"utf8")
      } catch (error) {}
      var lastpublished_timestamp
      try{
        lastpublished_timestamp=fs.readFileSync(`${__dirname}/superstatic/.published.timestamp`,"utf8")
      } catch (error) {}
      var scheduled_timestamp
      try{
        scheduled_timestamp=fs.readFileSync(`${__dirname}/superstatic/.scheduled.timestamp`,"utf8")
        // start the publishing job now in case the server was restarted or the page is reloaded.
        // This may not be really needed
        if (new Date(scheduled_timestamp) > new Date()) {
          if (publishJob == null){
            publishJob = schedule.scheduleJob(new Date(scheduled_timestamp),() => {
              debug('Kicking-off scheduled publishing job');
              sitePublisher((text)=>{debug(text)})
            })
          } else {
            publishJob.reschedule(new Date(scheduled_timestamp))
          }
        }
      } catch (error) {}
      var template = compile(fs.readFileSync(`${__dirname}/public/push.html`,"utf8"));
      var processed = template({username:req.session.profile.names[0].displayName,lastgenerated_timestamp,lastpublished_timestamp,scheduled_timestamp,preview_link})//,  version:'v'})
      res.send(processed)
    }
  },

  Generate: (req, res) => {
    if (!req.session.authed) {
      return res.redirect(`${req.baseUrl}/?error=${req.session.viewauthed?"Not%20allowed":"Unauthenticated"}`)
    }
    var socket = new sse(req, res)

    siteScraper((text)=>{socket.emit("stdout",text)}).catch(e=>{
      socket.emit("stderr",e.toString()+"\n")
    }).then(()=>{
      socket.emit("stdout","zeend")
      socket.emit("stderr","zeend")
    })
  },


  Publish: (req, res) => {
    if (!req.session.authed) {
      return res.redirect(`${req.baseUrl}/?error=${req.session.viewauthed?"Not%20allowed":"Unauthenticated"}`)
    }
    var socket = new sse(req, res)

    sitePublisher((text)=>{socket.emit("stdout",text)}).catch(e=>{
      socket.emit("stderr",e.toString()+"\n")
    }).then(()=>{
      socket.emit("stdout","zeend")
      socket.emit("stderr","zeend")
    })
  },

  Schedule: (req, res) => {
    if (!req.session.authed) {
      return res.redirect(`${req.baseUrl}/?error=${req.session.viewauthed?"Not%20allowed":"Unauthenticated"}`)
    }
    if (req.body.ts){
      try {
        let ts=new Date(req.body.ts)
        if (ts >= new Date()) {
          if (publishJob == null){
            debug(`Creating a new job for ${ts}`)
            publishJob = schedule.scheduleJob(ts,() => {
              debug('Kicking-off the scheduled scraping');
              siteScraper(text=>{debug(text)}).catch(e=>{debug(`Error scraping: ${e}`)}).then(()=>{
                debug('Kicking-off the scheduled publishing job');
                sitePublisher(text=>{debug(text)}).catch(e=>{debug(`Error publishing: ${e}`)})
              })
            })
          } else {
            debug(`Rescheduling for ${ts}`)
            publishJob.reschedule(ts)
          }
          fs.writeFileSync(`${__dirname}/superstatic/.scheduled.timestamp`, ts.toISOString())
          res.sendStatus(200)
        } else {
          debug(`Refusing to schedule in the past at ${ts}`)
          res.status(400).send("Bad date (past?)")
        }
      } catch (e) {
        debug(`Problem scheduling ${e}`)
        res.status(400).send("Error scheduling")
      }
    } else {
      publishJob.cancel()
      debug("Job cancelled")
      try {
        fs.unlinkSync(`${__dirname}/superstatic/.scheduled.timestamp`)
      } catch (e){}
        res.sendStatus(200)
    }
  },

  FirebaseSave: (req,res) => {
    if (!req.session.authed) {
      return res.redirect(`${req.baseUrl}/?error=${req.session.viewauthed?"Not%20allowed":"Unauthenticated"}`)
    }
    if (req.body.fb){
      try {
        fs.copyFileSync(`${__dirname}/superstatic/firebase.json`,`${__dirname}/superstatic/firebase.json.bak`)
        fs.writeFileSync(`${__dirname}/superstatic/firebase.json`, JSON.stringify(req.body.fb,null,2))
        // superstatic will be restareted by the fs watcher
        res.sendStatus(200)
      } catch (e) {
        res.status(400).send(e)
      }
    } else {
      res.status(400).send("Empty save")
    }
  },

  ScraperSave: (req,res) => {
    if (!req.session.authed) {
      return res.redirect(`${req.baseUrl}/?error=${req.session.viewauthed?"Not%20allowed":"Unauthenticated"}`)
    }
    if (req.body.sc){
      try {
        fs.copyFileSync(`${__dirname}/superstatic/scraper.json`,`${__dirname}/superstatic/scraper.json.bak`)
        fs.writeFileSync(`${__dirname}/superstatic/scraper.json`, JSON.stringify(req.body.sc,null,2))
        // reloaded by the scraper when it's started
        res.sendStatus(200)
      } catch (e) {
        res.status(400).send(e)
      }
    } else {
      res.status(400).send("Empty save")
    }
  },

  SignOut: (req, res) => {
    // oauth2Client.SignOut()
    req.session.destroy() // ()=>{}
    res.redirect(req.baseUrl + '/')
  },

   // what you see here is an unused part of the code related to running commands via shell and then publishing to cloudfront
  CloudFrontPublish: (req, res) => {
    if (!req.session.authed) {
      res.redirect(req.baseUrl + '/#error=Unauthenticated')
      return
    }
    var socket = new sse(req, res)

    // todo - redo with promises or async/await
    socket.emit("stdout","Running...")
    code = conf.get("code")

    var p1 = cp.spawn('sh', ['-c', code])
    let error = false
    p1.stdout.on('data', (data) => {
      debug(data.toString())
      socket.emit("stdout",data.toString())
    })
    // spw.on('close', (code)=> { socket.emit("stdout","zeend")  }); // or do res.end(...)
    p1.stderr.on('data', (data) => {
      debug(data.toString())
      socket.emit("stderr",data.toString())
      error=true
    });

    p1.on('exit', ()=> {
      if (error){
        debug("Command failed")
        socket.emit("stderr","Command failed. Stopping.")
        socket.emit("stdout","zeend")
        socket.emit("stderr","zeend")
        res.end('error');
        return
      }
      var AWS = require('aws-sdk')
      AWS.config.loadFromPath(conf.path)
      var cloudfront = new AWS.CloudFront()
      let distribution = conf.get("CloudFrontDistribution")
      debug("Invalidating CF distribution "+distribution)

      var params = {
        DistributionId: distribution,
        InvalidationBatch: {
          CallerReference: "iternals-"+(new Date()).toJSON().slice(0, 19),
          Paths: { Quantity: '1', Items: ['/*'] }
        }
      }
      cloudfront.createInvalidation(params, (err, data)=>{
        if (err){
          debug("Invalidation failed with "+err)
          socket.emit("stdout",err)
        } else {
          debug("Invalidation status: "+data.Invalidation.Status)
          socket.emit("stdout","CloudFront cache refresh status: "+data.Invalidation.Status)
        }
        socket.emit("stdout","zeend")
        socket.emit("stderr","zeend")
      })
    })
  }

}