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
    leveling: {
      enabled: false,
      xpMin: 15,
      xpMax: 25,
      cooldownSeconds: 60,
      levelUpChannelId: null,
      levelRoles: [],
    },
    logging: {
      enabled: false,
      channelId: null,
      logDeletes: true,
      logEdits: true,
      logJoins: true,
      logModeration: true,
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

  // completa campos nuevos para configs guardadas antes de que existieran
  const defaults = defaultConfig(guildId);
  config.leveling = { ...defaults.leveling, ...(config.leveling || {}) };
  config.logging = { ...defaults.logging, ...(config.logging || {}) };

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

// --- Niveles / XP ---

// xp necesaria para pasar de "level" al siguiente
function xpRequiredForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

function levelInfoFromXp(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpRequiredForLevel(level)) {
    remaining -= xpRequiredForLevel(level);
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: xpRequiredForLevel(level) };
}

async function addXp(guildId, userId, amount) {
  const database = await connect();
  const levels = database.collection('levels');

  const before = await levels.findOne({ guildId, userId });
  const previousLevel = before ? levelInfoFromXp(before.xp || 0).level : 0;

  await levels.updateOne(
    { guildId, userId },
    { $inc: { xp: amount }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );

  const after = await levels.findOne({ guildId, userId });
  const newLevel = levelInfoFromXp(after.xp).level;

  return { xp: after.xp, level: newLevel, leveledUp: newLevel > previousLevel };
}

async function getUserLevel(guildId, userId) {
  const database = await connect();
  const doc = await database.collection('levels').findOne({ guildId, userId });
  const xp = doc ? doc.xp : 0;
  return { xp, ...levelInfoFromXp(xp) };
}

async function getLeaderboard(guildId, limit = 10) {
  const database = await connect();
  return database.collection('levels').find({ guildId }).sort({ xp: -1 }).limit(limit).toArray();
}

// --- Roles por reaccion ---

async function createReactionRoleSet({ guildId, channelId, messageId, pairs }) {
  const database = await connect();
  await database.collection('reactionRoleSets').insertOne({
    guildId,
    channelId,
    messageId,
    pairs,
    createdAt: new Date(),
  });
}

async function getReactionRoleSet(messageId) {
  const database = await connect();
  return database.collection('reactionRoleSets').findOne({ messageId });
}

async function listReactionRoleSets(guildId) {
  const database = await connect();
  return database.collection('reactionRoleSets').find({ guildId }).sort({ createdAt: -1 }).toArray();
}

async function deleteReactionRoleSet(messageId) {
  const database = await connect();
  await database.collection('reactionRoleSets').deleteOne({ messageId });
}

// --- Advertencias (warnings) ---

async function addWarning({ guildId, userId, moderatorId, reason }) {
  const database = await connect();
  await database.collection('warnings').insertOne({
    guildId,
    userId,
    moderatorId,
    reason,
    createdAt: new Date(),
  });
}

async function listWarnings(guildId, userId) {
  const database = await connect();
  return database.collection('warnings').find({ guildId, userId }).sort({ createdAt: -1 }).toArray();
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
  levelInfoFromXp,
  addXp,
  getUserLevel,
  getLeaderboard,
  createReactionRoleSet,
  getReactionRoleSet,
  listReactionRoleSets,
  deleteReactionRoleSet,
  addWarning,
  listWarnings,
};
