import log from 'book';
import Koa from 'koa';
import tldjs from 'tldjs';
import Debug from 'debug';
import http from 'http';
import { hri } from 'human-readable-ids';
import Router from 'koa-router';

import https from 'https'
import fs from 'fs'

import ClientManager from './lib/ClientManager';

const debug = Debug('localtunnel:server');

export default function(opt) {
	opt = opt || {};

	// Constants used
	const validHosts = (opt.domain) ? [opt.domain] : undefined;
	const myTldjs = tldjs.fromUserSettings({ validHosts });
	const landingPage = opt.landing || 'https://cloudkit.app';

	const manager = new ClientManager(opt);

	const schema = opt.secure ? 'https' : 'http';

	const app = new Koa();
	const router = new Router();
	let UsersList = {};

	// Lookup a hostname based on the client id
	function GetClientIdFromHostname(hostname) {
		return myTldjs.getSubdomain(hostname);
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
	function apiBasicAuth(ctx){
		// Do we have basic auth
		if (process.env.API_BASICAUTH === undefined || process.env.API_BASICAUTH === "false"){
			return true;
		}else{
			// Lookup auth info
			var authIDs = process.env.API_BASICAUTH.split(":");
			if (authIDs.length != 2){
				console.error('Bad configuration of API_BASICAUTH: "%s"',process.env.API_BASICAUTH);
				process.exit(1);
				return false;
			}
			// Taken from: https://gist.github.com/charlesdaniel/1686663
			var auth = ctx.request.headers['authorization'];
			if(!auth) {
				debug("Auth needed");
				ctx.throw(401, 'Unauthorized ');
				ctx.set('WWW-Authenticate', 'Basic realm="Secure Area"');
				ctb.body = 'Auth needed';
				return false;
			}

			if (!authThis(auth,authIDs[0],authIDs[1])){
				debug("Auth failed");
				ctx.throw(401, 'Unauthorized ');
				ctx.set('WWW-Authenticate', 'Basic realm="Secure Area"');
				ctb.body = 'Auth failed';
				return false;
			}
			debug("Auth approved");
			return true;
		}
	}

	// If requested we can have an api key
	function apiKeyCheck(ctx) {
		// Check if the key is present
		if (process.env.API_KEY !== undefined && process.env.API_KEY != "" && process.env.API_KEY != "false" && ctx.request.headers['x-api-key'] != process.env.API_KEY){
			return false;
		}
		return true;
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
		if(!auth) {     // No Authorization header was passed in so it's the first time the browser hit us
			debug("Client auth missing");
			res.statusCode = 401;
			res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
			res.end('Auth needed');
			return;
		}
		// Did we pass?
		if (!authThis(auth,cUsr,cPass)){
			debug("Client auth failed");
			debug("Auth failed");
			res.statusCode = 401;
			res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
			res.end('Failed');
			return false;
		}
		return true;
	}


	// Get a users hostname from the users file
	function getUserHostName(ctx){
		if (process.env.USERSFILE !== undefined && ctx.request.headers['x-user-key'] !== undefined){
			const usrid = ctx.request.headers['x-user-key'];
			if (UsersList.hasOwnProperty(usrid)){
				return UsersList[usrid];
			}
		}
		return null;
	}

	// Check if a user allowed to request a tunnel
	function checkUserLogin(ctx){
		if (process.env.USERSFILE  !== undefined){
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
			if (UsersList.hasOwnProperty(usrid) || UsersList.includes(usrid)){
				debug('Client approved - success, Client IP: %s',ctx.request.ip);
				return true;
			}
			debug('Client "%s" not found - failure, Client IP: %s',usrid,ctx.request.ip);
			return false;
		}
		return true;
	}

	// Reload users from the users.json file
	function loadUsers(){
		// Get users
		if (process.env.USERSFILE  !== undefined){
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


	// ROUTES FOR APIs
	router.get('/api/reloadUsers', async (ctx, next) => {
		// Basic auth check
		if (!apiBasicAuth(ctx)){
			return;
		}
		// Api header key
		if (!apiKeyCheck(ctx)){
			debug('/api/reloadUsers was blocked for %s',ctx.request.ip);
			ctx.throw(403, 'Forbidden');
			return;
		}

		// Do we have a users file?
		if (process.env.USERSFILE  === undefined){
			return true;
		}
		var prevUsers = Object.keys(UsersList).length;

		// Load the users list
		loadUsers();

		ctx.body = {
			noUsers: Object.keys(UsersList).length,
			PrevNoUsers: prevUsers
		};
	});

	router.get('/api/status', async (ctx, next) => {

		// Basic auth check
		if (!apiBasicAuth(ctx)){
			return;
		}

		// Api header key
		if (!apiKeyCheck(ctx)){
			debug('/api/status was blocked for %s',ctx.request.ip);
			ctx.throw(403, 'Forbidden');
			return;
		}

		const stats = manager.stats;
		ctx.body = {
			tunnels: stats.tunnels,
			mem: process.memoryUsage(),
		};
	});


	// Reload uses on request
	router.get('/api/tunnels/:id/status', async (ctx, next) => {
		// Basic auth check
		if (!apiBasicAuth(ctx)){
			return;
		}
		// Api header key
		if (apiKeyCheck(ctx)){
			debug('/api/tunnels/:id/status was blocked for %s',ctx.request.ip);
			ctx.throw(403, 'Forbidden');
			return;
		}
		const clientId = ctx.params.id;
		const client = manager.getClient(clientId);
		if (!client) {
			ctx.throw(404);
			return;
		}

		const stats = client.stats();
		ctx.body = {
			connected_sockets: stats.connectedSockets,
		};
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

	// root endpoint for new/random clients
	app.use(async (ctx, next) => {
		const path = ctx.request.path;
		// Skip if forbidden
		if (ctx.status == 403){
			await next();
			return;
		}
		// skip anything not on the root path
		if (path !== '/') {
			await next();
			return;
		}

		// Did we request a new endpoint
		const isNewClientRequest = ctx.query['new'] !== undefined;
		if (isNewClientRequest) {
			if (!checkUserLogin(ctx)){
				ctx.throw(403, 'Forbidden');
				await next();
				return;
			}

			// Set basic auth if requested to do so
			var authUser = null;var authPass = null;
			if (ctx.request.headers['x-authuser'] && ctx.request.headers['x-authpass']){
				authUser = ctx.request.headers['x-authuser'];
				authPass = ctx.request.headers['x-authpass'];
			}

			// Getting a new random one or should we use the fixed on
			let reqId = getUserHostName(ctx);
			if (reqId == null){
				reqId = hri.random();
				debug('Making new random client with id "%s"', reqId);
			}else{
				debug('Making new client with id "%s"', reqId);
			}
			const info = await manager.newClient(reqId,authUser,authPass);

			const url = schema + '://' + info.id + '.' + ctx.request.host;
			info.url = url;
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
		if (parts.length !== 2) {
			await next();
			return;
		}

		// Check if user login is needed and if so ok
		if (!checkUserLogin(ctx)){
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
		if (ctx.request.headers['x-authuser'] && ctx.request.headers['x-authpass']){
			authUser = ctx.request.headers['x-authuser'];
			authPass = ctx.request.headers['x-authpass'];
		}

		debug('Making new client with id "%s"', reqId);
		const info = await manager.newClient(reqId,authUser,authPass);

		const url = schema + '://' + info.id + '.' + ctx.request.host;
		info.url = url;
		ctx.body = info;
		return;
	});

	let server;
	if (opt.secure && fs.existsSync(process.env.SSL_KEY) && fs.existsSync(process.env.SSL_CERT)) {
		debug('Running secure server, https using %s , %s',process.env.SSL_KEY,process.env.SSL_CERT);
		server = https.createServer({
			key: fs.readFileSync(process.env.SSL_KEY, 'ascii'),
			cert: fs.readFileSync(process.env.SSL_CERT, 'ascii')
		});
	} else {
		server = http.createServer();
		debug('Running insecure server, http');
	}

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
