const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { MongoClient } = require('mongodb');

// algunos routers/ISPs no resuelven bien los registros SRV que necesita
// "mongodb+srv://"; forzamos un DNS publico solo para esta resolucion
dns.setServers(['8.8.8.8', '1.1.1.1']);

let client = null;
let db = null;

const defaultTips = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tips.json'), 'utf8'));
const defaultHelpData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'helpResponses.json'), 'utf8'),
);

function defaultConfig(guildId) {
  return {
    guildId,
    language: 'es',
    tipsIntervalMinutes: 20,
    tips: defaultTips,
    helpResponses: defaultHelpData,
    welcome: { enabled: false, channelId: null, message: '👋 ¡Bienvenido/a {user} al server!' },
    goodbye: { enabled: false, channelId: null, message: '👋 {user} se fue del server.' },
    automod: {
      enabled: false,
      bannedWords: [],
      blockInvites: false,
      mentionSpamLimit: 5,
    },
    updatedAt: new Date(),
  };
}

async function connect() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Falta MONGODB_URI en el archivo .env');
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB_NAME || 'discordTipsBot');
  return db;
}

async function getGuildConfig(guildId) {
  const database = await connect();
  const configs = database.collection('guildConfig');

  let config = await configs.findOne({ guildId });
  if (!config) {
    config = defaultConfig(guildId);
    await configs.insertOne(config);
  }

  return config;
}

async function updateGuildConfig(guildId, partialUpdate) {
  const database = await connect();
  const configs = database.collection('guildConfig');

  await configs.updateOne(
    { guildId },
    { $set: { ...partialUpdate, updatedAt: new Date() } },
    { upsert: true },
  );

  return getGuildConfig(guildId);
}

async function incrementMessageStat(guildId, channelId) {
  const database = await connect();
  await database.collection('stats').updateOne(
    { guildId },
    {
      $inc: { totalMessages: 1, [`channelMessageCounts.${channelId}`]: 1 },
      $set: { updatedAt: new Date() },
    },
    { upsert: true },
  );
}

async function getStats(guildId) {
  const database = await connect();
  const stats = await database.collection('stats').findOne({ guildId });
  const openTickets = await database.collection('tickets').countDocuments({ guildId, status: 'open' });
  const closedTickets = await database.collection('tickets').countDocuments({ guildId, status: 'closed' });

  return {
    totalMessages: stats ? stats.totalMessages || 0 : 0,
    channelMessageCounts: stats ? stats.channelMessageCounts || {} : {},
    openTickets,
    closedTickets,
  };
}

async function createTicket({ guildId, channelId, userId }) {
  const database = await connect();
  await database.collection('tickets').insertOne({
    guildId,
    channelId,
    userId,
    status: 'open',
    createdAt: new Date(),
    closedAt: null,
    closedBy: null,
  });
}

async function closeTicket({ channelId, closedBy }) {
  const database = await connect();
  await database.collection('tickets').updateOne(
    { channelId, status: 'open' },
    { $set: { status: 'closed', closedAt: new Date(), closedBy } },
  );
}

async function listTickets(guildId, status) {
  const database = await connect();
  const query = status ? { guildId, status } : { guildId };
  return database.collection('tickets').find(query).sort({ createdAt: -1 }).limit(100).toArray();
}

module.exports = {
  connect,
  getGuildConfig,
  updateGuildConfig,
  incrementMessageStat,
  getStats,
  createTicket,
  closeTicket,
  listTickets,
  defaultConfig,
};
