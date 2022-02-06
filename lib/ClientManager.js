import { hri } from 'human-readable-ids';
import Debug from 'debug';

import Client from './Client.js';
import TunnelAgent from './TunnelAgent.js';

// Manage sets of clients
//
// A client is a "user/client session" established to service a remote tunnelOut client
class ClientManager {
    constructor(opt) {
        this.opt = opt || {};
        /*
        'maxSockets' : opt.maxSockets,
        'secure' : !insecure,
        'keyFile': keyFile,
        'certFile' : certFile
        */

        // id -> client instance
        this.clients = new Map();

        // statistics
        this.stats = {
            tunnels: 0
        };

        this.debug = Debug('lt:ClientManager');

        // This is totally wrong :facepalm: this needs to be per-client...
        this.graceTimeout = null;
    }

    // create a new tunnel with `id`
    // if the id is already used, a random id is assigned
    // if the tunnel could not be created, throws an error
    async newClient(id, authusr = null, authpass = null, ipAdr = null, agentName = null) {
        const clients = this.clients;
        const stats = this.stats;

        // can't ask for id already is use
        if (clients[id]) {
            id = hri.random();
        }

        const agentOpts = this.opt;
        //Assign the client id to the main options
        agentOpts['clientId'] = id;

        this.debug('Creating new TunnelAgent, id:%s, maxSockets: %s, secure: %s', id, this.opt.maxSockets, this.opt.secure);
        const agent = new TunnelAgent(agentOpts);

        this.debug('Creating new client, id:%s, authusr: %s, ip adr: %s, agent: %s', id, authusr, ipAdr, agentName);
        const client = new Client({
            id,
            agent,
            authusr,
            authpass,
            ipAdr,
            agentName
        });

        // add to clients map immediately
        // avoiding races with other clients requesting same id
        clients[id] = client;

        client.once('close', () => {
            this.removeClient(id);
        });

        // try/catch used here to remove client id
        try {
            const info = await agent.listen();
            ++stats.tunnels;
            return {
                id: id,
                port: info.port,
                max_conn_count: this.opt.maxSockets
            };
        } catch (err) {
            this.removeClient(id);
            // rethrow error for upstream to handle
            throw err;
        }
    }

    removeClient(id) {
        this.debug('removing client: %s', id);
        const client = this.clients[id];
        if (!client) {
            return;
        }
        --this.stats.tunnels;
        delete this.clients[id];
        client.close();
    }

    disconnect(id) {
        this.debug('disconnect client: %s', id);
        const client = this.clients[id];
        if (!client) {
            return;
        }
        client.close();
    }

    hasClient(id) {
        return !!this.clients[id];
    }

    getClient(id) {
        return this.clients[id];
    }
}

export default ClientManager;
