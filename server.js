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

	// If requested we can have an api key
	function checkAPI(ctx) {
		if (process.env.API_KEY !== undefined && ctx.request.headers['x-api-key'] != process.env.API_KEY){
			return false;
		}
		return true;
	}

	function getUserHostName(ctx){
		if (process.env.USERSFILE  !== undefined && ctx.request.headers['x-user-key'] !== undefined){
			const usrid = ctx.request.headers['x-user-key'];
			if (UsersList.hasOwnProperty(usrid)){
				return UsersList[usrid];
			}
		}
		return null;
	}

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
				debug('User approved - success, Client IP: %s',ctx.request.ip);
				return true;
			}
			debug('User "%s" not found - failure, Client IP: %s',usrid,ctx.request.ip);
			return false;
		}
		return true;
	}

	function loadUsers(){
		// Get users
		if (process.env.USERSFILE  !== undefined){
			// Do we have the file
			if (!fs.existsSync(process.env.USERSFILE)){
				debug('"%s" file not found',process.env.USERSFILE);
				process.exit(1);
				return false
			}
			//try read the file
			try {
				var data = fs.readFileSync(process.env.USERSFILE);
				UsersList = JSON.parse(data);
			} catch (err) {
				debug('User failed - unable to read/parse the users file');
				process.exit(1);
				return false;
			}
			debug('Userlist read, found: %s entries',Object.keys(UsersList).length);
		}

	}


	// ROUTES FOR APIs
	router.get('/api/reloadUsers', async (ctx, next) => {
		if (!checkAPI(ctx)){
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
		if (!checkAPI(ctx)){
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
		if (checkAPI(ctx)){
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
			let reqId = getUserHostName(ctx);
			if (reqId == null){
				reqId = hri.random();
				debug('making new random client with id "%s"', reqId);
			}else{
				debug('making new client with id "%s"', reqId);
			}
			const info = await manager.newClient(reqId);

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

		const reqId = parts[1];
		// limit requested hostnames to 63 characters
		if (! /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(reqId)) {
			const msg = 'Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.';
			ctx.status = 403;
			ctx.body = {
				message: msg,
			};
			return;
		}

		debug('making new client with id "%s"', reqId);
		const info = await manager.newClient(reqId);

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
