'use strict';

const RPC = require('@hyperswarm/rpc');
const DHT = require('hyperdht');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const crypto = require('crypto');

class ClientServer {
  constructor(serverPublicKey) {
    this.serverPublicKey = Buffer.from(serverPublicKey, 'hex');
  }

  async init() {
    const hcore = new Hypercore('./db/rpc-client-server');
    const hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' });
    await hbee.ready();

    let dhtSeed = (await hbee.get('dht-seed'))?.value;
    if (!dhtSeed) {
      dhtSeed = crypto.randomBytes(32);
      await hbee.put('dht-seed', dhtSeed);
    }

    const dht = new DHT({
      port: 50001,
      keyPair: DHT.keyPair(dhtSeed),
      bootstrap: [{ host: '127.0.0.1', port: 30001 }]
    });
    await dht.ready();

    this.rpc = new RPC({ dht });

    this.server = this.rpc.createServer();
    await this.server.listen();
    const serverPublicKey = this.server.publicKey.toString('hex');
    console.log('Client RPC server started listening on public key:', serverPublicKey);
    this.registerClient();
    this.setupHandlers();
  }

  async registerClient() {
    await this.rpc.request(this.serverPublicKey, 'registerClient', Buffer.from(JSON.stringify({ serverPublicKey: this.server.publicKey.toString('hex') }), 'utf-8'));
    console.log('Client registered with the server.');
  }

  setupHandlers() {
    this.server.respond('auctionUpdate', (reqRaw) => {
      const msg = JSON.parse(reqRaw.toString('utf-8'));
      if (msg.type === 'newAuction') {
        console.log(`> New auction opened: ${msg.auctionId}`, msg.auction);
      } else if (msg.type === 'newBid') {
        console.log(`> New bid placed on auction ${msg.auctionId}:`, msg.bid);
      } else if (msg.type === 'auctionClosed') {
        console.log(`> Auction ${msg.auctionId} closed with highest bid:`, msg.highestBid);
      }else if (msg.type === 'auctionClosedError') {
        console.log(`> Error ${msg.auctionId}`, msg.message);
      }
      
    });
  }

}

const main = async () => {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (query) => {
    return new Promise((resolve) => readline.question(query, resolve));
  };

  const serverPublicKey = await askQuestion('Enter server public key to start: ');
  const auctionClient = new ClientServer(serverPublicKey);
  await auctionClient.init();
};

main().catch(console.error);
