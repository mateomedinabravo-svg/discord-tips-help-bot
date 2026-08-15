require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { ActivityTracker } = require('./activityTracker');
const { buildResponder } = require('./helpResponder');
const announceCommand = require('./announceCommand');
const ticketCommand = require('./ticketCommand');
const { isDirectedAtAnotherUser } = require('./messageDirection');
const db = require('./db');
const { createApp } = require('./web/app');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}
if (!GUILD_ID) {
  console.error('Falta GUILD_ID en el archivo .env (el ID de tu server)');
  process.exit(1);
}

const CONFIG_REFRESH_MS = 60 * 1000;
const WHITELIST = (process.env.TIPS_CHANNEL_WHITELIST || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const tracker = new ActivityTracker();
let currentConfig = null;
let currentFindHelpResponse = () => null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

async function refreshConfig() {
  try {
    currentConfig = await db.getGuildConfig(GUILD_ID);
    currentFindHelpResponse = buildResponder(currentConfig.helpResponses);
  } catch (err) {
    console.error('No se pudo refrescar la configuración desde la base de datos:', err);
  }
}

function formatTemplate(template, member) {
  return template.replace(/\{user\}/g, `<@${member.id}>`);
}

async function scheduleTip() {
  await sendTipToMostActiveChannel();
  const delayMs = Math.max(1, currentConfig?.tipsIntervalMinutes || 20) * 60 * 1000;
  setTimeout(scheduleTip, delayMs);
}

async function sendTipToMostActiveChannel() {
  const channelId = tracker.getMostActiveChannelId();
  tracker.reset();

  if (!channelId || !currentConfig || !currentConfig.tips.length) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const tip = currentConfig.tips[Math.floor(Math.random() * currentConfig.tips.length)];
    await channel.send(tip);
  } catch (err) {
    console.error('No se pudo mandar el tip:', err);
  }
}

function containsInviteLink(content) {
  return /(discord\.gg|discord(app)?\.com\/invite)\/\S+/i.test(content);
}

async function applyAutomod(message) {
  const automod = currentConfig?.automod;
  if (!automod || !automod.enabled) return false;

  const lowerContent = message.content.toLowerCase();
  const hasBannedWord = automod.bannedWords.some((word) => word && lowerContent.includes(word));
  const hasInvite = automod.blockInvites && containsInviteLink(message.content);
  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  const isMentionSpam = automod.mentionSpamLimit > 0 && mentionCount > automod.mentionSpamLimit;

  if (!hasBannedWord && !hasInvite && !isMentionSpam) return false;

  try {
    await message.delete();
    const reason = hasBannedWord ? 'contenido no permitido' : hasInvite ? 'links de invitación' : 'demasiadas menciones';
    const warning = await message.channel.send(`⚠️ <@${message.author.id}>, tu mensaje se borró por: ${reason}.`);
    setTimeout(() => warning.delete().catch(() => {}), 6000);
  } catch (err) {
    console.error('No se pudo aplicar automoderación:', err);
  }

  return true;
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  await db.connect();
  await refreshConfig();
  setInterval(refreshConfig, CONFIG_REFRESH_MS);

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set([announceCommand.definition.toJSON(), ticketCommand.definition.toJSON()]);
    } catch (err) {
      console.error(`No se pudieron registrar los comandos en ${guild.name}:`, err);
    }
  }

  scheduleTip();

  const webApp = createApp({ client, guildId: GUILD_ID });
  webApp.listen(process.env.PORT || 3000, () => {
    console.log('Dashboard web arriba.');
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  if (WHITELIST.length === 0 || WHITELIST.includes(message.channel.id)) {
    tracker.registerMessage(message.channel.id);
  }
  db.incrementMessageStat(message.guild.id, message.channel.id).catch((err) =>
    console.error('No se pudo registrar la estadística del mensaje:', err),
  );

  const wasRemoved = await applyAutomod(message);
  if (wasRemoved) return;

  const directedElsewhere = isDirectedAtAnotherUser({
    mentionsBot: message.mentions.has(client.user.id),
    repliedUserId: message.mentions.repliedUser ? message.mentions.repliedUser.id : null,
    mentionedUserIds: message.mentions.users.map((user) => user.id),
    botId: client.user.id,
  });
  if (directedElsewhere) return;

  const response = currentFindHelpResponse(message.content);
  if (response) {
    await message.reply(response);
  }
});

client.on('guildMemberAdd', async (member) => {
  const welcome = currentConfig?.welcome;
  if (!welcome || !welcome.enabled || !welcome.channelId) return;

  try {
    const channel = await client.channels.fetch(welcome.channelId);
    if (channel && channel.isTextBased()) {
      await channel.send(formatTemplate(welcome.message, member));
    }
  } catch (err) {
    console.error('No se pudo mandar el mensaje de bienvenida:', err);
  }
});

client.on('guildMemberRemove', async (member) => {
  const goodbye = currentConfig?.goodbye;
  if (!goodbye || !goodbye.enabled || !goodbye.channelId) return;

  try {
    const channel = await client.channels.fetch(goodbye.channelId);
    if (channel && channel.isTextBased()) {
      await channel.send(formatTemplate(goodbye.message, member));
    }
  } catch (err) {
    console.error('No se pudo mandar el mensaje de despedida:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'anuncio') {
      await announceCommand.handleAnnounceCommand(interaction);
    } else if (interaction.commandName === 'ticket') {
      await ticketCommand.handleTicketCommand(interaction);
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === ticketCommand.CLOSE_BUTTON_ID) {
    await ticketCommand.handleCloseButton(interaction);
  }
});

client.login(TOKEN);
