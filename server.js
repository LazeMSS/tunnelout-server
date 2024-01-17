/*
 TODO:
    Update README.md
*/
import Koa from 'koa';
import Router from 'koa-router';
import tldjs from 'tldjs';
import http from 'http';
import https from 'https';
import url from 'url';
import { hri } from 'human-readable-ids';
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
    const redirecthttp = opt.nohttpredir ? false : true;
    const schema = insecure ? 'http' : 'https';
    const publicServer = opt.publicServer || false;
    const clientOverride = opt.clientOverride || false;
    const apiKey = opt.apikey || false;
    const logoURL = opt.logoUrl || '/dashboard/gfx/logo.png';
    const favIconPng = opt.siteFaviconPng || '/dashboard/gfx/favicon-32x32.png';
    const favIcon = opt.siteFavicon || 'favicon.ico';
    const siteTitle = opt.siteTitle || 'tunnelOut';

    const keyFile = opt.keyFile;
    const certFile = opt.certFile;
    const clientsFile = opt.clientsFile;

    const myTldjs = tldjs.fromUserSettings({ validHosts });
    const dashPath = '/dashboard';
    const dashFolder = cwd() + '/dashboard/';
    const dashboardUser = opt.dashboardUser;
    const dashboardPass = opt.dashboardPass;
    const maxConsPerClient = opt.maxClientConnections || 1;

    const manager = new ClientManager({
        maxSockets: opt.maxSockets,
        secure: !insecure,
        keyFile: keyFile,
        certFile: certFile
    });

    const app = new Koa();
    const router = new Router();

    let clientsList = {};
    let clientsListLoaded = false;
    let clientConnectList = {};

    let apiBody = null;

    /* [CLIENT LOGIN RELATED] ------------------------------------------------------------------------------------------------------------------------------------------------------ */

    // Lookup a hostname based on the client id
    function GetClientIdFromHostname(hostname) {
        const hostsplit = hostname.split(':');
        return myTldjs.getSubdomain(hostsplit[0]);
    }

    function doWeHaveClientsList() {
        if (clientsFile !== undefined && clientsFile != '') {
            debug('doWeHaveClientsList: clients file specified: %s', clientsFile);
            return true;
        }
        debug('doWeHaveClientsList: No clients file specified');
        return false;
    }

    function getClientHostnameFromClientsList(clientID) {
        if (!doWeHaveClientsList()) {
            return null;
        }

        if (!clientsListLoaded) {
            debug('getClientHostnameFromClientsList: No clients found - loading the file...');
            loadClients();
        }

        if (Object.prototype.hasOwnProperty.call(clientsList, clientID) || (Array.isArray(clientsList) && clientsList.includes(clientID))) {
            debug('getClientHostnameFromClientsList: found client "%s"', clientsList[clientID]);
            if (Object.prototype.hasOwnProperty.call(clientsList[clientID], 'hostname')) {
                return clientsList[clientID].hostname;
            }
            return clientsList[clientID];
        }
        debug('getClientHostnameFromClientsList: Unable to find client: %s', clientID);
        return null;
    }

    function loadClients() {
        if (!doWeHaveClientsList()) {
            return false;
        }

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
            console.error('Unable to read/parse the clients file: %s', err);
            process.exit(1);
            return false;
        }
        clientsListLoaded = true;
        debug('loadClients: clientsFile read, found: %s entries', Object.keys(clientsList).length);
        return true;
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

        // íf dont have anything to validate the agent against then we will return true on a public serveer else false aka the value of publicserver
        if (clientHKey == null || !doWeHaveClientsList()) {
            debug('checkClientHeaderLogin: No way to auth - public server: %s', publicServer);
            return publicServer;
        }

        let clientHost = getClientHostnameFromClientsList(clientHKey);
        if (clientHost == null) {
            debug('checkClientHeaderLogin: client "%s" not found/failed. Client IP: %s, public server: %s', clientHKey, ctx.request.ip, publicServer);
            return publicServer;
        }

        debug('checkClientHeaderLogin: client "%s" approved. Client IP: %s, public server: %s', clientHKey, ctx.request.ip, publicServer);
        return true;
    }

    // API header key login check
    function apiKeyCheck(headers) {
        debug('API auth: started');
        let keyChk = null;
        // Check if the key is present
        if ('x-api-key' in headers) {
            keyChk = headers['x-api-key'];
        } else if ('authorization' in headers) {
            keyChk = headers['authorization'].replace('Bearer ', '');
        }
        if (keyChk != null && apiKey !== undefined && apiKey != '' && apiKey != 'false' && keyChk == apiKey) {
            debug('apiKeyCheck: API auth: APPROVED');
            return true;
        }
        debug('apiKeyCheck: API auth: FAILED');
        return false;
    }

    function customErrorWeb(ctx, code) {
        ctx.status = code;
        webserveFile(ctx, code + '.html');
    }

    function htmlReplacer(inputFilename){
        return fs.readFileSync(inputFilename, 'utf-8').replace(/_LOGOURL_/g,logoURL).replace(/_SITETITLE_/g,siteTitle).replace(/_FAVICONPNG_/g,favIconPng).replace(/_FAVICON_/g,favIcon);
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
            debug('webserveFile: ' + filename + ' not found on server!');
            customErrorWeb(ctx, 404);
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
        if (fileExt == 'html' || fileExt == 'htm'){
            ctx.body = htmlReplacer(filename);
        }else{
            ctx.body = fs.readFileSync(filename);
        }
    }

    // web Auth check for a user
    function authThis(authval, user, pass) {
        if (authval == '' || authval == undefined) {
            debug('authThis: no authVal/header found');
            return false;
        }
        let tmp = authval.split(' ');
        if (tmp.length <= 1) {
            debug('authThis: invalid authVal/header');
            return false;
        }
        let buf = Buffer.from(tmp[1], 'base64');
        let plaintxt = buf.toString().split(':');

        if (plaintxt[0] == user && plaintxt[1] == pass) {
            return true;
        }
        debug('authThis: pass/user did not match');
        return false;
    }

    function buildAuthRequest(ctx) {
        debug('buildAuthRequest: Auth request started');
        ctx.set('WWW-Authenticate', 'Basic realm="tunnelOut"');
        customErrorWeb(ctx, 401);
        return false;
    }

    // Admin auth
    function adminAuthCheck(ctx, promptLogin, headers = null) {
        debug('adminAuthCheck: started');
        if (ctx != null && headers == null) {
            headers = ctx.request.headers;
        }

        // No auth header - then ask for auth
        if (!('authorization' in headers)) {
            if (ctx != null && promptLogin) {
                buildAuthRequest(ctx);
            }
            debug('adminAuthCheck: missing authorization header');
            return false;
        }

        // Do we have basic auth
        if (dashboardUser === undefined || dashboardUser === false || dashboardPass === undefined || dashboardPass === false) {
            debug('adminAuthCheck: missing enviroment');
            return false;
        }

        // check admin auth
        if (authThis(headers['authorization'], dashboardUser, dashboardPass) == false) {
            if (ctx != null && promptLogin) {
                buildAuthRequest(ctx);
            }
            return false;
        }

        debug('adminAuthCheck: Admin Auth approved');
        if (ctx != null) {
            ctx.cookies.set('authType', 'admin', { expires: 0, httpOnly: false });
        }
        return true;
    }

    // Auth a basic client
    function clientAuth(client, ctx) {
        debug('clientAuth: started');

        // No auth header - then ask for auth
        if (!('authorization' in ctx.request.headers)) {
            debug('clientAuth: missing authorization header');
            buildAuthRequest(ctx);
            return false;
        }

        // Admin is always allowed - but don't prompt yet - we will try as client
        if (adminAuthCheck(ctx, false)) {
            debug('clientAuth: approved as admin');
            return true;
        }

        let authData = client.getAuthInfo();
        // Nothing to validate against
        if (authData === null) {
            debug('clientAuth: not auth data found');
            customErrorWeb(ctx, 404);
            return false;
        }

        // No auth headers sent the lets ask
        if (authThis(ctx.request.headers['authorization'], authData.usr, authData.pass) == false) {
            debug('clientAuth: Failed');
            buildAuthRequest(ctx);
            return false;
        }

        debug('clientAuth: auth approved');
        ctx.cookies.set('authType', 'client', { expires: 0, httpOnly: false });
        return true;
    }

    /* [DASHBOARD WEB UI] -------------------------------------------------------------------------------------------------------------------------------------------------------- */
    router.get('/favicon.ico', async (ctx) => {
        webserveFile(ctx, 'favicon.ico');
    });

    // dash gfx
    router.get(dashPath + '/gfx/(.*).png', async (ctx) => {
        if (!(0 in ctx.params) || ctx.params[0] == '') {
            customErrorWeb(ctx, 404);
            return;
        }
        let file = '';
        if (0 in ctx.params && ctx.params[0] != '') {
            file = ctx.params[0] + '.png';
        }
        // debug('Web - dash gfx: %s', file);
        webserveFile(ctx, file);
    });

    // client dashboard
    router.get(dashPath + '/c/:clientid/(.*)', async (ctx) => {
        // Lookup the client id
        const client = manager.getClient(ctx.params.clientid);

        // Failed to find the client - not connected the we fail
        if (!client) {
            debug('client Dash: ' + ctx.params.clientid + ' not found!');
            customErrorWeb(ctx, 404);
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
        debug('Web - client Dash: %s', file);
        webserveFile(ctx, file);
    });

    // redirect to client dashboard if just requesting /dash/c/xxxxx without trailing slash
    router.get(dashPath + '/c/(.*)', async (ctx) => {
        if (!(0 in ctx.params) || ctx.params[0] == '') {
            debug('client Dash: No client requested!');
            customErrorWeb(ctx, 404);
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
        debug('Web - admin Dash: %s', file);
        webserveFile(ctx, file);
    });

    /* [CLIENTS API ENDPOINT] ------------------------------------------------------------------------------------------------------------------------------------------------------- */

    // Reload the client file
    router.get('/api/clients/reload', async (ctx) => {
        debug('API clients reload');
        if (!doWeHaveClientsList()) {
            customErrorWeb(ctx, 404);
            return;
        }

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx.request.headers) && !adminAuthCheck(ctx, true)) {
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

    // get the clients file
    router.get('/api/clients/', async (ctx) => {
        debug('API clients get');
        if (!doWeHaveClientsList()) {
            customErrorWeb(ctx, 404);
            return;
        }

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx.request.headers) && !adminAuthCheck(ctx, true)) {
            return;
        }

        // Load the clients list
        loadClients();

        ctx.body = clientsList;
    });

    // Add client
    router.post('/api/clients/:client', async (ctx) => {
        debug('API clients add/update: %s', ctx.params.client);
        if (!doWeHaveClientsList()) {
            customErrorWeb(ctx, 404);
            return;
        }

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx.request.headers) && !adminAuthCheck(ctx, true)) {
            return;
        }
        const clientID = path.basename(ctx.params.client);

        loadClients();
        let bClientAdded = false;
        if (Array.isArray(clientsList)) {
            clientsList.push(clientID);
        } else {
            if (apiBody == null || typeof apiBody != 'object' || Object.keys(apiBody).length === 0 || !Object.prototype.hasOwnProperty.call(apiBody, 'secret') || apiBody.secret == '') {
                debug('Invalid api body');
                ctx.status = 404;
                ctx.body = { errorMsg: 'Invalid JSON data' };
                return;
            }

            var curSecret = apiBody.secret;
            delete apiBody.secret;

            let inputOk = true;
            // search for hostname and handle conflicts if any
            Object.keys(clientsList).forEach(function (cKey) {
                // Another client with that hostname and not the same secret/unique key
                if (clientsList[cKey].hostname == ctx.params.client && cKey != curSecret) {
                    debug('Conflict - hostname(%s) reserved by another client!', ctx.params.client);
                    ctx.status = 409;
                    ctx.body = { errorMsg: 'Conflict - hostname reserved by another client!' };
                    inputOk = false;
                    return false;
                }
            });

            // New secret requested
            if (Object.prototype.hasOwnProperty.call(apiBody, 'newsecret')) {
                if (apiBody.newsecret != '' && apiBody.newsecret != curSecret) {
                    if (apiBody.newsecret in clientsList) {
                        debug('Conflict - secret used by another client!');
                        ctx.status = 409;
                        ctx.body = { errorMsg: 'Conflict -  - secret used by another client!' };
                        inputOk = false;
                        return false;
                    }
                    // Delete the old one
                    delete clientsList[curSecret];
                    // Assign the new one
                    curSecret = apiBody.newsecret;
                }
                // Delete new secret
                delete apiBody.newsecret;
            }
            // Ok to continue
            if (!inputOk) {
                return;
            }

            debug('Got a JSON body');
            debug(apiBody);
            // Assign the advanced way
            apiBody['hostname'] = clientID;
            clientsList[curSecret] = apiBody;
        }
        writeClients();
        ctx.body = { status: 'Client "' + clientID + '" addedd' };
        debug('API clients added: %s', clientID);
        debug(ctx.body);
    });

    // delete client
    router.delete('/api/clients/:clientid', async (ctx) => {
        debug('API clients delete: %s', ctx.params.clientid);
        if (!doWeHaveClientsList()) {
            customErrorWeb(ctx, 404);
            return;
        }

        const clientid = path.basename(ctx.params.clientid);
        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx.request.headers) && !adminAuthCheck(ctx, true)) {
            return;
        }

        loadClients();
        let found = false;

        if (Array.isArray(clientsList) && clientsList.includes(clientid)) {
            delete clientsList[clientid];
            found = true;
        } else {
            Object.keys(clientsList).forEach(function (cKey) {
                // Another client with that hostname and not the same secret/unique key
                if (clientsList[cKey].hostname == clientid) {
                    delete clientsList[cKey];
                    found = true;
                    return;
                }
            });
        }
        if (!found) {
            customErrorWeb(ctx, 404);
            return;
        }

        // Disconnect the user
        const client = manager.getClient(clientid);
        if (client) {
            manager.disconnect(clientid);
        }
        writeClients();
        ctx.body = { status: 'Client "' + clientid + '" deleted' };
        debug(ctx.body);
    });

    /* [DASHBOARD/STATUS API ENDPOINTS] ---------------------------------------------------------------------------------------------------------------------------------------------------- */
    // Main status api
    router.get('/api/status', async (ctx) => {
        debug('API status called');
        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx.request.headers) && !adminAuthCheck(ctx, true)) {
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
        let optBack = {};
        Object.keys(opt).forEach(function (key) {
            if (key != 'apikey' && key != 'dashboardPass') {
                optBack[key] = opt[key];
            }
        });

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
                arguments: optBack
            },
            packinfo: packageInfo
        };
    });

    // Get a tunnels status
    router.get('/api/tunnels/:id', async (ctx) => {
        // Lookup the client info
        const clientID = ctx.params.id;
        debug('API tunnel status: %s', clientID);
        const client = manager.getClient(clientID);
        // Client not found
        if (!client) {
            customErrorWeb(ctx, 404);
            return;
        }

        // Try api and user/admin login
        if (!apiKeyCheck(ctx.request.headers) && !clientAuth(client, ctx)) {
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
        const clientID = ctx.params.id;
        debug('API tunnel disconnect: %s', clientID);
        const client = manager.getClient(clientID);
        // Client not found
        if (!client) {
            customErrorWeb(ctx, 404);
            return;
        }

        // Try api and user/admin login
        if (!apiKeyCheck(ctx.request.headers) && !clientAuth(client, ctx)) {
            return false;
        }

        manager.disconnect(clientID);
        ctx.body = { status: 'Client "' + clientID + '" disconnected' };
        debug(ctx.body);
    });

    router.get('/api(.*)', async (ctx) => {
        debug('Invalid API endpoint');
        customErrorWeb(ctx, 404);
        return;
    });

    /* [ERROR HANDLER/WRAPPER] --------------------------------------------------------------------------------------------------------------------------------------------------- */
    app.use(async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            if (401 == err.status) {
                ctx.set('WWW-Authenticate', 'Basic');
                customErrorWeb(ctx, 401);
            } else if (404 == err.status) {
                customErrorWeb(ctx, 404);
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
        // Skip if forbidden
        if (ctx.status == 403) {
            await next();
            return;
        }

        // Old style domain requests
        const reqpath = ctx.request.path;
        const parts = reqpath.split('/');

        // Did we request a new endpoint or not
        if ((ctx.query['new'] == undefined && reqpath === '/') || parts.length !== 2 || parts[1] == 'favicon.ico' || parts[1] == 'robots.txt') {
            // no new client request, send to landing page
            debug('New endpoint: Non handled request');
            if (landingPage != undefined) {
                ctx.redirect(landingPage);
                return;
            }
            customErrorWeb(ctx, 404);
            return;
        }

        // Validate client agent
        let clientAgent = 'unknown';
        if ('user-agent' in ctx.request.headers) {
            clientAgent = ctx.request.headers['user-agent'];
        }

        if (clientAgentValid !== false && clientAgent.indexOf(clientAgentValid) !== 0) {
            debug('New endpoint: Invalid agent %s != %s', clientAgent, clientAgentValid);
            ctx.status = 307;
            ctx.set('location', landingPage);
            ctx.body = { errorMsg: 'Invalid client agent: ' + clientAgent };
            return;
        }

        // Check against client list and headers + public server or not
        if (!checkClientHeaderLogin(ctx)) {
            ctx.status = 403;
            ctx.body = { errorMsg: 'Invalid or missing x-client-key header' };
            return;
        }

        let reqHostname = null;
        let clientReqHostName = null;
        let cKey = null;
        if ('x-client-key' in ctx.request.headers && ctx.request.headers['x-client-key'] != undefined) {
            clientReqHostName = getClientHostnameFromClientsList(ctx.request.headers['x-client-key']);
            if (clientReqHostName != null) {
                cKey = ctx.request.headers['x-client-key'];
                debug('New endpoint: new school request for %s', clientReqHostName);
            }
        }

        // classic methods first
        if (reqpath !== '/') {
            reqHostname = parts[1];
            debug('New endpoint: old school request for %s', reqHostname);
            // limit requested hostnames to 63 characters
            if (!/^(?:[a-z0-9][a-z0-9-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(reqHostname)) {
                debug('New endpoint: Invalid subdomain requested, "%s"', reqHostname);
                ctx.status = 403;
                ctx.body = {
                    errorMsg: 'Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.'
                };
                return;
            }

            // Do we allow the user to override the hostnames from the file
            if (clientOverride === false) {
                if (clientReqHostName !== null && reqHostname != clientReqHostName) {
                    debug('New endpoint: Client requested "%s" - but we dont allow override, so serving "%s"', reqHostname, clientReqHostName);
                    reqHostname = clientReqHostName;
                }
            }
        }

        // Anything found
        if (reqHostname == null) {
            if (clientReqHostName != null) {
                reqHostname = clientReqHostName;
            } else {
                reqHostname = hri.random();
            }
        }

        // forbidden hostname
        if (reqHostname.toLowerCase() == 'api') {
            ctx.status = 403;
            ctx.body = { errorMsg: '"api" is not allowed as hostname' };
            return;
        }

        // do we already have a client with the requested name and we don't allow other names (clientOverride) then fail - if we don't fail then the client manager will pick a random name
        if (clientReqHostName != null && manager.hasClient(reqHostname) && clientOverride === false) {
            debug('Suddomain "' + clientReqHostName + '" is already in use so we exit.');
            ctx.status = 409;
            ctx.body = { errorMsg: 'Suddomain "' + clientReqHostName + '" is already in use.' };
            return;
        }

        // keep track of connection key client key
        if (cKey != null) {
            let curNo = 0;
            var kickClient = null;
            if (cKey in clientConnectList) {
                // clean up and dead connections
                clientConnectList[cKey].forEach(function (seenCkey, indx) {
                    // Dead connection
                    if (!manager.hasClient(seenCkey)) {
                        delete clientConnectList[cKey][indx];
                    } else {
                        if (kicksameip == true && kickClient == null && manager.getClient(seenCkey).ipAdr == ctx.request.ip) {
                            kickClient = seenCkey;
                        }
                    }
                });
                // Clean the dead array indexes
                clientConnectList[cKey] = clientConnectList[cKey].filter((n) => n);
                curNo = clientConnectList[cKey].length;
            }

            // too many connections
            if (maxConsPerClient > 0 && curNo >= maxConsPerClient) {
                if (kicksameip == true && kickClient != null) {
                    debug('%s has %i active connections - max allowed is %i. We will kick the existing "%s"', cKey, curNo, maxConsPerClient, kickClient);
                    manager.disconnect(kickClient);
                } else {
                    debug('%s has %i active connections - max allowed is %i. Exiting', cKey, curNo, maxConsPerClient);
                    ctx.status = 406;
                    ctx.body = { errorMsg: 'Your client account has exhausted the maximum number of connections/tunnels: ' + maxConsPerClient };
                    return;
                }
            } else {
                debug('%s has %i active connections - max allowed is %i so we will allow one more', cKey, curNo, maxConsPerClient);
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
            debug('New endpoint: Made new client with the requested id: "%s"', info.id);
        } else {
            debug('New endpoint: Made new client with random id: "%s"', info.id);
        }

        // Add the new entry to client count list
        if (cKey != null) {
            if (cKey in clientConnectList) {
                clientConnectList[cKey].push(info.id);
            } else {
                clientConnectList[cKey] = [info.id];
            }
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
        // Should we redirect all the request to https?
        if (redirecthttp) {
            debug('http will be redirected to https');
            const redirserver = http.createServer().listen(80);
            redirserver.on('request', (req, res) => {
                res.writeHead(301, { Location: 'https://' + req.headers.host + req.url });
                res.end();
            });
        }
    }

    // Load any client if present
    loadClients();

    const appCallback = app.callback();

    // main data handling between client and server
    server.on('request', (req, res) => {
        // without a hostname, we won"t know who the request is for
        const hostname = req.headers.host;
        const clientIPadr = req.socket.remoteAddress;

        if (!hostname) {
            debug('Client(%s) request: missing host name', clientIPadr);
            res.statusCode = 400;
            res.end('Host header is required');
            return;
        }

        // main request - no need to do anymore
        if (hostname == opt.domain) {
            debug('Client(%s) request: "%s" is the main host request - redirecting to creation handler', clientIPadr, hostname);
            appCallback(req, res);
            return;
        }

        // If no client id found the send it to the other routes
        const clientId = GetClientIdFromHostname(hostname);
        if (!clientId) {
            // We need the JSON body for the client api ONLY and we dont want to include a million other modules just for this data so this is a quick and fast hack
            if (req.url.indexOf('/api/clients/') == 0 && req.method == 'POST' && req.headers['content-type'].indexOf('application/json') == 0) {
                debug('API body client POST');
                if (!doWeHaveClientsList()) {
                    res.statusCode = 404;
                    res.end(htmlReplacer(dashFolder + '404.html'));
                    return;
                }

                // Api header key is the first one - if that fails we can use the basic auth stuff
                if (!apiKeyCheck(req.headers) && !adminAuthCheck(null, false, req.headers)) {
                    appCallback(req, res);
                    return;
                }

                // Build the api body
                apiBody = '';
                req.on('data', (chunk) => {
                    apiBody += chunk;
                });

                req.on('end', () => {
                    // Now we can handle the request
                    try {
                        apiBody = JSON.parse(apiBody);
                    } catch (err) {
                        apiBody = null;
                    }
                    appCallback(req, res);
                    return;
                });
            } else {
                // debug('Client(%s) request: "%s" host not found  - redirecting to main handler', clientIPadr, hostname);
                appCallback(req, res);
            }
            return;
        }

        // Get client data/info
        const client = manager.getClient(clientId);
        if (!client) {
            debug('Client(%s) request: "%s" client not found!', clientIPadr, clientId);
            res.statusCode = 404;
            res.end(htmlReplacer(dashFolder + '404.html'));
            return;
        }

        // Basic auth needed for this client
        const authData = client.getAuthInfo();
        // Do we need to auth
        if (authData != null) {
            // Can we auth?
            if (!('authorization' in req.headers) || authThis(req.headers['authorization'], authData.usr, authData.pass) == false) {
                // Special cases for gfx
                var gfxmatch = new RegExp(dashPath + '/gfx/[\\w-]+.png');
                if (gfxmatch.test(req.url)) {
                    const segments = new URL('http:/' + req.url).pathname.split('/');
                    const last = segments.pop() || segments.pop();
                    const filename = dashFolder + path.basename(last);
                    if (fs.existsSync(filename)) {
                        res.setHeader('content-type', 'image/png');
                        res.end(fs.readFileSync(filename));
                        return;
                    }
                }
                debug('Client(%s) request: auth missing! for %s', clientIPadr, req.url);
                res.statusCode = 401;
                res.setHeader('WWW-Authenticate', 'Basic realm="tunnelOut"');
                res.end(htmlReplacer(dashFolder + '401.html'));
                return;
            }
        }
        debug('Client(%s) request: %s:%s', clientIPadr, clientId, req.url);
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
