require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { ActivityTracker } = require('./activityTracker');
const { buildResponder } = require('./helpResponder');
const announceCommand = require('./announceCommand');
const ticketCommand = require('./ticketCommand');
const levelCommands = require('./levelCommands');
const moderationCommands = require('./moderationCommands');
const reactionRoles = require('./reactionRoles');
const starboard = require('./starboard');
const logging = require('./logging');
const housesCommand = require('./housesCommand');
const customCommands = require('./customCommands');
const commandRegistry = require('./commandRegistry');
const economyCommands = require('./economyCommands');
const casinoCommands = require('./casinoCommands');
const marriageCommands = require('./marriageCommands');
const petCommands = require('./petCommands');
const triviaCommand = require('./triviaCommand');
const memeCommand = require('./memeCommand');
const { isDirectedAtAnotherUser } = require('./messageDirection');
const db = require('./db');
const { createApp } = require('./web/app');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

const CONFIG_REFRESH_MS = 60 * 1000;
const WHITELIST = (process.env.TIPS_CHANNEL_WHITELIST || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// estado por servidor: cada guild tiene su propia config, su propio buscador
// de respuestas de ayuda, su propio tracker de actividad y su propio timer de tips
const configByGuild = new Map();
const findHelpResponseByGuild = new Map();
const trackerByGuild = new Map();
const tipTimerByGuild = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

function getTracker(guildId) {
  if (!trackerByGuild.has(guildId)) {
    trackerByGuild.set(guildId, new ActivityTracker());
  }
  return trackerByGuild.get(guildId);
}

async function refreshGuildConfig(guildId) {
  try {
    const config = await db.getGuildConfig(guildId);
    configByGuild.set(guildId, config);
    findHelpResponseByGuild.set(guildId, buildResponder(config.helpResponses));
  } catch (err) {
    console.error(`No se pudo refrescar la configuración del server ${guildId}:`, err);
  }
}

async function refreshAllConfigs() {
  await Promise.all(Array.from(client.guilds.cache.keys()).map((guildId) => refreshGuildConfig(guildId)));
}

function formatTemplate(template, member) {
  return template.replace(/\{user\}/g, `<@${member.id}>`);
}

function startTipLoop(guildId) {
  async function scheduleTip() {
    await sendTipToMostActiveChannel(guildId);
    const config = configByGuild.get(guildId);
    const delayMs = Math.max(1, config?.tipsIntervalMinutes || 20) * 60 * 1000;
    tipTimerByGuild.set(guildId, setTimeout(scheduleTip, delayMs));
  }
  scheduleTip();
}

function stopTipLoop(guildId) {
  const timer = tipTimerByGuild.get(guildId);
  if (timer) clearTimeout(timer);
  tipTimerByGuild.delete(guildId);
}

async function sendTipToMostActiveChannel(guildId) {
  const tracker = getTracker(guildId);
  const channelId = tracker.getMostActiveChannelId();
  tracker.reset();

  const config = configByGuild.get(guildId);
  if (!channelId || !config || !config.tips.length) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const tip = config.tips[Math.floor(Math.random() * config.tips.length)];
    await channel.send(tip);
  } catch (err) {
    console.error('No se pudo mandar el tip:', err);
  }
}

function containsInviteLink(content) {
  return /(discord\.gg|discord(app)?\.com\/invite)\/\S+/i.test(content);
}

async function applyAutomod(message, config) {
  const automod = config?.automod;
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

async function setUpGuild(guild) {
  await refreshGuildConfig(guild.id);
  try {
    await commandRegistry.registerGuildCommands(guild, configByGuild.get(guild.id));
  } catch (err) {
    console.error(`No se pudieron registrar los comandos en ${guild.name}:`, err);
  }
  startTipLoop(guild.id);
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  await db.connect();

  for (const guild of client.guilds.cache.values()) {
    await setUpGuild(guild);
  }

  setInterval(refreshAllConfigs, CONFIG_REFRESH_MS);

  const webApp = createApp({ client });
  webApp.listen(process.env.PORT || 3000, () => {
    console.log('Dashboard web arriba.');
  });
});

client.on('guildCreate', async (guild) => {
  console.log(`Bot agregado a un nuevo server: ${guild.name}`);
  await setUpGuild(guild);
});

client.on('guildDelete', (guild) => {
  configByGuild.delete(guild.id);
  findHelpResponseByGuild.delete(guild.id);
  trackerByGuild.delete(guild.id);
  stopTipLoop(guild.id);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  const guildId = message.guild.id;
  const config = configByGuild.get(guildId);

  if (WHITELIST.length === 0 || WHITELIST.includes(message.channel.id)) {
    getTracker(guildId).registerMessage(message.channel.id);
  }
  db.incrementMessageStat(guildId, message.channel.id).catch((err) =>
    console.error('No se pudo registrar la estadística del mensaje:', err),
  );

  const wasRemoved = await applyAutomod(message, config);
  if (wasRemoved) return;

  if (config) {
    levelCommands.awardXp(message, config).catch((err) => console.error('No se pudo otorgar XP:', err));
  }

  const directedElsewhere = isDirectedAtAnotherUser({
    mentionsBot: message.mentions.has(client.user.id),
    repliedUserId: message.mentions.repliedUser ? message.mentions.repliedUser.id : null,
    mentionedUserIds: message.mentions.users.map((user) => user.id),
    botId: client.user.id,
  });
  if (directedElsewhere) return;

  const findHelpResponse = findHelpResponseByGuild.get(guildId) || (() => null);
  const response = findHelpResponse(message.content);
  if (response) {
    await message.reply(response);
  }
});

