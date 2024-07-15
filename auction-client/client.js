'use strict';

const RPC = require('@hyperswarm/rpc');
const DHT = require('hyperdht');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const crypto = require('crypto');

class AuctionClient {
  constructor(serverPublicKey) {
    this.serverPublicKey = Buffer.from(serverPublicKey, 'hex');
    this.clientId = crypto.randomBytes(16).toString('hex');
  }

  async init() {
    const hcore = new Hypercore('./db/rpc-client');
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
  }

  async openAuction(item, price) {
    
    const payload = { item, price, clientId: this.clientId };
    const respRaw = await this.rpc.request(this.serverPublicKey, 'openAuction', Buffer.from(JSON.stringify(payload), 'utf-8'));
    const resp = JSON.parse(respRaw.toString('utf-8'));
    console.log('Auction opened with ID:', resp.auctionId);
  }

  async placeBid(auctionId, bidder, amount) {
    const payload = { auctionId, bidder, amount, clientId: this.clientId };
    const respRaw = await this.rpc.request(this.serverPublicKey, 'placeBid', Buffer.from(JSON.stringify(payload), 'utf-8'));
    const resp = JSON.parse(respRaw.toString('utf-8'));
    console.log('Bid placed:', resp);
  }

  async closeAuction(auctionId) {
    const payload = { auctionId, clientId: this.clientId };
    const respRaw = await this.rpc.request(this.serverPublicKey, 'closeAuction', Buffer.from(JSON.stringify(payload), 'utf-8'));
    const resp = JSON.parse(respRaw.toString('utf-8'));
    if(resp.highestBid){
      console.log('Auction closed with highest bid:', resp.highestBid);
    }else{
      console.log(`> Error ${auctionId}`, resp.message);
    }
    
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
  const auctionClient = new AuctionClient(serverPublicKey);
  await auctionClient.init();

  while (true) {
    const command = await askQuestion('Enter command (open, bid, close, exit): ');

    if (command === 'exit') {
      console.log('Exiting...');
      readline.close();
      break;
    }

    if (command === 'open') {
      const item = await askQuestion('Enter item: ');
      const price = await askQuestion('Enter price: ');
      await auctionClient.openAuction(item, parseFloat(price));
    } else if (command === 'bid') {
      const auctionId = await askQuestion('Enter auction ID: ');
      const bidder = await askQuestion('Enter bidder: ');
      const amount = await askQuestion('Enter amount: ');
      await auctionClient.placeBid(auctionId, bidder, parseFloat(amount));
    } else if (command === 'close') {
      const auctionId = await askQuestion('Enter auction ID: ');
      await auctionClient.closeAuction(auctionId);
    } else {
      console.log('Invalid command');
    }
  }
};

main().catch(console.error);
