/*
 TODO:
    Test all api endpoints

    Logo/gfx

    Update README.md

    Dashboard:
        Favicon
        admin:
            client editor/display
            block/delete client in client list

    Client:
        prefix env with to_
        make evn fit arguments naming like in server
        check all env options
        env bool check like server

        local https problems

    Server generic:
        Better post options for client (handle body) in apis

 */
import Koa from 'koa';
import Router from 'koa-router';
import tldjs from 'tldjs';
import http from 'http';
import url from 'url';
import { hri } from 'human-readable-ids';
import https from 'https';
import fs from 'fs';
import { cwd } from 'process';

import ClientManager from './lib/ClientManager.js';

const packageInfo = require('./package');
const debug = require('debug')('tunnelout-server:main');
const path = require('path');
const os = require('os');

export default function (opt) {
    opt = opt || {};

    const landingPage = opt.landing || 'https://google.com';
    const clientAgentValid = opt.clientvalid || 'tunnelout';
    const validHosts = opt.domain ? [opt.domain] : undefined;
    const insecure = opt.insecure || false;
    const schema = insecure ? 'http' : 'https';
    const publicServer = opt.publicServer || false;
    const clientOverride = opt.clientOverride || false;
    const apiKey = opt.apikey || false;

    const keyFile = opt.keyFile;
    const certFile = opt.certFile;
    const clientsFile = opt.clientsFile;

    const myTldjs = tldjs.fromUserSettings({ validHosts });
    const dashPath = '/dashboard';
    const dashFolder = cwd() + '/dashboard/';
    const dashboardUser = opt.dashboardUser;
    const dashboardPass = opt.dashboardPass;

    const manager = new ClientManager({
        maxSockets: opt.maxSockets,
        secure: !insecure,
        keyFile: keyFile,
        certFile: certFile
    });

    const app = new Koa();
    const router = new Router();

    let clientsList = {};

    /* [CLIENT LOGIN RELATED] ------------------------------------------------------------------------------------------------------------------------------------------------------ */

    // Lookup a hostname based on the client id
    function GetClientIdFromHostname(hostname) {
        const hostsplit = hostname.split(':');
        return myTldjs.getSubdomain(hostsplit[0]);
    }

    function doWeHaveClientsList() {
        if (clientsFile !== undefined && clientsFile != '') {
            debug("doWeHaveClientsList: no client found");
            return true;
        }
        debug("doWeHaveClientsList: no client list found");
        return false;
    }

    function getClientFromClientsList(clientID) {
        if (!doWeHaveClientsList()) {
            return null;
        }

        if (!Object.keys(clientsList).length) {
            loadClients();
        }

        if (Object.prototype.hasOwnProperty.call(clientsList, clientID) || (Array.isArray(clientsList) && clientsList.includes(clientID))) {
            debug("getClientFromClientsList found: %s",clientsList[clientID])
            return clientsList[clientID];
        }
        return false;
    }

    function loadClients() {
        if (doWeHaveClientsList()) {
            // Do we have the file
            if (!fs.existsSync(clientsFile)) {
                console.error('"%s" file not found', clientsFile);
                process.exit(1);
                return false;
            }
            //try read the file
            try {
                let data = fs.readFileSync(clientsFile);
                clientsList = JSON.parse(data);
            } catch (err) {
                console.error('Unable to read/parse the clients file');
                process.exit(1);
                return false;
            }
            debug('ClientsList read, found: %s entries', Object.keys(clientsList).length);
        }
    }

    function writeClients() {
        let data = JSON.stringify(clientsList, null, 2);
        fs.writeFile(clientsFile, data, (err) => {
            if (err) throw err;
        });
    }

    // Check if a client allowed to request a tunnel
    function checkClientHeaderLogin(ctx) {
        let clientHKey = null;
        if ('x-client-key' in ctx.request.headers && ctx.request.headers['x-client-key'] !== undefined) {
            clientHKey = ctx.request.headers['x-client-key'];
        }

        // íf dont have anything to validate the agent against then we will return true on a public else false
        if (clientHKey == null || !doWeHaveClientsList()) {
            debug('No way to auth - public server: %s', publicServer);
            return publicServer;
        }

        let clientHost = getClientFromClientsList(clientHKey);
        if (clientHost == null) {
            debug('Client "%s" not found - failure, Client IP: %s', clientHKey, ctx.request.ip);
            debug('Auth failed - public server: %s', publicServer);
            return publicServer;
        }

        debug('Client approved - success, Client IP: %s, public server: %s', ctx.request.ip, publicServer);
        return true;
    }

    // API header key login check
    function apiKeyCheck(ctx) {
        debug('API auth: started');
        let keyChk = null;
        // Check if the key is present
        if ('x-api-key' in ctx.request.headers) {
            keyChk = ctx.request.headers['x-api-key'];
        } else if ('authorization' in ctx.request.headers) {
            keyChk = ctx.request.headers['authorization'].replace('Bearer ', '');
        }
        if (keyChk != null && apiKey !== undefined && apiKey != '' && apiKey != 'false' && keyChk == apiKey) {
            debug('API auth: APPROVED');
            return true;
        }
        debug('API auth: FAILED');
        return false;
    }

    /* [WEB DASHBOARD] ----------------------------------------------------------------------------------------------------------------------------------------------------------- */

    /* basic webserver*/
    function webserveFile(ctx, filename) {
        if (filename == '' || filename == '/') {
            filename = 'index.html';
        }
        filename = dashFolder + path.basename(filename);

        // Do we have the file requested?
        if (!fs.existsSync(filename)) {
            debug(filename + ' not found on server!');
            ctx.throw(404);
            return;
        }

        const mimeTypes = {
            gif: 'image/gif',
            jpeg: 'image/jpeg',
            jpg: 'image/jpeg',
            jpe: 'image/jpeg',
            png: 'image/png',
            ico: 'image/x-ico',
            css: 'text/css',
            js: 'text/javascript',
            json: 'application/json'
        };

        let fileExt = path.extname(filename).replace('.', '');
        let mimetype = 'text/html';
        if (Object.prototype.hasOwnProperty.call(mimeTypes, fileExt)) {
            mimetype = mimeTypes[fileExt];
        }
        ctx.set('content-type', mimetype);
        ctx.body = fs.readFileSync(filename);
    }

    // web Auth check for a user
    function authThis(authval, user, pass) {
        if (authval == '' || authval == undefined) {
            return false;
        }
        let tmp = authval.split(' ');
        if (tmp.length <= 1) {
            return false;
        }
        let buf = Buffer.from(tmp[1], 'base64');
        let plaintxt = buf.toString().split(':');

        if (plaintxt[0] == user && plaintxt[1] == pass) {
            return true;
        }
        return false;
    }

    function buildAuthRequest(ctx) {
        debug('Auth request started');
        ctx.throw(401, 'Unauthorized ');
        ctx.set('WWW-Authenticate', 'Basic realm="tunnelOut"');
        return false;
    }

    // Admin auth
    function adminAuthCheck(ctx, promptLogin) {
        debug('Admin AUTH: started');

        // No auth header - then ask for auth
        if (!('authorization' in ctx.request.headers)) {
            if (promptLogin) {
                buildAuthRequest(ctx);
            }
            return false;
        }

        // Do we have basic auth
        if (dashboardUser === undefined || dashboardUser === false || dashboardPass === undefined || dashboardPass === false) {
            debug('Admin AUTH: missing enviroment');
            return false;
        }

        // check admin auth
        if (authThis(ctx.request.headers['authorization'], dashboardUser, dashboardPass) == false) {
            debug('Admin AUTH: failed');
            if (promptLogin) {
                buildAuthRequest(ctx);
            }
            return false;
        }

        debug('Admin Auth approved');
        ctx.cookies.set('authType', 'admin', { expires: 0, httpOnly: false });
        return true;
    }

    // Auth a basic client
    function clientAuth(client, ctx) {
        debug('Client AUTH: started');

        // No auth header - then ask for auth
        if (!('authorization' in ctx.request.headers)) {
            buildAuthRequest(ctx);
            return false;
        }

        // Admin is always allowed - but don't prompt yet - we will try as client
        if (adminAuthCheck(ctx, false)) {
            debug('Client AUTH: approved as admin');
            return true;
        }

        let authData = client.getAuthInfo();
        // Nothing to validate against
        if (authData === null) {
            debug('Client AUTH: No auth data found');
            ctx.throw(409);
            return false;
        }

        // No auth headers sent the lets ask
        if (authThis(ctx.request.headers['authorization'], authData.usr, authData.pass) == false) {
            debug('Client AUTH: Failed');
            buildAuthRequest(ctx);
            return false;
        }

        debug('Client AUTH: auth approved');
        ctx.cookies.set('authType', 'client', { expires: 0, httpOnly: false });
        return true;
    }

    /* [DASHBOARD WEB UI] -------------------------------------------------------------------------------------------------------------------------------------------------------- */
    router.get('/favicon.ico', async (ctx) => {
        webserveFile(ctx, 'favicon.ico');
    });

    // client dashboard
    router.get(dashPath + '/c/:clientid/(.*)', async (ctx) => {
        // Lookup the client id
        const client = manager.getClient(ctx.params.clientid);

        // Failed to find the client - not connected the we fail
        if (!client) {
            debug(ctx.params.clientid + ' not found!');
            ctx.throw(404);
            return;
        }

        // Try client auth (and admin auth)
        if (!clientAuth(client, ctx)) {
            return;
        }

        let file = '';
        if (0 in ctx.params && ctx.params[0] != '') {
            file = ctx.params[0];
        }
        webserveFile(ctx, file);
    });

    // redirect to client dashboard if just requesting /dash/c/xxxxx without trailing slash
    router.get(dashPath + '/c/(.*)', async (ctx) => {
        if (!(0 in ctx.params) || ctx.params[0] == '') {
            debug('No client requested!');
            ctx.throw(404);
            return;
        }
        // Redirect with a trailing slash
        ctx.status = 301;
        ctx.redirect(dashPath + '/c/' + ctx.params[0] + '/');
    });

    // admin/main dashboard
    router.get(dashPath + '(.*)', async (ctx) => {
        if (!adminAuthCheck(ctx, true)) {
            return;
        }
        // redirect to add trailing slash to the url
        if (!(0 in ctx.params) || ctx.params[0] == '') {
            ctx.status = 301;
            ctx.redirect(dashPath + '/');
            return;
        }
        let file = '';
        if (0 in ctx.params && ctx.params[0] != '') {
            file = ctx.params[0];
        }
        webserveFile(ctx, file);
    });

    /* [CLIENTS API ENDPOINT] ------------------------------------------------------------------------------------------------------------------------------------------------------- */

    // Reload the client file
    router.get('/api/S/reload', async (ctx) => {
        if (!doWeHaveClientsList()) {
            ctx.throw(404);
            return;
        }

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx) && !adminAuthCheck(ctx, true)) {
            return;
        }

        let prevClients = Object.keys(clientsList).length;

        // Load the clients list
        loadClients();

        ctx.body = {
            noClient: Object.keys(clientsList).length,
            PrevNoClient: prevClients
        };
    });

    // Add client
    router.post('/api/clients/:client', async (ctx) => {
        if (!doWeHaveClientsList()) {
            ctx.throw(404);
            return;
        }

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx) && !adminAuthCheck(ctx, true)) {
            return;
        }

        const clientID = path.basename(ctx.params.client);

        loadClients();

        let bClientAdded = false;
        if (Array.isArray(clientsList)) {
            clientsList.push(clientID);
            bClientAdded = true;
        } else if ('x-secret' in ctx.request.headers && ctx.request.headers['x-secret'] !== undefined && ctx.request.headers['x-secret'] != '') {
            clientsList[clientID] = ctx.request.headers['x-secret'];
            bClientAdded = true;
        }
        if (bClientAdded) {
            writeClients();
            ctx.body = 'Client "' + clientID + '" addedd';
        } else {
            ctx.throw(403, 'Bad Request');
            ctx.body = 'Client "' + clientID + '" NOT addedd';
        }
        debug(ctx.body);
    });

    // delete client
    router.delete('/api/clients/:clientid', async (ctx) => {
        if (!doWeHaveClientsList()) {
            ctx.throw(404);
            return;
        }

        const clientid = path.basename(ctx.params.clientid);

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx) && !adminAuthCheck(ctx, true)) {
            return;
        }

        loadClients();

        if (Object.prototype.hasOwnProperty.call(clientsList, clientid) || (Array.isArray(clientsList) && clientsList.includes(clientid))) {
            delete clientsList[clientid];
        }
        writeClients();
        ctx.body = 'Client "' + clientid + '" deleted';
        debug(ctx.body);
    });

    /* [STATUS API ENDPOINTS] ---------------------------------------------------------------------------------------------------------------------------------------------------- */
    // Main status api
    router.get('/api/status', async (ctx) => {
        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx) && !adminAuthCheck(ctx, true)) {
            return;
        }

        // Get the stats objects and build the output
        const clients = manager.clients;
        let returnClients = {};
        let loadavgres = [];
        os.loadavg().forEach(function (currentValue) {
            loadavgres.push(currentValue.toFixed(2));
        });

        let availMem = Math.floor(os.freemem() / 1024 / 1024) + ' MB';
        // Fix for avail mem on unix
        if (os.platform() == 'linux') {
            availMem = Math.floor(Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024) + ' MB';
        }

        // Build clients
        Object.keys(clients).forEach(function (key) {
            returnClients[key] = { ip_adr: clients[key].ipAdr };
        });

        // Params data quick handler
        let inst = process.argv.slice(2);
        let keyVal = '';
        let paramsList = {};
        Object.keys(inst).forEach(function (key) {
            if (inst[key][0] == '-') {
                if (keyVal != '') {
                    paramsList[keyVal] = true;
                }
                keyVal = inst[key];
            } else {
                if (keyVal != '') {
                    paramsList[keyVal] = inst[key];
                    keyVal = '';
                }
            }
        });
        // add last params
        if (keyVal != '') {
            paramsList[keyVal] = true;
        }

        ctx.body = {
            clients: returnClients,
            enviroment: {
                mem: process.memoryUsage(),
                cpu_usage: process.cpuUsage(),
                uptime: Math.floor(process.uptime()),
                exec: process.execPath,
                self: process.argv.slice(1, 2).toString(),
                pid: process.pid
            },
            os: {
                cpus: os.cpus().length,
                free_mem: availMem,
                total_mem: Math.floor(os.totalmem() / 1024 / 1024) + ' MB',
                uptime: os.uptime(),
                hostname: os.hostname(),
                load_avg: loadavgres,
                platform: os.platform(),
                version: os.release()
            },
            configuration: {
                valid_hosts: validHosts,
                landing_page: landingPage,
                schema: schema,
                arguments: paramsList
            },
            packinfo: packageInfo
        };
    });

    // Get a tunnels status
    router.get('/api/tunnels/:id', async (ctx) => {
        // Lookup the client info
        const clientId = ctx.params.id;
        const client = manager.getClient(clientId);
        // Client not found
        if (!client) {
            ctx.throw(404);
            return;
        }

        // Try api and user/admin login
        if (!apiKeyCheck(ctx) && !clientAuth(client, ctx)) {
            return false;
        }

        // Let send the data
        ctx.body = {
            basic: {
                id: client.id,
                agent: client.agentName,
                ip_adr: client.ipAdr,
                auth: client.authpass !== null && client.authusr !== null,
                secure: client.agent.secure,
                closed: client.agent.closed,
                keep_alive: client.agent.keepAlive,
                keep_alive_ms: client.agent.keepAliveMsecs
            },
            stats: client.stats()
        };
    });

    // Disconnect a tunnel
    router.delete('/api/tunnels/:id', async (ctx) => {
        const clientId = ctx.params.id;
        const client = manager.getClient(clientId);
        // Client not found
        if (!client) {
            ctx.throw(404);
            return;
        }

        // Try api and user/admin login
        if (!apiKeyCheck(ctx) && !clientAuth(client, ctx)) {
            return false;
        }

        manager.disconnect(clientId);
        ctx.body = 'Client "' + clientId + '" disconnected';
        debug(ctx.body);
    });

    // Error handler
    app.use(async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            if (401 == err.status) {
                ctx.status = 401;
                ctx.set('WWW-Authenticate', 'Basic');
                webserveFile(ctx, '401.html');
            } else if (404 == err.status) {
                ctx.status = 404;
                webserveFile(ctx, '404.html');
            } else {
                throw err;
            }
        }
    });

    app.use(router.routes());
    app.use(router.allowedMethods());

    /* [NEW TUNNEL CREATION ENDPOINT] -------------------------------------------------------------------------------------------------------------------------------------------- */
    // root endpoint for new/random clients
    app.use(async (ctx, next) => {
        const reqpath = ctx.request.path;
        const parts = reqpath.split('/');

        // Skip if forbidden
        if (ctx.status == 403) {
            await next();
            return;
        }

        // Did we request a new endpoint or not
        if ((ctx.query['new'] == undefined && reqpath === '/') || parts.length !== 2 || parts[1] == 'favicon.ico' || parts[1] == 'robots.txt') {
            // no new client request, send to landing page
            debug('Non handled request');
            if (landingPage != undefined) {
                ctx.redirect(landingPage);
                return;
            }
            ctx.throw(404);
            return;
        }

        // Valid client/user
        let clientAgent = 'unknown';
        if ('user-agent' in ctx.request.headers) {
            clientAgent = ctx.request.headers['user-agent'];
        }
        if (clientAgentValid !== false && clientAgent.indexOf(clientAgentValid) == -1) {
            debug('Invalid agent: %s != %s', clientAgent, clientAgentValid);
            ctx.status = 307;
            ctx.set('location', landingPage);
            ctx.body = { errorMsg: 'Invalid client agent: ' + clientAgent };
            return;
        }

        // Check against client table
        if (!checkClientHeaderLogin(ctx)) {
            ctx.status = 403;
            ctx.body = { errorMsg: 'Invalid or missing x-client-key header' };
            return;
        }

        let reqHostname = null;
        let clientReqHostName = null;
        if ('x-client-key' in ctx.request.headers && ctx.request.headers['x-client-key'] != undefined) {
            clientReqHostName = getClientFromClientsList(ctx.request.headers['x-client-key']);
        }

        // classic methods first
        if (reqpath !== '/') {
            const parts = reqpath.split('/');
            if (parts.length !== 2 || parts[1] == 'favicon.ico') {
                await next();
                return;
            }

            reqHostname = parts[1];
            // limit requested hostnames to 63 characters
            if (!/^(?:[a-z0-9][a-z0-9-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(reqHostname)) {
                debug('Invalid subdomain requested, "%s"', reqHostname);
                const msg = 'Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.';
                ctx.status = 403;
                ctx.body = {
                    message: msg
                };
                return;
            }

            // Do we allow the user to override the hostnames from the file
            if (clientOverride === false) {
                if (clientReqHostName !== null && reqHostname != clientReqHostName) {
                    debug('Client requested "%s" - but we dont allow override, so serving "%s"', reqHostname, clientReqHostName);
                    reqHostname = clientReqHostName;
                }
            }
        }

        // No classic name found
        if (reqHostname == null) {
            if (clientReqHostName != null){
                reqHostname = clientReqHostName;
            }else{
                reqHostname = hri.random();
            }
        }

        // Set basic auth if requested to do so
        let authUser = null;
        let authPass = null;
        let authSet = false;
        if ('x-authuser' in ctx.request.headers && ctx.request.headers['x-authuser'] != '' && 'x-authpass' in ctx.request.headers && ctx.request.headers['x-authpass']) {
            authUser = ctx.request.headers['x-authuser'];
            authPass = ctx.request.headers['x-authpass'];
            authSet = true;
        }

        // Create the client
        const info = await manager.newClient(reqHostname, authUser, authPass, ctx.request.ip, clientAgent);

        // Status
        if (reqHostname == info.id) {
            debug('Made new client with requested id "%s"', info.id);
        } else {
            debug('Made new random client with id "%s"', info.id);
        }

        // Set server header - the client validates against this
        ctx.set('server', packageInfo.name + '/' + packageInfo.version);

        // Set return payload
        const url = schema + '://' + info.id + '.' + ctx.request.host;
        info.url = url;
        if (authSet) {
            info.dashboard = schema + '://' + ctx.request.host + dashPath + '/c/' + info.id + '/';
        } else {
            info.dashboard = false;
        }
        ctx.body = info;
    });

    /* [START TUNNEL AND HANDLE ALL REQUESTS]   ------------------------------------------------------------------------------------------------------------------------------------ */
    // Start the server
    let server;
    if (insecure) {
        server = http.createServer();
        debug('Running insecure server, http');
    } else {
        // Do we have the file to run a secure setup?
        if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
            console.error('Bad or missing cert files');
            process.exit(1);
        }
        debug('Running secure server, https, using %s , %s', keyFile, certFile);
        server = https.createServer({
            key: fs.readFileSync(keyFile, 'ascii'),
            cert: fs.readFileSync(certFile, 'ascii')
        });
    }

    // Load any client if present
    loadClients();

    const appCallback = app.callback();

    // main data handling between client and server
    server.on('request', (req, res) => {
        // without a hostname, we won"t know who the request is for
        const hostname = req.headers.host;
        if (!hostname) {
            res.statusCode = 400;
            res.end('Host header is required');
            return;
        }

        // If no client id found the send it to the other routes
        const clientId = GetClientIdFromHostname(hostname);
        if (!clientId) {
            appCallback(req, res);
            return;
        }

        // Get client data/info
        const client = manager.getClient(clientId);
        if (!client) {
            res.statusCode = 404;
            res.end('404');
            return;
        }

        // Basic auth needed for this client
        const authData = client.getAuthInfo();
        // Do we need to auth
        if (authData != null) {
            // Can we auth?
            if (!('authorization' in req.headers) || authThis(req.headers['authorization'], authData.usr, authData.pass) == false) {
                res.statusCode = 401;
                res.setHeader('WWW-Authenticate', 'Basic realm="tunnelOut"');
                res.end(fs.readFileSync(dashFolder + '401.html'));
                return;
            }
        }
        client.handleRequest(req, res);
    });

    server.on('upgrade', (req, socket) => {
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
}
