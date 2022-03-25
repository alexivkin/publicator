'use strict'
import glob from 'glob';
import path from 'path';
import scrape from 'website-scraper';
import { resolve, join, dirname as _dirname, relative, sep } from 'path';
import debuglog from 'debug'
import { writeFileSync,readFileSync } from "fs";
import fsx from 'fs-extra';
const { outputFile, unlinkSync, rmdirSync } = fsx;
// import Configstore from 'configstore';

const debug = debuglog('publicator:scraper')
// const conf = new Configstore('publicator'); // can get from process.env.npm_package_name if run via "npm start"
const __dirname = path.resolve(); // or const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = __dirname+'/superstatic/public/'

class SiteProcessorPlugin {
	constructor(parentlogger){
		this.logger=parentlogger
		this.loadedResources = []
		// load configs
		const conf = JSON.parse(readFileSync(`${__dirname}/superstatic/scraper.json`, 'utf8')) // json loader

		this.sourceSite = conf["sourceSite"]
		this.targetSite = conf["targetSite"] // only used for sitemaps and feeds where absoluteURL is required
		this.absoluteLinks = conf["absoluteLinks"]  // rewrite links to the new absolute links
		this.sisterDomains = conf["sisterDomains"]  // clean these up from the absolute URLs in case they show up (usually a wrong href to a test domain)
		this.ignoreURLs = conf["ignoreURLs"]  // list of regexes to match pages that need to be skipped
		this.page404 = conf["page404"]  // will grab the 'missing' page and the links from it despite the 404 error
		this.extraURLs = conf["extraURLs"] // non-directly linked URLs that would be missed by the crawler

		// fix-em up
		this.sourceURLs = this.extraURLs.map(u => this.sourceSite+u)
		this.sourceURLs.unshift(this.sourceSite) // add the actual site to the top of the list
		this.sourceSiteDomain = this.sourceSite.replace(new RegExp(`^(https?:)?//`),'') // remove http prefix
	}

	siteFilter(url) {
		return url.match('(https?:)?//'+this.sourceSiteDomain) && !this.ignoreURLs.some(r => {if (url.match(r)) return true})
	}

	escapeRegex(string) {
		return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
	}
	