client.on('messageDelete', async (message) => {
  if (!message.guild) return;
  await logging.logMessageDelete(client, configByGuild.get(message.guild.id), message);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  await logging.logMessageUpdate(client, configByGuild.get(newMessage.guild.id), oldMessage, newMessage);
});

client.on('messageReactionAdd', async (reaction, user) => {
  await reactionRoles.handleReactionChange(reaction, user, 'add');

  if (reaction.message.guild) {
    const config = configByGuild.get(reaction.message.guild.id);
    if (config) await starboard.handleStarboardReaction(reaction, config);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  await reactionRoles.handleReactionChange(reaction, user, 'remove');

  if (reaction.message.guild) {
    const config = configByGuild.get(reaction.message.guild.id);
    if (config) await starboard.handleStarboardReaction(reaction, config);
  }
});

client.on('guildMemberAdd', async (member) => {
  const config = configByGuild.get(member.guild.id);
  await logging.logMemberJoin(client, config, member);

  const welcome = config?.welcome;
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
  const config = configByGuild.get(member.guild.id);
  await logging.logMemberLeave(client, config, member);

  const goodbye = config?.goodbye;
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
    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;

    switch (interaction.commandName) {
      case 'anuncio':
        await announceCommand.handleAnnounceCommand(interaction);
        break;
      case 'ticket':
        await ticketCommand.handleTicketCommand(interaction, config);
        break;
      case 'nivel':
        await levelCommands.handleNivelCommand(interaction);
        break;
      case 'ranking':
        await levelCommands.handleRankingCommand(interaction);
        break;
      case 'ban':
        await moderationCommands.handleBanCommand(interaction, config);
        break;
      case 'kick':
        await moderationCommands.handleKickCommand(interaction, config);
        break;
      case 'mute':
        await moderationCommands.handleMuteCommand(interaction, config);
        break;
      case 'warn':
        await moderationCommands.handleWarnCommand(interaction, config);
        break;
      case 'warnings':
        await moderationCommands.handleWarningsCommand(interaction);
        break;
      case 'casa':
        await housesCommand.handleCasaCommand(interaction, config);
        break;
      case 'economia':
        await economyCommands.handleEconomyCommand(interaction, config);
        break;
      case 'casino':
        await casinoCommands.handleCasinoCommand(interaction, config);
        break;
      case 'casar':
        await marriageCommands.handleCasarCommand(interaction);
        break;
      case 'divorciar':
        await marriageCommands.handleDivorciarCommand(interaction);
        break;
      case 'pareja':
        await marriageCommands.handleParejaCommand(interaction);
        break;
      case 'mascota':
        await petCommands.handlePetCommand(interaction, config);
        break;
      case 'trivia':
        await triviaCommand.handleTriviaCommand(interaction, config);
        break;
      case 'meme':
        await memeCommand.handleMemeCommand(interaction);
        break;
      default: {
        const custom = config ? customCommands.findCustomCommand(config, interaction.commandName) : null;
        if (custom) await customCommands.handleCustomCommand(interaction, config, custom);
        break;
      }
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
    if (config) await housesCommand.handleModalSubmit(interaction, config);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === ticketCommand.CATEGORY_SELECT_ID) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await ticketCommand.handleCategorySelect(interaction, config);
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === ticketCommand.CLOSE_BUTTON_ID) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      await ticketCommand.handleCloseButton(interaction, config);
      return;
    }

    if (interaction.customId === ticketCommand.CLAIM_BUTTON_ID) {
      await ticketCommand.handleClaimButton(interaction);
      return;
    }

    if (interaction.customId.startsWith(ticketCommand.RATE_PREFIX)) {
      await ticketCommand.handleRatingButton(interaction);
      return;
    }

    if (interaction.customId === 'bj-hit' || interaction.customId === 'bj-stand') {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await casinoCommands.handleBlackjackButton(interaction, config);
      return;
    }

    if (interaction.customId.startsWith('trivia-opt-')) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await triviaCommand.handleTriviaButton(interaction, config);
      return;
    }

    if (interaction.customId.startsWith('marry-accept:') || interaction.customId.startsWith('marry-reject:')) {
      await marriageCommands.handleMarriageButton(interaction);
      return;
    }

    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
    if (!config) return;

    if (interaction.customId === housesCommand.OPEN_BUTTON_ID) {
      await housesCommand.handleOpenButton(interaction, config);
    } else if (interaction.customId.startsWith('house-accept:') || interaction.customId.startsWith('house-reject:')) {
      await housesCommand.handleDecisionButton(interaction, config);
    }
  }
});

client.login(TOKEN);
