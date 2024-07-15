'use strict';

const RPC = require('@hyperswarm/rpc');
const DHT = require('hyperdht');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const crypto = require('crypto');

class AuctionServer {
  constructor() {
  }

  async init() {
    const hcore = new Hypercore('./db/rpc-server');
    this.hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'json' });
    await this.hbee.ready();

    const  dhtSeed = crypto.randomBytes(32);
    const dht = new DHT({
      port: 40001,
      keyPair: DHT.keyPair(dhtSeed),
      bootstrap: [{ host: '127.0.0.1', port: 30001 }]
    });
    await dht.ready();

    const rpcSeed = crypto.randomBytes(32);
    this.rpc = new RPC({ seed: rpcSeed, dht });
    this.rpcServer = this.rpc.createServer();
    await this.rpcServer.listen();
    console.log('RPC server started listening on public key:', this.rpcServer.publicKey.toString('hex'));

    this.setupHandlers();
  }

  setupHandlers() {
    this.rpcServer.respond('registerClient', async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString('utf-8'));
      const serverId = this.rpcServer.publicKey.toString('hex');

      const clients = (await this.hbee.get(serverId))?.value || { clients: [] };
      clients.clients.push(req.serverPublicKey);
      await this.hbee.put(serverId, clients);

      console.log('Registered client:', req.serverPublicKey);
      return Buffer.from(JSON.stringify({ success: true }), 'utf-8');
    });

    this.rpcServer.respond('openAuction', async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString('utf-8'));
      const auctionId = crypto.randomBytes(16).toString('hex');
      const auctionDetails = { ...req, auctionId, bids: [], closed: false };
      await this.hbee.put(auctionId, auctionDetails);
      await this.notifyClients('newAuction', { auctionId, auction: req });
      return Buffer.from(JSON.stringify({ auctionId }), 'utf-8');
    });

    this.rpcServer.respond('placeBid', async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString('utf-8'));

      const auctionDetails = (await this.hbee.get(req.auctionId))?.value;
      if (!auctionDetails) {
        return Buffer.from(JSON.stringify({ error: 'Auction not found' }), 'utf-8');
      }
      
      auctionDetails.bids.push(req);
      await this.hbee.put(req.auctionId, auctionDetails);

      await this.notifyClients('newBid', { auctionId: req.auctionId, bid: req });
      return Buffer.from(JSON.stringify({ success: true }), 'utf-8');
    });

    this.rpcServer.respond('closeAuction', async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString('utf-8'));
      const auction = (await this.hbee.get(req.auctionId))?.value;
      if (!auction) {
        return Buffer.from(JSON.stringify({ error: 'Auction not found' }), 'utf-8');
      }

      if (auction.closed) {
        await this.notifyClients('auctionClosedError', { auctionId: req.auctionId, message: 'Auction already closed' });
        return Buffer.from(JSON.stringify({ message: 'Auction already closed' }), 'utf-8');
      }

      if (auction.clientId !== req.clientId) { // this should be done using publicID, it is a demo here
        await this.notifyClients('auctionClosedError', { auctionId: req.auctionId, message: 'Unauthorized: Only the auction owner can close it' });
        return Buffer.from(JSON.stringify({ message: 'Unauthorized: Only the auction owner can close it' }), 'utf-8');
      }

      auction.closed = true;
      const auctionBids = auction.bids || [];
      const highestBid = auctionBids.sort((a, b) => b.amount - a.amount)[0];
      await this.notifyClients('auctionClosed', { auctionId: req.auctionId, highestBid });
      await this.hbee.put(req.auctionId, auction);
      return Buffer.from(JSON.stringify({ highestBid }), 'utf-8');
    });
  }

  async notifyClients(type, message) {
    const serverId = this.rpcServer.publicKey.toString('hex');
    const clients = (await this.hbee.get(serverId))?.value || { clients: [] }
    for (const clientKey of clients.clients) {
      try {
        await this.rpc.request(Buffer.from(clientKey, 'hex'), 'auctionUpdate', Buffer.from(JSON.stringify({ type, ...message }), 'utf-8'));
      } catch (e) {
        console.log('connection closed for ', clientKey);
      }
    }
  }
}

const main = async () => {
  const auctionServer = new AuctionServer();
  await auctionServer.init();
};

main().catch(console.error);
