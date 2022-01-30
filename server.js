/*
 TODO:
    change all names from local tunnel
    make env. variables prefixed aka LT_ or similar
    options to force usage of users file = x-user-key in hosting
    Better post options for user / include body
    remove old way of requesting new tunnel - simplified

    seperate routes in to "modules" with web dashboard, api, auth

    cleanup of modules

    tunnelclient:
        local https problems

 */
import Koa from "koa";
import tldjs from "tldjs";
import Debug from "debug";
import http from "http";
import { hri } from "human-readable-ids";
import Router from "koa-router";

import https from "https"
import fs from "fs"

import ClientManager from "./lib/ClientManager.js";

const debug = Debug("localtunnel:server");
const path = require("path");
const os = require("os");

export default function (opt) {
    opt = opt || {};

    const validHosts = (opt.domain) ? [opt.domain] : undefined;
    const myTldjs = tldjs.fromUserSettings({ validHosts });
    const landingPage = opt.landing || "https://example.com";
    const schema = opt.secure ? "https" : "http";

    const dashPath = "/dashboard";
    const dashFolder = __dirname + "/dashboard/";

    const manager = new ClientManager(opt);
    const app = new Koa();
    const router = new Router();
    let UsersList = {};


    /* [USER LOGIN RELATED] ------------------------------------------------------------------------------------------------------------------------------------------------------ */

    // Lookup a hostname based on the client id
    function GetClientIdFromHostname(hostname) {
        const hostsplit = hostname.split(":");
        return myTldjs.getSubdomain(hostsplit[0]);
    }

    function doWeHaveUsersEnv() {
        if (process.env.USERSFILE !== undefined && process.env.USERSFILE != "") {
            return true;
        }
        return false;
    }

    // Get a users hostname from the users file
    function getUserHostName(ctx) {
        if (doWeHaveUsersEnv() && ctx.request.headers["x-user-key"] !== undefined) {
            const usrid = ctx.request.headers["x-user-key"];
            if (Object.prototype.hasOwnProperty.call(UsersList, usrid)) {
                return UsersList[usrid];
            }
        }
        return null;
    }

    // Reload users from the users.json file
    function loadUsers() {
        // Get users
        if (doWeHaveUsersEnv()) {
            // Do we have the file
            if (!fs.existsSync(process.env.USERSFILE)) {
                console.error("\"%s\" file not found", process.env.USERSFILE);
                process.exit(1);
                return false
            }
            //try read the file
            try {
                let data = fs.readFileSync(process.env.USERSFILE);
                UsersList = JSON.parse(data);
            } catch (err) {
                console.error("Unable to read/parse the users file");
                process.exit(1);
                return false;
            }
            debug("Userlist read, found: %s entries", Object.keys(UsersList).length);
        }
    }

    // write uses to the users.json file
    function writeUsers() {
        let data = JSON.stringify(UsersList, null, 2);
        fs.writeFile(process.env.USERSFILE, data, (err) => {
            if (err) throw err;
        });
    }

    // Check if a user allowed to request a tunnel
    function checkUserHeaderLogin(ctx) {
        if (!doWeHaveUsersEnv()) {
            return false;
        }

        // Do we have the user header
        if (!("x-user-key" in ctx.request.headers) || ctx.request.headers["x-user-key"] === undefined) {
            debug("x-user-key header is missing!");
            return false;
        }

        const usrid = ctx.request.headers["x-user-key"];
        // Do we have a user list - if not lets load it
        if (!Object.keys(UsersList).length) {
            loadUsers();
        }

        // Did we find the user
        if (Object.prototype.hasOwnProperty.call(UsersList, usrid) || (Array.isArray(UsersList) && UsersList.includes(usrid))) {
            debug("Client approved - success, Client IP: %s", ctx.request.ip);
            return true;
        }

        debug("Client \"%s\" not found - failure, Client IP: %s", usrid, ctx.request.ip);
        return false;
    }


    // API header key login check
    function apiKeyCheck(ctx) {
        debug("API auth: started");
        let keyChk = null;
        // Check if the key is present
        if ("x-api-key" in ctx.request.headers) {
            keyChk = ctx.request.headers["x-api-key"];
        } else if ("authorization" in ctx.request.headers) {
            keyChk = ctx.request.headers["authorization"].replace("Bearer ", "");
        }
        if (keyChk != null && process.env.API_KEY !== undefined && process.env.API_KEY != "" && process.env.API_KEY != "false" && keyChk == process.env.API_KEY) {
            debug("API auth: APPROVED");
            return true
        }
        debug("API auth: FAILED");
        return false;
    }


    /* [WEB DASHBOARD] ----------------------------------------------------------------------------------------------------------------------------------------------------------- */

    /* basic webserver*/
    function webserveFile(ctx, filename) {
        if (filename == "" || filename == "/") {
            filename = "index.html";
        }
        filename = dashFolder + path.basename(filename);

        // Do we have the file requested?
        if (!fs.existsSync(filename)) {
            debug(filename + " not found on server!");
            ctx.throw(404);
            return;
        }

        const mimeTypes = {
            "gif": "image/gif",
            "jpeg": "image/jpeg",
            "jpg": "image/jpeg",
            "jpe": "image/jpeg",
            "png": "image/png",
            "css": "text/css",
            "js": "text/javascript",
            "json": "application/json",
        };

        let fileExt = filename.split(".").pop().toLowerCase();
        let mimetype = "text/html";
        if (Object.prototype.hasOwnProperty.call(mimeTypes, fileExt)) {
            mimetype = mimeTypes[fileExt];
        }
        ctx.set("content-type", mimetype);
        ctx.body = fs.readFileSync(filename);

    }

    // web Auth check for a user
    function authThis(authval, user, pass) {
        if (authval == "" || authval == undefined) {
            return false;
        }
        let tmp = authval.split(" ");
        if (tmp.length <= 1) {
            return false;
        }
        let buf = Buffer.from(tmp[1], "base64");
        let plaintxt = buf.toString().split(":");

        if ((plaintxt[0] == user) && (plaintxt[1] == pass)) {
            return true;
        }
        return false;
    }

    function buildAuthRequest(ctx) {
        debug("Auth request started");
        ctx.throw(401, "Unauthorized ");
        ctx.set("WWW-Authenticate", "Basic realm=\"localtunnel\"");
        return false;
    }

    // Admin auth
    function adminAuthCheck(ctx, promptLogin) {
        debug("Admin AUTH: started");

        // No auth header - then ask for auth
        if (!("authorization" in ctx.request.headers)) {
            if (promptLogin) {
                buildAuthRequest(ctx);
            }
            return false;
        }

        // Do we have basic auth
        if (process.env.ADMIN_AUTH === undefined || process.env.ADMIN_AUTH === "false") {
            debug("Admin AUTH: missing enviroment");
            return false;
        }

        // Lookup auth info
        let authIDs = process.env.ADMIN_AUTH.split(":");
        if (authIDs.length != 2) {
            console.error("Bad configuration of API_BASICAUTH: \"%s\"", process.env.ADMIN_AUTH);
            process.exit(1);
            return false;
        }

        // check admin auth
        if (authThis(ctx.request.headers["authorization"], authIDs[0], authIDs[1]) == false) {
            debug("Admin AUTH: failed");
            if (promptLogin) {
                buildAuthRequest(ctx);
            }
            return false;
        }

        debug("Admin Auth approved");
        ctx.cookies.set("authType", "admin", { expires: 0, httpOnly: false });
        return true;
    }

    // Auth a basic client
    function clientAuth(client, ctx) {
        debug("Client AUTH: started");

        // No auth header - then ask for auth
        if (!("authorization" in ctx.request.headers)) {
            buildAuthRequest(ctx);
            return false;
        }

        // Admin is always allowed - but don't prompt yet - we will try as user
        if (adminAuthCheck(ctx, false)) {
            debug("Client AUTH: approved as admin");
            return true;
        }

        let authData = client.getAuthInfo();
        // Nothing to validate against
        if (authData === null) {
            debug("Client AUTH: No auth data found");
            ctx.throw(409);
            return false;
        }

        // No auth headers sent the lets ask
        if (authThis(ctx.request.headers["authorization"], authData.usr, authData.pass) == false) {
            debug("Client AUTH: Failed");
            buildAuthRequest(ctx);
            return false;
        }

        debug("Client AUTH: auth approved");
        ctx.cookies.set("authType", "user", { expires: 0, httpOnly: false });
        return true;
    }



    /* [DASHBOARD WEB UI] -------------------------------------------------------------------------------------------------------------------------------------------------------- */

    // client dashboard
    router.get(dashPath + "/c/:clientid/(.*)", async (ctx) => {
        // Lookup the client id
        const client = manager.getClient(ctx.params.clientid);

        // Failed to find the client - not connected the we fail
        if (!client) {
            debug(ctx.params.clientid + " not found!");
            ctx.throw(404);
            return;
        }

        // Try user auth (and admin auth)
        if (!clientAuth(client, ctx)) {
            return;
        }

        let file = "";
        if (0 in ctx.params && ctx.params[0] != "") {
            file = ctx.params[0];
        }
        webserveFile(ctx, file);
    })

    // redirect to client dashboard if just requesting /dash/c/xxxxx without trailing slash
    router.get(dashPath + "/c/(.*)", async (ctx) => {
        if (!(0 in ctx.params) || ctx.params[0] == "") {
            debug("No client requested!");
            ctx.throw(404);
            return;
        }
        // Redirect with a trailing slash
        ctx.status = 301;
        ctx.redirect(dashPath + "/c/" + ctx.params[0] + "/");
    })

    // admin/main dashboard
    router.get(dashPath + "(.*)", async (ctx) => {
        if (!adminAuthCheck(ctx, true)) {
            return;
        }
        // redirect to add trailing slash to the url
        if (!(0 in ctx.params) || ctx.params[0] == "") {
            ctx.status = 301;
            ctx.redirect(dashPath + "/");
            return
        }
        let file = "";
        if (0 in ctx.params && ctx.params[0] != "") {
            file = ctx.params[0];
        }
        webserveFile(ctx, file);
    })

    /* [USER API ENDPOINT] ------------------------------------------------------------------------------------------------------------------------------------------------------- */

    // Reload the users file
    router.get("/api/users/reload", async (ctx) => {
        // Do we have a users file?
        if (!doWeHaveUsersEnv()) {
            ctx.throw(404);
            return;
        }

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx) && !adminAuthCheck(ctx, true)) {
            return;
        }

        let prevUsers = Object.keys(UsersList).length;

        // Load the users list
        loadUsers();

        ctx.body = {
            noUsers: Object.keys(UsersList).length,
            PrevNoUsers: prevUsers
        };
    });


    // Add users
    router.post("/api/users/:user", async (ctx) => {
        // Do we have users
        if (!doWeHaveUsersEnv()) {
            ctx.throw(404);
            return;
        }

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx) && !adminAuthCheck(ctx, true)) {
            return;
        }

        const userID = path.basename(ctx.params.user);

        // Load the users list
        loadUsers();

        // Simple user list or full
        let bUserAdded = false;
        if (Array.isArray(UsersList)) {
            UsersList.push(userID);
            bUserAdded = true;
        } else if ("x-secret" in ctx.request.headers && ctx.request.headers["x-secret"] !== undefined && ctx.request.headers["x-secret"] != "") {
            UsersList[userID] = ctx.request.headers["x-secret"];
            bUserAdded = true;
        }
        if (bUserAdded) {
            writeUsers();
            ctx.body = "User \"" + userID + "\" addedd";
        } else {
            ctx.throw(403, "Bad Request");
            ctx.body = "User \"" + userID + "\" NOT addedd";
        }
        debug(ctx.body);
    });

    // delete users
    router.delete("/api/users/:user", async (ctx) => {
        // Do we have users
        if (!doWeHaveUsersEnv()) {
            ctx.throw(404);
            return;
        }

        const userID = path.basename(ctx.params.user);

        // Api header key is the first one - if that fails we can use the basic auth stuff
        if (!apiKeyCheck(ctx) && !adminAuthCheck(ctx, true)) {
            return;
        }

        // Load the users list
        loadUsers();

        // Delete user
        if (Object.prototype.hasOwnProperty.call(UsersList, userID) || (Array.isArray(UsersList) && UsersList.includes(userID))) {
            delete UsersList[userID];
        }
        writeUsers();
        ctx.body = "User \"" + userID + "\" deleted";
        debug(ctx.body);
    });


    /* [STATUS API ENDPOINTS] ---------------------------------------------------------------------------------------------------------------------------------------------------- */
    // Main status api
    router.get("/api/status", async (ctx) => {
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

        let availMem = Math.floor((os.freemem() / 1024) / 1024) + " MB";
        // Fix for avail mem on unix
        if (os.platform() == "linux") {
            availMem = Math.floor(Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8"))[1]) / 1024) + " MB";
        }

        // Build clients
        Object.keys(clients).forEach(function (key) {
            returnClients[key] = { "ip_adr": clients[key].ipAdr };
        });


        // Params data quick handler
        let inst = process.argv.slice(2);
        let keyVal = "";
        let paramsList = {};
        Object.keys(inst).forEach(function (key) {
            if (inst[key][0] == "-") {
                if (keyVal != "") {
                    paramsList[keyVal] = true;
                }
                keyVal = inst[key];
            } else {
                if (keyVal != "") {
                    paramsList[keyVal] = inst[key];
                    keyVal = "";
                }
            }
        });
        // add last params
        if (keyVal != "") {
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
                pid: process.pid,
            },
            os: {
                cpus: os.cpus().length,
                free_mem: availMem,
                total_mem: Math.floor((os.totalmem() / 1024) / 1024) + " MB",
                uptime: os.uptime(),
                hostname: os.hostname(),
                load_avg: loadavgres,
                platform: os.platform(),
                version: os.release(),
            },
            configuration: {
                valid_hosts: validHosts,
                landing_page: landingPage,
                schema: schema,
                arguments: paramsList,
            }
        };
    });

    // Get a tunnels status
    router.get("/api/tunnels/:id", async (ctx) => {

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
                ip_adr: client.ipAdr,
                auth: (client.authpass !== null && client.authusr !== null),
                secure: client.agent.secure,
                closed: client.agent.closed,
                keep_alive: client.agent.keepAlive,
                keep_alive_ms: client.agent.keepAliveMsecs,
            },
            stats: client.stats(),
        }
    });

    // Disconnect user users
    router.delete("/api/tunnels/:id", async (ctx) => {
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
        ctx.body = "Client \"" + clientId + "\" disconnected";
        debug(ctx.body);
    });



    // Error handler
    app.use(async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            if (401 == err.status) {
                ctx.status = 401;
                ctx.set("WWW-Authenticate", "Basic");
                webserveFile(ctx, "401.html")
            } else if (404 == err.status) {
                ctx.status = 404;
                webserveFile(ctx, "404.html")
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
        const parts = reqpath.split("/");

        // Skip if forbidden
        if (ctx.status == 403) {
            await next();
            return;
        }

        // Did we request a new endpoint or not
        if ((ctx.query["new"] == undefined && reqpath === "/") || (parts.length !== 2 || parts[1] == "favicon.ico" || parts[1] == "robots.txt")) {
            // no new client request, send to landing page
            ctx.redirect(landingPage);
            return;
        }

        // Check against users table - we allow it to be blank
        // todo: param to skip this
        if (!checkUserHeaderLogin(ctx)) {
            ctx.throw(403, "Forbidden");
            await next();
            return;
        }

        let reqID = null;

        // classic methods first
        if (reqpath !== "/") {
            const parts = reqpath.split("/");
            if (parts.length !== 2 || parts[1] == "favicon.ico") {
                await next();
                return;
            }

            reqID = parts[1];
            // limit requested hostnames to 63 characters
            if (!/^(?:[a-z0-9][a-z0-9-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(reqID)) {
                debug("Invalid subdomain requested, \"%s\"", reqID);
                const msg = "Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.";
                ctx.status = 403;
                ctx.body = {
                    message: msg,
                };
                return;
            }

            // Do we allow the user to override the hostnames from the file
            if (process.env.ALLOWUSRHOSTOVERRIDE === "false") {
                let userHN = getUserHostName(ctx);
                if (userHN !== null && reqID != userHN) {
                    debug("Client requested \"%s\" - but we dont allow override, so serving \"%s\"", reqID, userHN);
                    reqID = userHN;
                }
            }
        } else {
            // Getting a new random one or should we use the fixed from the users file
            reqID = getUserHostName(ctx);
            if (reqID == null) {
                reqID = hri.random();
            }
        }

        // Set basic auth if requested to do so
        let authUser = null;
        let authPass = null;
        let authSet = false;
        if ("x-authuser" in ctx.request.headers && ctx.request.headers["x-authuser"] != "" && "x-authpass" in ctx.request.headers && ctx.request.headers["x-authpass"]) {
            authUser = ctx.request.headers["x-authuser"];
            authPass = ctx.request.headers["x-authpass"];
            authSet = true;
        }

        // Create the client
        const info = await manager.newClient(reqID, authUser, authPass, ctx.request.ip);

        // Status
        if (reqID == info.id) {
            debug("Made new client with requested id \"%s\"", info.id);
        } else {
            debug("Made new random client with id \"%s\"", info.id);
        }

        // Set return payload
        const url = schema + "://" + info.id + "." + ctx.request.host;
        info.url = url;
        if (authSet) {
            info.dashboard = schema + "://" + ctx.request.host + dashPath + "/c/" + info.id + "/";
        } else {
            info.dashboard = false;
        }
        ctx.body = info;
    });


    /* [START TUNNEL AND HANDLE ALL REQUESTS]   ------------------------------------------------------------------------------------------------------------------------------------ */
    // Start the server
    let server;
    if (opt.secure) {
        // Do we have the file to run a secure setup?
        if (!fs.existsSync(process.env.SSL_KEY) || !fs.existsSync(process.env.SSL_CERT)) {
            console.error("Bad or missing cert files");
            process.exit(1);
        }
        debug("Running secure server, https, using %s , %s", process.env.SSL_KEY, process.env.SSL_CERT);
        server = https.createServer({
            key: fs.readFileSync(process.env.SSL_KEY, "ascii"),
            cert: fs.readFileSync(process.env.SSL_CERT, "ascii")
        });
    } else {
        server = http.createServer();
        debug("Running insecure server, http");
    }

    // Load any users if present
    loadUsers();

    const appCallback = app.callback();

    // main data handling between client and server
    server.on("request", (req, res) => {
        // without a hostname, we won"t know who the request is for
        const hostname = req.headers.host;
        if (!hostname) {
            res.statusCode = 400;
            res.end("Host header is required");
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
            res.end("404");
            return;
        }

        // Basic auth needed for this client
        const authData = client.getAuthInfo();
        // Do we need to auth
        if (authData != null) {
            // Can we auth?
            if (!("authorization" in req.headers) || authThis(req.headers["authorization"], authData.usr, authData.pass) == false) {
                res.statusCode = 401;
                res.setHeader("WWW-Authenticate", "Basic realm=\"localtunnel\"");
                res.end(fs.readFileSync(dashFolder + "401.html"));
                return;
            }
        }
        client.handleRequest(req, res);
    });

    server.on("upgrade", (req, socket) => {
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