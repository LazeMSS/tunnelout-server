import log from 'book';
import Koa from 'koa';
import tldjs from 'tldjs';
import Debug from 'debug';
import http from 'http';
import { hri } from 'human-readable-ids';
import Router from 'koa-router';

import https from 'https'
import fs from 'fs'

import ClientManager from './lib/ClientManager.js';

const debug = Debug('localtunnel:server');
const path = require('path');
const os = require('os');

export default function(opt) {
	opt = opt || {};

	// Constants used
	const validHosts = (opt.domain) ? [opt.domain] : undefined;
	const myTldjs = tldjs.fromUserSettings({ validHosts });
	const landingPage = opt.landing || 'https://cloudkit.app';

	const manager = new ClientManager(opt);

	const schema = opt.secure ? 'https' : 'http';

	const dashboardfolder = '/dashboard/';

	const app = new Koa();
	const router = new Router();
	let UsersList = {};

	// Lookup a hostname based on the client id
	function GetClientIdFromHostname(hostname) {
		const hostsplit = hostname.split(':');
        return myTldjs.getSubdomain(hostsplit[0]);
	}

	function authThis(authval,user,pass){
		var tmp = authval.split(' ');
		var buf = new Buffer(tmp[1], 'base64');
		var plain_auth = buf.toString();
		var creds = plain_auth.split(':');
		var ausername = creds[0];
		var apassword = creds[1];
		if((ausername == user) && (apassword == pass)) {
			return true;
		}
		return false;
	}

	// Wrapper function for basic auth - hack but it works fast
	// requiresauth = if false then we will fail login even if there is no login options setup
	// promptlogin = should we automatically create a login prompt
	function adminAuth(ctx,requiresauth = false,promptlogin  = true){
		// Do we have basic auth
		if (process.env.ADMIN_AUTH === undefined || process.env.ADMIN_AUTH === "false"){
			// Do we need auth
			if (requiresauth){
				return false;
			}
			return true;
		}else{
			// Lookup auth info
			var authIDs = process.env.ADMIN_AUTH.split(":");
			if (authIDs.length != 2){
				console.error('Bad configuration of API_BASICAUTH: "%s"',process.env.ADMIN_AUTH);
				process.exit(1);
				return false;
			}
			// Taken from: https://gist.github.com/charlesdaniel/1686663
			var auth = ctx.request.headers['authorization'];
			if(!auth || !authThis(auth,authIDs[0],authIDs[1])) {
				debug("Auth failed");
				if (promptlogin){
					ctx.throw(401, 'Unauthorized ');
					ctx.set('WWW-Authenticate', 'Basic realm="Secure Area"');
					ctb.body = 'Auth missing';
				}
				return false;
			}
			debug("Auth approved");
			return true;
		}
	}

	// API header key login check
	function apiKeyCheck(ctx) {
		// Check if the key is present
		if (process.env.API_KEY !== undefined && process.env.API_KEY != "" && process.env.API_KEY != "false" && ctx.request.headers['x-api-key'] == process.env.API_KEY){
			return true
		}
		return false;
	}

	// Auth a client
	function clientAuth(req, res,client){
		var cUsr = client.getAuthUsr();
		var cPass = client.getAuthPass();
		// Nothing to validate against
		if (cUsr == null || cPass == null){
			return true;
		}
		var auth = req.headers['authorization'];  // auth is in base64(username:password)  so we need to decode the base64
		if(!auth || !authThis(auth,cUsr,cPass)) {     // No Authorization header was passed in so it's the first time the browser hit us
			debug("Client auth failed");
			res.statusCode = 401;
			res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
			res.end('Auth needed');
			return;
		}
		return true;
	}


	// Get a users hostname from the users file
	function getUserHostName(ctx){
		if (process.env.USERSFILE !== undefined && process.env.USERSFILE != "" && ctx.request.headers['x-user-key'] !== undefined){
			const usrid = ctx.request.headers['x-user-key'];
			if (UsersList.hasOwnProperty(usrid)){
				return UsersList[usrid];
			}
		}
		return null;
	}

	// Check if a user allowed to request a tunnel
	function checkUserLogin(ctx,required = false){
		if (process.env.USERSFILE  !== undefined  && process.env.USERSFILE != ""){
			// Do we have the user header
			if (ctx.request.headers['x-user-key'] === undefined){
				debug('x-user-key header is missing!');
				return false;
			}

			const usrid = ctx.request.headers['x-user-key'];

			// Do we have a user list
			if (!Object.keys(UsersList).length){
				loadUsers();
			}

			// Did we find the user
			if (UsersList.hasOwnProperty(usrid) || (Array.isArray(UsersList) && UsersList.includes(usrid)) ){
				debug('Client approved - success, Client IP: %s',ctx.request.ip);
				return true;
			}
			debug('Client "%s" not found - failure, Client IP: %s',usrid,ctx.request.ip);
			return false;
		}
		// if we MUST login then this will fail
		if (required){
			return false;
		}
		return true;
	}

	// Reload users from the users.json file
	function loadUsers(){
		// Get users
		if (process.env.USERSFILE  !== undefined && process.env.USERSFILE != ""){
			// Do we have the file
			if (!fs.existsSync(process.env.USERSFILE)){
				console.error('"%s" file not found',process.env.USERSFILE);
				process.exit(1);
				return false
			}
			//try read the file
			try {
				var data = fs.readFileSync(process.env.USERSFILE);
				UsersList = JSON.parse(data);
			} catch (err) {
				console.error('Unable to read/parse the users file');
				process.exit(1);
				return false;
			}
			debug('Userlist read, found: %s entries',Object.keys(UsersList).length);
		}
	}
	function writeUsers(){
		let data = JSON.stringify(UsersList, null, 2);
		fs.writeFile(process.env.USERSFILE, data, (err) => {
			if (err) throw err;
		});
	}


	// ROUTES FOR dashboard - a small webserver wrapper
	router.get(dashboardfolder+'*', async (ctx, next) => {
		var reqLink = 'index.html';
		var clientdash = false;
		var folder = __dirname+dashboardfolder;

		// Requesting anything but main folder
		if (ctx.params[0] != ""){
			var reqpath = ctx.params[0].split("/");
			// Did we request a client link: /dasboard/c/*" - then we are handling a client/User login
			if (reqpath.length >= 2 && reqpath[0] == "c") {
				// Client request
				clientdash = true;
				// What file do we really want?
				if (reqpath[2] !== undefined){
					// Set file request to the requested if its not blank
					if (reqpath[2] != ""){
						reqLink = reqpath[2];
					}
				}else{
					//Redirect to clean the "input"
					ctx.status = 301;
					ctx.redirect(ctx.request.path+"/");
					return
				}
			}else{
				// Admin request
				reqLink = path.basename(ctx.params[0]);
			}

			// Are we serving a client? then try and find the client
			if (clientdash){
				const client = manager.getClient(reqpath[1]);
				// Failed to find the client!
				if (!client) {
					ctx.throw(404);
					return;
				}else{
					var cUsr = client.getAuthUsr();
					var cPass = client.getAuthPass();
					// Nothing to validate against then we fail - we must have something to help make it secure
					if (cUsr == null || cPass == null){
						ctx.throw(409);
						return;
					}
				}

				// Do we have auth headers
				var auth = ctx.request.headers['authorization'];
				clientdash = false;
				if(auth){
					if (authThis(auth,cUsr,cPass)) {
						clientdash = true;
						ctx.cookies.set('authType', 'user',{expires : 0, httpOnly: false});
					}
				}
			}
		}

		// If not client dash or not logged in as client then we request a login
		if (!clientdash){
			// Check admin login - we need a login and we will prompt for it
			if (!adminAuth(ctx,true,true)){
				ctx.throw(401, 'Unauthorized ');
				ctx.set('WWW-Authenticate', 'Basic realm="Secure Area"');
				ctb.body = 'Auth needed';
				return;
			}
			ctx.cookies.set('authType', 'admin',{expires : 0, httpOnly: false});
		}

		// Do we have the file requested?
		if (!fs.existsSync(folder+reqLink)){
			debug(folder+reqLink + ' not found');
			ctx.throw(404);
			return;
		}

		// Mime hack
		const mimeTypes = {
			'gif'  : 'image/gif',
			'jpeg' : 'image/jpeg',
			'jpg'  : 'image/jpeg',
			'jpe'  : 'image/jpeg',
			'png'  : 'image/png',
			'css'  : 'text/css',
			'js'   : 'text/javascript',
			'json' : 'application/json',
		};
		var fileExt = reqLink.split('.').pop().toLowerCase();
		var mimetype = "text/html";
		if (mimeTypes.hasOwnProperty(fileExt)){
			mimetype = mimeTypes[fileExt];
		}
		ctx.set('content-type',mimetype);
		ctx.body = fs.readFileSync(folder+path.basename(reqLink));
	})

	// ------------------------------------- ROUTES FOR APIs ------------------------------------------

	// Reload the users file
	router.get('/api/reloadUsers', async (ctx, next) => {
		// Do we have a users file?
		if (process.env.USERSFILE  === undefined || process.env.USERSFILE ==""){
			return true;
		}

		// Api header key is the first one - if that fails we can use the basic auth stuff
		if (!apiKeyCheck(ctx)){
			// Basic auth check, we MUST have security and prompt for login
			if (!adminAuth(ctx,true,true)){
				debug('/api/reloadUsers was blocked for %s',ctx.request.ip);
				ctx.throw(403, 'Forbidden');
				return;
			}
		}

		var prevUsers = Object.keys(UsersList).length;

		// Load the users list
		loadUsers();

		ctx.body = {
			noUsers: Object.keys(UsersList).length,
			PrevNoUsers: prevUsers
		};
	});


	// Add users
	router.post('/api/user/:user', async (ctx, next) => {
		// Do we have users
		if (process.env.USERSFILE === undefined || process.env.USERSFILE == ""){
			ctx.throw(404);
			return;
		}

		const userID = ctx.params.user;
		// Api header key is the first one - if that fails we can use the basic auth stuff
		if (!apiKeyCheck(ctx)){
			// Basic auth check - we need this and we will prompt if present
			if (!adminAuth(ctx,true,true)){
				debug('/api/status blocked for %s',ctx.request.ip);
				ctx.throw(403, 'Forbidden');
				return;
			}
		}
		// Load the users list
		loadUsers();

		// Simple user list or full
		var bUserAdded = false;
		if (Array.isArray(UsersList)){
			UsersList.push(userID);
			bUserAdded = true;
		}else if (ctx.request.headers['x-secret'] !== undefined && ctx.request.headers['x-secret'] != ""){
			UsersList[userID] = ctx.request.headers['x-secret'];
			bUserAdded = true;
		}
		if (bUserAdded){
			writeUsers();
			ctx.body = 'User "'+ userID+ '"" addedd';
		}else{
			ctx.throw(403, 'Bad Request');
			ctx.body = 'User "'+ userID+ '"" NOT addedd';
		}
		debug(ctx.body);
		return;
	});

	// delete users
	router.delete('/api/user/:user', async (ctx, next) => {
		// Do we have users
		if (process.env.USERSFILE === undefined || process.env.USERSFILE == ""){
			ctx.throw(404);
			return;
		}
		
		const userID = ctx.params.user;
		// Api header key is the first one - if that fails we can use the basic auth stuff
		if (!apiKeyCheck(ctx)){
			// Basic auth check - we need this and we will prompt if present
			if (!adminAuth(ctx,true,true)){
				debug('/api/status blocked for %s',ctx.request.ip);
				ctx.throw(403, 'Forbidden');
				return;
			}
		}
		// Load the users list
		loadUsers();

		// Delete user
		if (UsersList.hasOwnProperty(userID) || (Array.isArray(UsersList) && UsersList.includes(userID)) ){
			delete UsersList[userID];
		}
		writeUsers();
		ctx.body = 'User "'+ userID+ '"" deleted';
		debug(ctx.body);
		return;
	});


	// Main status api
	router.get('/api/status', async (ctx, next) => {
		// Api header key is the first one - if that fails we can use the basic auth stuff
		if (!apiKeyCheck(ctx)){
			// Basic auth check - we need this and we will prompt if present
			if (!adminAuth(ctx,true,true)){
				debug('/api/status blocked for %s',ctx.request.ip);
				ctx.throw(403, 'Forbidden');
				return;
			}
		}

		// Get the stats objects and build the output
		const stats = manager.stats;
		const clients = manager.clients;
		var returnClients = {};
		var loadavgres = [];
		os.loadavg().forEach(function(currentValue , index){
			loadavgres.push(currentValue.toFixed(2));
		});

		var availMem = Math.floor((os.freemem()/1024)/1024)+ " MB"
		// Fix for avail mem on unix
		if (os.platform() == "linux"){
			availMem = Math.floor(Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1])/1024) + " MB";
		}

		// Build clients
		Object.keys(clients).forEach(function (key) {
			returnClients[key] = { 'ip_adr' : clients[key].ipAdr };
			/*
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };
			returnClients[hri.random()+"horse"] = { 'ip_adr' : clients[key].ipAdr };*/

		});


		// Params data quick handler
		var inst = process.argv.slice(2);
		var keyVal = "";
		var paramsList = {};
		Object.keys(inst).forEach(function (key) {
			if (inst[key][0] == "-"){
				if (keyVal != ""){
					paramsList[keyVal] = true;
				}
				keyVal = inst[key];
			}else{
				if (keyVal != ""){
					paramsList[keyVal] = inst[key];
					keyVal = "";
				}
			}
		});
		// add last params
		if (keyVal != ""){
			paramsList[keyVal] = true;
		}

		ctx.body = {
			clients: returnClients,
			enviroment:{
				mem: process.memoryUsage(),
				cpu_usage: process.cpuUsage(),
				uptime: Math.floor(process.uptime()),
				exec : process.execPath,
				self: process.argv.slice(1,2).toString(),
				pid: process.pid,
			},
			os:{
				cpus: os.cpus().length,
				free_mem : availMem,
				total_mem: Math.floor((os.totalmem()/1024)/1024)+ " MB",
				uptime: os.uptime(),
				hostname : os.hostname(),
				load_avg: loadavgres,
				platform: os.platform(),
				version: os.release(),
			},
			configuration: {
				valid_hosts : validHosts,
				landing_page: landingPage,
				schema: schema,
				arguments: paramsList,
			}
		};
	});

	// Get a tunnels status
	router.get('/api/tunnels/:id/status', async (ctx, next) => {
		// Lookup the client info
		const clientId = ctx.params.id;
		const client = manager.getClient(clientId);
		// Client not found
		if (!client) {
			ctx.throw(404);
			return;
		}

		var loginOk = false;
		// Api header key if the first check
		if (apiKeyCheck(ctx)){
			loginOk = true;
		}

		// Lets try login using the main api auth if the apiKeyCheck failed, we need it, but wont prompt for it - normally the api is used by the dashboard
		if (!loginOk && adminAuth(ctx,true,false)){
			loginOk = true;
		}

		// Try using the user login header if everything else fails - again we need this so not having it will fail
		if (!loginOk && checkUserLogin(ctx,true)){
			loginOk = true
		}

		// User login needed if none of two main auths did not work
		if (!loginOk){
			var auth = ctx.request.headers['authorization'];
			var cUsr = client.getAuthUsr();
			var cPass = client.getAuthPass();
			// Nothing to validate against then we fail this
			if (cUsr == null || cPass == null){
				ctx.throw(409);
				return;
			}
			// Lets test and prompt for auth
			if(!auth || !authThis(auth,cUsr,cPass)) {
				debug("Client auth failed for client api");
				ctx.throw(401, 'Unauthorized ');
				ctx.set('WWW-Authenticate', 'Basic realm="Secure Area"');
				ctb.body = 'Auth needed';
				return;
			}
		}
		// Let send the data
		ctx.body = {
			basic : {
				id : client.id,
				ip_adr : client.ipAdr,
				auth : (client.authpass !== null && client.authusr !== null),
				secure: client.agent.secure,
				closed: client.agent.closed,
				keep_alive: client.agent.keepAlive,
				keep_alive_ms: client.agent.keepAliveMsecs,
			},
			stats : client.stats(),
		}
	});

	// Disconnect user users
	router.delete('/api/tunnels/:id', async (ctx, next) => {
		// Api header key is the first one - if that fails we can use the basic auth stuff
		if (!apiKeyCheck(ctx)){
			// Basic auth check - we need this and we will prompt if present
			if (!adminAuth(ctx,true,true)){
				debug('/api/client/ for %s',ctx.request.ip);
				ctx.throw(403, 'Forbidden');
				return;
			}
		}
		const clientId = ctx.params.id;
		const client = manager.getClient(clientId);
		// Client not found
		if (!client) {
			ctx.throw(404);
			return;
		}
		manager.disconnect(clientId);
		ctx.body = 'Client "' + clientId + '" disconnected';
		debug(ctx.body);
		return;
	});



	// Basic auth handler
	app.use(async (ctx, next) => {
		try {
			await next();
		} catch (err) {
			if (401 == err.status) {
				ctx.status = 401;
				ctx.set('WWW-Authenticate', 'Basic');
      			ctx.body = 'Not allowed!';
			} else {
				throw err;
			}
		}
	});

	app.use(router.routes());
	app.use(router.allowedMethods());


	// ------------------------------------- MAIN CLIENT ENDPOINTS ------------------------------------------
	// root endpoint for new/random clients
	app.use(async (ctx, next) => {
		const reqpath = ctx.request.path;
		// Skip if forbidden
		if (ctx.status == 403){
			await next();
			return;
		}
		// skip anything not on the root path
		if (reqpath !== '/') {
			await next();
			return;
		}

		// Did we request a new endpoint
		const isNewClientRequest = ctx.query['new'] !== undefined;
		if (isNewClientRequest) {
			// Check against users table - we allow it to be blank
			if (!checkUserLogin(ctx,false)){
				ctx.throw(403, 'Forbidden');
				await next();
				return;
			}

			// Set basic auth if requested to do so
			var authUser = null;var authPass = null;
			var authSet = false;
			if (ctx.request.headers['x-authuser'] && ctx.request.headers['x-authpass']){
				authUser = ctx.request.headers['x-authuser'];
				authPass = ctx.request.headers['x-authpass'];
				authSet = true;
			}

			// Getting a new random one or should we use the fixed on
			let reqId = getUserHostName(ctx);
			let reqIdOrg = reqId;
			if (reqId == null){
				reqId = hri.random();
			}

			const info = await manager.newClient(reqId,authUser,authPass,usrid,ctx.request.ip);
			if (reqIdOrg != null ){
                                debug('Made new random client with id "%s"', info.id);
                        }else{
                                debug('Made new client with id "%s"', info.id);
                        }

			const url = schema + '://' + info.id + '.' + ctx.request.host;
			info.url = url;
			if (authSet){
				info.dashboard = schema + '://' +ctx.request.host+dashboardfolder+'c/'+info.id+'/';
			}else{
				info.dashboard = false;
			}
			ctx.body = info;
			return;
		}

		// no new client request, send to landing page
		ctx.redirect(landingPage);
	});

	// anything after the / path is a request for a specific client name
	// This is a backwards compat feature
	app.use(async (ctx, next) => {
		const parts = ctx.request.path.split('/');
		// Skip if forbidden
		if (ctx.status == 403){
			await next();
			return;
		}

		// any request with several layers of paths is not allowed
		// rejects /foo/bar
		// allow /foo
		if (parts.length !== 2 || parts[1] == "favicon.ico") {
			await next();
			return;
		}

		// Check if user login is needed and if so ok
		if (!checkUserLogin(ctx,false)){
			ctx.throw(403, 'Forbidden');
			await next();
			return;
		}


		var reqId = parts[1];
		// limit requested hostnames to 63 characters
		if (! /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(reqId)) {
			debug('Invalid subdomain requested, "%s"',reqId);
			const msg = 'Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.';
			ctx.status = 403;
			ctx.body = {
				message: msg,
			};
			return;
		}

		// Do we allow the user to override the hostnames from the file
		if (process.env.ALLOWUSRHOSTOVERRIDE === "false"){
			let userHN = getUserHostName(ctx);
			if (userHN !== null && reqId != userHN){
				debug('Client requested "%s" - but we dont allow override, so serving "%s"', reqId,userHN);
				reqId = userHN;
			}
		}

		// Set basic auth if requested to do so
		var authUser = null;var authPass = null;
		var authSet = false;
		if (ctx.request.headers['x-authuser'] && ctx.request.headers['x-authpass']){
			authUser = ctx.request.headers['x-authuser'];
			authPass = ctx.request.headers['x-authpass'];
			authSet = true;
		}

		debug('Making new client with id "%s"', reqId);
		const info = await manager.newClient(reqId,authUser,authPass,ctx.request.ip);
		const url = schema + '://' + info.id + '.' + ctx.request.host;
		info.url = url;

		if (authSet){
			info.dashboard = schema + '://' +ctx.request.host+dashboardfolder+'c/'+info.id+'/';
                }else{
			info.dashboard = false;
		}

		ctx.body = info;
		return;
	});

	// Start the server
	let server;
	if (opt.secure) {
		// Do we have the file to run a secure setup?
		if (!fs.existsSync(process.env.SSL_KEY) || !fs.existsSync(process.env.SSL_CERT)) {
			console.error('Bad or missing cert files');
			process.exit(1);
		}
		debug('Running secure server, https, using %s , %s',process.env.SSL_KEY,process.env.SSL_CERT);
		server = https.createServer({
			key: fs.readFileSync(process.env.SSL_KEY, 'ascii'),
			cert: fs.readFileSync(process.env.SSL_CERT, 'ascii')
		});
	} else {
		server = http.createServer();
		debug('Running insecure server, http');
	}

	// Load any users if present
	loadUsers();

	const appCallback = app.callback();

	server.on('request', (req, res) => {
		// without a hostname, we won't know who the request is for
		const hostname = req.headers.host;
		if (!hostname) {
			res.statusCode = 400;
			res.end('Host header is required');
			return;
		}

		const clientId = GetClientIdFromHostname(hostname);
		if (!clientId) {
			appCallback(req, res);
			return;
		}

		const client = manager.getClient(clientId);
		if (!client) {
			res.statusCode = 404;
			res.end('404');
			return;
		}

		// Basic auth needed for this client
		if (!clientAuth(req,res,client)){
			return;
		}
		client.handleRequest(req, res);
	});

	server.on('upgrade', (req, socket, head) => {
		const hostname = req.headers.host;
		if (!hostname) {
			socket.destroy();
			return;
		}

		const clientId = GetClientIdFromHostname(hostname);
		if (!clientId) {
			socket.destroy();
			return;
		}

		const client = manager.getClient(clientId);
		if (!client) {
			socket.destroy();
			return;
		}

		client.handleUpgrade(req, socket);
	});

	return server;
};
