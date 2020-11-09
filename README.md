# localtunnel-server
**NOTE** This is my WIP on an improved version of tunnel-server based on: https://github.com/cloudatlasid/tunnel-server/ 
This version includes the following improvements:
- Support for basic auth on the tunnel/client site
- Dashboard view for admins and users
- Basic auth and header auth for apis
- A users.json file making it possible to control who is allowed to connect to the server

localtunnel exposes your localhost to the world for easy testing and sharing! No need to mess with DNS or deploy just to have others test out your changes.

This repo is the server component. If you are just looking for the CLI localtunnel app, see (https://github.com/localtunnel/localtunnel).

## Overview ##

The default localtunnel client connects to the `localtunnel.me` server. You can, however, easily set up and run your own server. In order to run your own localtunnel server you must ensure that your server can meet the following requirements:

* You can set up DNS entries for your `domain.tld` and `*.domain.tld` (or `sub.domain.tld` and `*.sub.domain.tld`).
* The server can accept incoming TCP connections for any non-root TCP port (i.e. ports over 1000).

The above are important as the client will ask the server for a subdomain under a particular domain. The server will listen on any OS-assigned TCP port for client connections.

#### Setup

```shell
# pick a place where the files will live
git clone git://github.com/LazeMSS/tunnel-server.git
cd tunnel-server
npm install

# server set to run on port 1234
sudo ./startserver.sh --port 1234 --domain example.tld --secure --landing "https://yourwebpage.com"
```

The localtunnel server is now running and waiting for client requests on port 1234. You will most likely want to set up a reverse proxy to listen on port 80 (or start localtunnel on port 80 directly).

**NOTE** By default, localtunnel will use subdomains for clients, if you plan to host your localtunnel server itself on a subdomain you will need to use the _--domain_ option and specify the domain name behind which you are hosting localtunnel. (i.e. my-localtunnel-server.example.com)

#### Use your server from a client

You can now use your domain with the `--host` flag for the `lt` client.

```shell
lt --host http://example.tld:1234 --port 9000
```

You will be assigned a URL similar to `heavy-puma-9.example.tld:1234`.

If your server is acting as a reverse proxy (i.e. nginx) and is able to listen on port 80, then you do not need the `:1234` part of the hostname for the `lt` client.

## Parameters

#### --secure
Set this parameter to run the server as a secure server - you will need to provide the path to the certificates using the [.env file](#env-file) 

#### --port
Set the port that the tunnel-server will be listing for connects from the localtunnel clients(lt), this is also the port all webpages will be served on. Setting this to 443 will secure the flows. Remeber to use the same port on the lt client by specifying the port name after the webserver-address of your localtunnel server ie: https://example.com:PORTNUMBER

#### --address
The address the localtunnel server should bind to - this is normally not something you need to change

#### --domain
Specify the base domain name. This is optional if hosting localtunnel from a regular example.com domain. This is required if hosting a localtunnel server from a subdomain (i.e. lt.example.dom where clients will be client-app.lt.example.come)

#### --max-sockets
Maximum number of tcp sockets each client is allowed to establish at one time (number of tunnels)

#### --landing
The landing page for redirect from root domain - if a user enters the "root" domain your running localtunnel server on.

## .env file
The .env file resides inside the same folder as localtunnel files and contains a couple of parameters that is normally "fixed". These should be edited if you need to enable the user security features and serve the content using a proper secure https connection..

#### DEBUG=localtunnel*
Just leave it :)

#### SSL_KEY=/etc/letsencrypt/live/example.tld/privkey.pem
#### SSL_CERT=/etc/letsencrypt/live/example.tld/fullchain.pem
Where are the certificates for your domain stored - change them to the real path. In this example we are assuming letsencrypt is used.

#### API_KEY=SECRETAPIKEYHERE
If this is set then the REST APIs are "secured" by always demanding this keys is sent in the header as "x-api-key: SECRETAPIKEYHERE". This way the public API is a bit shielded from prying eyes.

#### ADMIN_AUTH=user:pass
Set the admin user and password for using the api/dashboard - if set to false its disabled

#### USERSFILE=users.json
**WIP: This requires a special version of the lt client**
If this parameter is set then this file is used for checking if the user is allowed to connect. The fileformat is really simple at the moment it's just a simple json file and the key is looked up. Look into [users.json](./users.json) for an example file. The format of the users.json file can be in either an object with a key and value pair of userkey:hostname or just an array of userkeys.

#### ALLOWUSRHOSTOVERRIDE=false
If this flags is set to true it tells the server that the client is allowed to overwrite any hostname stored in the [users.json](./users.json) file

## REST API

### GET /api/tunnels

Create a new tunnel. A LocalTunnel client posts to this enpoint to request a new tunnel with a specific name or a randomly assigned name.

### GET /api/status

General server information.

### GET /api/reloadUsers

Reload all users from the USERSFILE file

### POST /api/user/USERNAME

Add/Update a user to the USERSFILE file

### DELETE /api/user/USERNAME

Delete a user from USERSFILE file


### API security
Se the [API_KEY=SECRETAPIKEYHERE](#api_keysecretapikeyhere) on how to configure this. Heres an example on how to request the API when the secret is enabled:
```shell
curl -i -H "x-api-key: SECRETAPIKEYHERE" https://example.tld/api/status
```

## Dashboard - WIP
The dashboard is a small website deployed on the main host on your site plus /dashboard/, ie. https://example.tld/dashboard/
It can also be used per client be visiting: https://example.tld/dashboard/c/CLIENTNAME

## Deploy

You can deploy your own localtunnel server using the prebuilt docker image.

**Note** This assumes that you have a proxy in front of the server to handle the http(s) requests and forward them to the localtunnel server on port 3000. You can use our [localtunnel-nginx](https://github.com/localtunnel/nginx) to accomplish this.

If you do not want ssl support for your own tunnel (not recommended), then you can just run the below with `--port 80` instead.

```
docker run -d \
    --restart always \
    --name localtunnel \
    --net host \
    defunctzombie/localtunnel-server:latest --port 3000
```
