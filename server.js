'use strict'
import chalk from 'chalk'
import figlet from 'figlet'
import os from 'os'
import path from 'path'
import superstatic from 'superstatic'
import connect from 'connect'
import debuglog from 'debug'
import express from 'express'
import chokidar from 'chokidar'
import configstore from 'configstore'
import session from 'express-session'
import memstore from 'memorystore' // prod ready memory store for sessions
import ctl from './app/controller.js'

const debug = debuglog('publicator:server')
const MSConstructor = new memstore(session)
const { yellow, red, green } = chalk

let conf

try {
  conf = new configstore('publicator'); // check that the config exists and is correct on start
} catch (e) {
  console.log("\n"+red(`There's been a problem reading the config at ${process.env.XDG_CONFIG_HOME || (os.homedir() ? path.join(os.homedir(), '.config') : "-unknown-")}/configstore/publicator.json: ${e}`))
  process.exit(1)
}

if (process.env.GOOGLE_OAUTH2_ID && process.env.GOOGLE_OAUTH2_SECRET) // for heroku deployment and the like
   conf.set('google.oauth2',{id:process.env.GOOGLE_OAUTH2_ID, secret:process.env.GOOGLE_OAUTH2_SECRET})

let portEx = process.env.PORT || 8080
let portSs = 3474
let __dirname = path.resolve()

// define session store
const memSessionStore = session({
    store: new MSConstructor({ checkPeriod: 86400000 }),// prune expired entries every 24h
    secret: process.env.SESSION_SECRET || 'somenotsosecretsecretkey',
    // todo: secure cookie for production https://www.npmjs.com/package/express-session#compatible-session-stores
    resave: true, // might actually need false.
    saveUninitialized: true,
    cookie:{
        sameSite : "lax", // true or 'strict' does not work with the domain setting
        domain: conf.get("domain")
    }
})

// --- Main server ----
// configure and start main server as express middleware
var app = express()
app.use(memSessionStore)
app.use(express.urlencoded({extended: true})) // to parse post params
app.get('/', ctl.Root)
app.use(express.static(path.join(__dirname, 'public/'))) // dynamic content - during development and between version changes { maxAge: 31557600000, index : false }
app.get('/auth', ctl.OAuthStart)
app.get('/callback', ctl.OAuthCallback)
app.get('/config/firebase',(_,res) => {res.sendFile(path.join(__dirname, 'superstatic/firebase.json'))})
app.get('/config/firebase/schema',(_,res) => {res.sendFile(path.join(__dirname, 'superstatic/firebase.schema.json'))})
app.get('/config/scraper',(_,res) => {res.sendFile(path.join(__dirname, 'superstatic/scraper.json'))})
app.get('/config/scraper/schema',(_,res) => {res.sendFile(path.join(__dirname, 'superstatic/scraper.schema.json'))})
app.post('/config/firebase/save',ctl.FirebaseSave) // save config changes
app.post('/config/scraper/save',ctl.ScraperSave) // save config changes
app.get('/publisher', ctl.Main) // website publisher interface
app.post('/publisher/schedule', ctl.Schedule) // schedule publishing
app.get('/publisher/generate', ctl.Generate) // scrape into a static copy
app.get('/publisher/publish', ctl.Publish) // actual publish command
app.get('/signout', ctl.SignOut)

// start it up
let serverEx = app.listen(portEx, () => {
  console.log("\n"+yellow(figlet.textSync('Express on '+portEx, { font:'Shimrod', horizontalLayout: 'full' })));// Kban, Jazmine is good too
}).on('error', (err) => {
  (err.code == 'EADDRINUSE')?console.log("\n"+red(`Port ${portEx} is in use`)):console.log("\n"+red(`Network error: ${err}`))
  process.exit(1)
})

// --- Superstatic server ----
// configure and start superstatic server as connect plugins
var superspecs = {
  // fallthrough:false,
  config: __dirname+"/superstatic/firebase.json",
  cwd:__dirname+"/superstatic/"
}

const appSs = connect()
appSs.use(memSessionStore) // shared session store
appSs.use((req, res, next) => {
  if (!req.session.viewauthed){
    debug("Not authenticated as a viewer")
    let login_link
    // if main url defined use it, otherwise come up with the one on the same host, but different port
    if (conf.get("main_url")){
      login_link = conf.get("main_url")+'/?error=Please%20log-in%20to%20see%20the%20preview&preview'
    } else {
      login_link = `${req.connection.encrypted ? 'https' : 'http'}://${req.headers.host.replace(/:.*/,'')}:${portEx}/?error=Please%20log-in%20to%20see%20the%20preview&preview`
    }
    res.writeHead(307, {Location: login_link}) // using 307 to avoid browsers caching the redirect
    res.end()
    return
  }
  next();
})
let ssStack=appSs.use(superstatic(superspecs))

let serverSs = appSs.listen(portSs,(err)=>{
   if (err) { console.log(err) }
  console.log("\n"+green(figlet.textSync('Superstatic on '+portSs, { font:'Shimrod', horizontalLayout: 'full' })))
})

// setup config file watcher that will restart superstatic
chokidar.watch(__dirname+"/superstatic/firebase.json").on('change', (event, path) => {
  serverSs.close(()=>{
    ssStack.stack.splice(-1,1) // pop the last middleware out of the stack (undocumented for connect)
    ssStack=appSs.use(superstatic(superspecs)) // replace it with the new superstatic - not sure if this would cause a memory leak in js
    serverSs = appSs.listen(portSs,(err)=>{if (err) { console.log(err) }})
    debug("Superstatic restarted on firebase.json change")
  })
});

// handlers for the docker pid 1 ctrl-c correctly
process.on('SIGINT', terminator)
process.on('SIGHUP', terminator)
process.on('SIGTERM', terminator)

function terminator(signal) {
  debug(`Stopping on ${signal}`);
  serverEx.close(()=>{
    serverSs.close(()=>{
      process.exit(128)
    })
  })
}