	getRelativePath (path1, path2) {
		const dirname = _dirname(path1);
		const relativePath = relative(dirname, path2);
		const escaped = relativePath.split(sep).map(pathComponent => encodeURIComponent(pathComponent).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16))).join(sep).replace(/\\/g, '/');
		if (escaped=='')
		escaped='/'
		return escaped;
	}
		
	apply(registerAction) {
		let absoluteDirectoryPath
		let previousParent=""

		registerAction('beforeStart', ({options}) => {
			if (!options.directory || typeof options.directory !== 'string') {
				throw `Incorrect directory ${options.directory}`
			}
			absoluteDirectoryPath = resolve(process.cwd(), options.directory);
		});

		registerAction('saveResource', async ({resource}) => {
			const filename = join(absoluteDirectoryPath, resource.getFilename().replace(this.sourceSiteDomain.replace(':','_')+'/','')); // flatten since we're only crawling one site
			// forced cleanup of missed references - eg <link rel="shortlink", <meta name="msapplication-TileImage" etc
			// if (resource.getText() != resource.getText().replace(new RegExp(sourceSite,"g"),''))
			let text = resource.getText()
			if (this.absoluteLinks.some(l => resource.getFilename().match(l))){
				text = text.replace(new RegExp(this.escapeRegex(this.sourceSite),'g'),this.targetSite)
			} else {
				// remove source site remnants
				text = text.replace(new RegExp('(https?(:|%3A))?(\\\\*/\\\\*/|%2F%2F)'+this.escapeRegex(this.sourceSiteDomain),'g'),'') // quad backslashes is to catch https:\/\/... escapes present in javascript objects
			}
			await outputFile(filename, text, { encoding: 'binary' });
			this.loadedResources.push(resource.getFilename());
		});
		registerAction('error', async ({error}) => { this.logger(error) });
		// registerAction('onResourceSaved', ({resource}) => console.log(`Resource ${resource.url} saved!`));
		registerAction('onResourceError', ({resource,error}) => this.logger(`Resource ${resource.url} has error ${error}\n`));
		registerAction('afterResponse', ({response}) => {
			if (response.statusCode != 200) {
				if (response.statusCode == 404 && response.request.href == this.sourceSite+this.page404) {
					debug(`Downloading the 404 ${response.request.href}\n`)
					return Promise.resolve(response.body);
				}
				this.logger(`Error downloading ${response.request.href} - ${response.statusCode}. Referenced by ${previousParent}\n`);
				return null;
			}
			return Promise.resolve(response.body); //response.body;
		});
		registerAction('getReference', ({resource,parentResource,originalReference}) => {
			// console.log(`${resource} ${parentResource}, ${originalReference}`+(resource==true)+(resource==false)+(resource==null)+(resource!=null))
			previousParent=parentResource.getFilename()
			if (resource==null) { //resource is null if the referenced resource will not be downloaded
				let newRef=originalReference
				this.sisterDomains.forEach(e => {newRef=newRef.replace(new RegExp(`(https?:)?//${e}`),'')})
				if (originalReference != newRef){
					if (newRef=='') {
						newRef='/'
					}
					this.logger(`Removing reference to the wrong site ${originalReference} from ${parentResource.filename}\n`)
					return { reference: newRef };
				} else {
					return { reference: null };
				}
			}
			let relativePath=originalReference.replace(new RegExp(`(https?:)?//${this.sourceSiteDomain}`),'').replace(/#.*/,'') // trim all after # to avoid dupes because the lib adds anchor links back in
			if (relativePath==''){
				relativePath='/'
			}
			debug(`dereferencing - ${parentResource.filename} points to ${resource.filename} as ${originalReference}. Now: ${relativePath}`)
			return { reference: relativePath };
		});

	}
}

async function siteScraper(stdout) {

	// first clean up public/ folder
	let origSite=glob.sync(rootDir + '/**/*', { nodir: true })
	if (origSite.length > 0) {
		// delete the files
		// origSite.forEach(f => { debug(`removing ${f}`) })
		origSite.forEach(f => { unlinkSync(f) })
		let folders=glob.sync(rootDir + '/**/')
		// sort first from the deepest subfolder to shallowest, remove the rootDir (shallowest) and delete all folders
		// folders.sort((a, b)=>{return b.length - a.length}).slice(0,folders.length-1).forEach(d => { debug(`removing dir ${d}`) })
		folders.sort((a, b)=>{return b.length - a.length}).slice(0,folders.length-1).forEach(d => { rmdirSync(d) }) // console.log(`removing dir ${d}`);
	}

	debug(`Creating a new scraper\n`)
	let siteScraper=new SiteProcessorPlugin(stdout)
	
	const options = {
		urls: siteScraper.sourceURLs,
		directory: rootDir,
		urlFilter: (...args)=>siteScraper.siteFilter(...args), // the unnamed function and the arg thingy is here to bind siteFilter method to the siteScraper object....because javascript
		recursive: true,
		maxRecursiveDepth: 10,
		plugins: [siteScraper],
		filenameGenerator: 'bySiteStructure'
	};

	if (origSite.length){
		stdout(`Refreshing about ${origSite.length} files\n`)
	} else {
		stdout("Crawling for the first time...\n")
	}
	try {
		await scrape(options)
	} catch (e) {
		throw e
	}
	stdout(`${siteScraper.loadedResources.length} files saved. Done\n`)

	writeFileSync(`${__dirname}/superstatic/.generated.timestamp`,new Date().toISOString()) // {flag:'w', encoding:"utf8"}

	stdout(`Done\n`)
}

export {siteScraper}
