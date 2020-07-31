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

	function checkUserLogin(ctx){
		if (process.env.USERSFILE  !== undefined){
			// Do we have the file
			if (!fs.existsSync(process.env.USERSFILE)){
				debug('"%s" file not found',process.env.USERSFILE);
				process.exit(1);
				return false
			}
			// Do we have the user header
			if (ctx.request.headers['x-user-key'] === undefined){
				debug('x-user-key header is missing!');
				return false;
			}

			const usrid = ctx.request.headers['x-user-key'];
			let users = '';
			//try read the file
			try {
				var data = fs.readFileSync(process.env.USERSFILE);
				users = JSON.parse(data);
			} catch (err) {
				debug('User failed - unable to read/parse the users file');
				process.exit(1);
				return false;
			}

			// Did we find the user
			if (users.hasOwnProperty(usrid)){
				debug('User approved - success');
				return true;
			}
			debug('User not found - failure');
			return false;
		}
		return true;
	}


	router.get('/api/status', async (ctx, next) => {
		if (checkAPI(ctx)){
			debug('/api/status was blocked for %s',ctx.request.ip);
			ctx.throw(403, 'Forbidden');
		}
		const stats = manager.stats;
		ctx.body = {
			tunnels: stats.tunnels,
			mem: process.memoryUsage(),
		};
	});

	router.get('/api/tunnels/:id/status', async (ctx, next) => {
		if (checkAPI(ctx)){
			debug('/api/tunnels/:id/status was blocked for %s',ctx.request.ip);
			ctx.throw(403, 'Forbidden');
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

	// root endpoint
	app.use(async (ctx, next) => {
		const path = ctx.request.path;

		// skip anything not on the root path
		if (path !== '/') {
			await next();
			return;
		}

		const isNewClientRequest = ctx.query['new'] !== undefined;
		if (isNewClientRequest) {
			if (!checkUserLogin(ctx)){
				ctx.throw(403, 'Forbidden');
				return;
			}

			const reqId = hri.random();
			debug('making new client with id %s', reqId);
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

		// any request with several layers of paths is not allowed
		// rejects /foo/bar
		// allow /foo
		if (parts.length !== 2) {
			await next();
			return;
		}

		if (!checkUserLogin(ctx)){
			ctx.throw(403, 'Forbidden');
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

		debug('making new client with id %s', reqId);
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
