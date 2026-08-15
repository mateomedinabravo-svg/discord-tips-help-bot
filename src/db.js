const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { MongoClient, ObjectId } = require('mongodb');

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
    customCommands: [],
    houses: {
      enabled: false,
      requestChannelId: null,
      requestTitle: "SOLICITA UNA Artist's House 🚀",
      requestDescription: 'Si querés tener tu propio espacio para mostrar tu arte, apretá el botón y completá el formulario.',
      requestMessageId: null,
      reviewChannelId: null,
      formFields: ['Nombre artístico', 'Portafolio (link)', 'Por qué querés tu house'],
      acceptMessage: '🎉 ¡Tu solicitud de House fue aceptada! El staff se va a poner en contacto para darte tu canal.',
      rejectMessage: '😕 Tu solicitud de House no fue aceptada esta vez. Podés volver a intentarlo más adelante.',
    },
    protectedRoleIds: [],
    economy: {
      enabled: false,
      currencyName: 'monedas',
      currencySymbol: '🪙',
      dailyAmount: 100,
      workMinAmount: 20,
      workMaxAmount: 80,
      workCooldownMinutes: 60,
      shopItems: [],
    },
    casino: {
      enabled: false,
      minBet: 10,
      maxBet: 1000,
    },
    pets: {
      enabled: false,
      feedCooldownMinutes: 120,
      playCooldownMinutes: 60,
    },
    ticketCategories: [
      {
        id: 'general',
        label: 'Soporte general',
        emoji: '🎫',
        description: 'Cualquier duda o problema que no entre en otra categoría.',
        staffRoleIds: [],
      },
    ],
    ticketPanel: {
      channelId: null,
      messageId: null,
      title: '🎫 Centro de soporte',
      description: 'Elegí abajo el tipo de ticket que necesitás para que el staff te ayude.',
    },
    ticketTranscripts: {
      enabled: false,
      channelId: null,
    },
    ticketFeedback: {
      enabled: false,
    },
    starboard: {
      enabled: false,
      emoji: '⭐',
      threshold: 3,
      channelId: null,
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
  config.houses = { ...defaults.houses, ...(config.houses || {}) };
  config.customCommands = config.customCommands || [];
  config.protectedRoleIds = config.protectedRoleIds || [];
  config.economy = { ...defaults.economy, ...(config.economy || {}) };
  config.casino = { ...defaults.casino, ...(config.casino || {}) };
  config.pets = { ...defaults.pets, ...(config.pets || {}) };
  config.ticketCategories = config.ticketCategories || defaults.ticketCategories;
  config.ticketPanel = { ...defaults.ticketPanel, ...(config.ticketPanel || {}) };
  config.ticketTranscripts = { ...defaults.ticketTranscripts, ...(config.ticketTranscripts || {}) };
  config.ticketFeedback = { ...defaults.ticketFeedback, ...(config.ticketFeedback || {}) };
  config.starboard = { ...defaults.starboard, ...(config.starboard || {}) };

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

async function getNextTicketNumber(guildId) {
  const database = await connect();
  const result = await database
    .collection('ticketCounters')
    .findOneAndUpdate({ guildId }, { $inc: { next: 1 } }, { upsert: true, returnDocument: 'after' });
  const doc = result && result.value !== undefined ? result.value : result;
  return doc.next;
}

async function createTicket({ guildId, channelId, userId, categoryId, categoryLabel, number }) {
  const database = await connect();
  await database.collection('tickets').insertOne({
    guildId,
    channelId,
    userId,
    categoryId: categoryId || null,
    categoryLabel: categoryLabel || null,
    number,
    status: 'open',
    claimedBy: null,
    rating: null,
    createdAt: new Date(),
    closedAt: null,
    closedBy: null,
  });
}

async function claimTicket({ channelId, claimedBy }) {
  const database = await connect();
  await database.collection('tickets').updateOne({ channelId, status: 'open' }, { $set: { claimedBy } });
}

async function closeTicket({ channelId, closedBy }) {
  const database = await connect();
  await database.collection('tickets').updateOne(
    { channelId, status: 'open' },
    { $set: { status: 'closed', closedAt: new Date(), closedBy } },
  );
  return database.collection('tickets').findOne({ channelId });
}

async function rateTicket(ticketId, rating) {
  const database = await connect();
  await database.collection('tickets').updateOne({ _id: new ObjectId(ticketId) }, { $set: { rating } });
}

async function getTicketByChannelId(channelId) {
  const database = await connect();
  return database.collection('tickets').findOne({ channelId });
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

// --- Solicitudes de House ---

async function createHouseApplication({ guildId, userId, answers }) {
  const database = await connect();
  const result = await database.collection('houseApplications').insertOne({
    guildId,
    userId,
    answers,
    status: 'pending',
    createdAt: new Date(),
    decidedAt: null,
    decidedBy: null,
  });
  return result.insertedId;
}

async function decideHouseApplication(applicationId, { status, decidedBy }) {
  const database = await connect();
  await database
    .collection('houseApplications')
    .updateOne({ _id: new ObjectId(applicationId) }, { $set: { status, decidedAt: new Date(), decidedBy } });
}

async function getHouseApplication(applicationId) {
  const database = await connect();
  return database.collection('houseApplications').findOne({ _id: new ObjectId(applicationId) });
}

// --- Economia ---

async function getEconomyAccount(guildId, userId) {
  const database = await connect();
  const accounts = database.collection('economy');

  let account = await accounts.findOne({ guildId, userId });
  if (!account) {
    account = { guildId, userId, balance: 0, inventory: [], lastDaily: null, lastWork: null };
    await accounts.insertOne(account);
  }
  return account;
}

async function addBalance(guildId, userId, amount) {
  await getEconomyAccount(guildId, userId);
  const database = await connect();
  await database.collection('economy').updateOne({ guildId, userId }, { $inc: { balance: amount } });
  const updated = await database.collection('economy').findOne({ guildId, userId });
  return updated.balance;
}

async function setEconomyCooldown(guildId, userId, field, date) {
  const database = await connect();
  await database.collection('economy').updateOne({ guildId, userId }, { $set: { [field]: date } }, { upsert: true });
}

async function transferBalance(guildId, fromUserId, toUserId, amount) {
  const from = await getEconomyAccount(guildId, fromUserId);
  if (from.balance < amount) return false;
  await addBalance(guildId, fromUserId, -amount);
  await addBalance(guildId, toUserId, amount);
  return true;
}

async function addInventoryItem(guildId, userId, item) {
  const account = await getEconomyAccount(guildId, userId);
  const inventory = [...account.inventory];
  const existing = inventory.find((i) => i.itemId === item.itemId);
  if (existing) {
    existing.quantity += 1;
  } else {
    inventory.push({ itemId: item.itemId, name: item.name, quantity: 1 });
  }

  const database = await connect();
  await database.collection('economy').updateOne({ guildId, userId }, { $set: { inventory } });
}

async function getEconomyLeaderboard(guildId, limit = 10) {
  const database = await connect();
  return database.collection('economy').find({ guildId }).sort({ balance: -1 }).limit(limit).toArray();
}

// --- Matrimonios ---

async function getMarriage(guildId, userId) {
  const database = await connect();
  return database.collection('marriages').findOne({ guildId, $or: [{ user1Id: userId }, { user2Id: userId }] });
}

async function createMarriage(guildId, user1Id, user2Id) {
  const database = await connect();
  await database.collection('marriages').insertOne({ guildId, user1Id, user2Id, marriedAt: new Date() });
}

async function deleteMarriage(guildId, userId) {
  const database = await connect();
  await database.collection('marriages').deleteOne({ guildId, $or: [{ user1Id: userId }, { user2Id: userId }] });
}

// --- Mascotas ---

function petXpRequiredForLevel(level) {
  return 3 * level * level + 30 * level + 60;
}

function petLevelInfoFromXp(totalXp) {
  let level = 1;
  let remaining = totalXp;
  while (remaining >= petXpRequiredForLevel(level)) {
    remaining -= petXpRequiredForLevel(level);
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: petXpRequiredForLevel(level) };
}

async function getPet(guildId, userId) {
  const database = await connect();
  return database.collection('pets').findOne({ guildId, userId });
}

async function createPet(guildId, userId, { name, species }) {
  const database = await connect();
  const pet = {
    guildId,
    userId,
    name,
    species,
    xp: 0,
    hunger: 100,
    happiness: 100,
    lastFed: null,
    lastPlayed: null,
    createdAt: new Date(),
  };
  await database.collection('pets').insertOne(pet);
  return pet;
}

async function updatePet(guildId, userId, partialUpdate) {
  const database = await connect();
  await database.collection('pets').updateOne({ guildId, userId }, { $set: partialUpdate });
  return getPet(guildId, userId);
}

// --- Starboard ---

async function getStarboardPost(guildId, originalMessageId) {
  const database = await connect();
  return database.collection('starboardPosts').findOne({ guildId, originalMessageId });
}

async function createStarboardPost({ guildId, originalMessageId, originalChannelId, starboardMessageId, authorId, starCount }) {
  const database = await connect();
  await database.collection('starboardPosts').insertOne({
    guildId,
    originalMessageId,
    originalChannelId,
    starboardMessageId,
    authorId,
    starCount,
    createdAt: new Date(),
  });
}

async function updateStarboardPostCount(guildId, originalMessageId, starCount) {
  const database = await connect();
  await database.collection('starboardPosts').updateOne({ guildId, originalMessageId }, { $set: { starCount } });
}

module.exports = {
  connect,
  getGuildConfig,
  updateGuildConfig,
  incrementMessageStat,
  getStats,
  getNextTicketNumber,
  createTicket,
  claimTicket,
  closeTicket,
  rateTicket,
  getTicketByChannelId,
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
  createHouseApplication,
  decideHouseApplication,
  getHouseApplication,
  getEconomyAccount,
  addBalance,
  setEconomyCooldown,
  transferBalance,
  addInventoryItem,
  getEconomyLeaderboard,
  getMarriage,
  createMarriage,
  deleteMarriage,
  petLevelInfoFromXp,
  getPet,
  createPet,
  updatePet,
  getStarboardPost,
  createStarboardPost,
  updateStarboardPostCount,
};
