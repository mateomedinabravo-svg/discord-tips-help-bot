require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { ActivityTracker } = require('./activityTracker');
const { buildEmbed } = require('./embedStyle');
const { buildResponder, NEEDS_FALLBACK } = require('./helpResponder');
const aiHelper = require('./aiHelper');
const announceCommand = require('./announceCommand');
const ticketCommand = require('./ticketCommand');
const levelCommands = require('./levelCommands');
const moderationCommands = require('./moderationCommands');
const reactionRoles = require('./reactionRoles');
const selectRoles = require('./selectRoles');
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
const miniEvents = require('./miniEvents');
const serverGuide = require('./serverGuide');
const debugCommand = require('./debugCommand');
const giveawayCommand = require('./giveawayCommand');
const pollCommand = require('./pollCommand');
const suggestionBox = require('./suggestionBox');
const afkCommand = require('./afkCommand');
const birthdayCommand = require('./birthdayCommand');
const inviteCommand = require('./inviteCommand');
const inviteTracker = require('./inviteTracker');
const sayCommand = require('./sayCommand');
const voiceXp = require('./voiceXp');
const errorReporter = require('./errorReporter');
const { isDirectedAtAnotherUser } = require('./messageDirection');
const db = require('./db');
const { createApp } = require('./web/app');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

const CONFIG_REFRESH_MS = 60 * 1000;
const GIVEAWAY_CHECK_MS = 30 * 1000;
const SCHEDULED_ANNOUNCEMENT_CHECK_MS = 60 * 1000;
const MEMBER_COUNTER_INTERVAL_MS = 10 * 60 * 1000;
const BIRTHDAY_CHECK_MS = 60 * 60 * 1000;
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
const miniEventTimerByGuild = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

// red de contención final: cualquier rechazo/excepción que se escape de los
// handlers de arriba (por ejemplo un evento nuevo sin try/catch) se loguea
// en vez de tirar abajo el proceso entero
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

function getTracker(guildId) {
  if (!trackerByGuild.has(guildId)) {
    trackerByGuild.set(guildId, new ActivityTracker());
  }
  return trackerByGuild.get(guildId);
}

async function applyBotNickname(guildId, config) {
  const nickname = config?.branding?.nickname;
  if (!nickname) return;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const me = guild.members.me || (await guild.members.fetchMe());
    if (me.nickname !== nickname) {
      await me.setNickname(nickname);
    }
  } catch (err) {
    console.error(`No se pudo cambiar el apodo del bot en el server ${guildId}:`, err);
  }
}

async function updateMemberCounter(guildId, config) {
  const counter = config?.memberCounter;
  if (!counter?.enabled || !counter.channelId) return;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = await guild.channels.fetch(counter.channelId).catch(() => null);
    if (!channel) return;

    const name = counter.template.replace(/\{count\}/g, String(guild.memberCount)).slice(0, 100);
    if (channel.name !== name) {
      await channel.setName(name);
    }
  } catch (err) {
    console.error(`No se pudo actualizar el contador de miembros en el server ${guildId}:`, err);
  }
}

async function updateAllMemberCounters() {
  await Promise.all(
    Array.from(client.guilds.cache.keys()).map((guildId) => updateMemberCounter(guildId, configByGuild.get(guildId))),
  );
}

async function refreshGuildConfig(guildId) {
  try {
    const config = await db.getGuildConfig(guildId);
    configByGuild.set(guildId, config);
    findHelpResponseByGuild.set(guildId, buildResponder(config.helpResponses));
    await applyBotNickname(guildId, config);
  } catch (err) {
    console.error(`No se pudo refrescar la configuración del server ${guildId}:`, err);
  }
}

async function refreshAllConfigs() {
  await Promise.all(Array.from(client.guilds.cache.keys()).map((guildId) => refreshGuildConfig(guildId)));
}

function formatTemplate(template, member) {
  return template
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user.username)
    .replace(/\{server\}/g, member.guild.name)
    .replace(/\{membercount\}/g, String(member.guild.memberCount));
}

function startTipLoop(guildId) {
  async function scheduleTip() {
    await sendTipToMostActiveChannel(guildId);
    // si el bot ya no esta en este server (se fue mientras esta llamada estaba
    // en vuelo), no volvemos a armar el timer: evita que el loop quede corriendo
    // para siempre reintentando contra un server al que ya no tenemos acceso
    if (!client.guilds.cache.has(guildId)) return;
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

function startMiniEventLoop(guildId) {
  async function scheduleEvent() {
    const config = configByGuild.get(guildId);
    if (config?.miniEvents?.enabled) {
      await miniEvents.postEvent(client, guildId, config);
    }
    if (!client.guilds.cache.has(guildId)) return;
    const delayMs = Math.max(5, config?.miniEvents?.intervalMinutes || 120) * 60 * 1000;
    miniEventTimerByGuild.set(guildId, setTimeout(scheduleEvent, delayMs));
  }
  scheduleEvent();
}

function stopMiniEventLoop(guildId) {
  const timer = miniEventTimerByGuild.get(guildId);
  if (timer) clearTimeout(timer);
  miniEventTimerByGuild.delete(guildId);
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

async function deleteWithWarning(message, reason) {
  try {
    await message.delete();
    const warning = await message.channel.send(`⚠️ <@${message.author.id}>, tu mensaje se borró por: ${reason}.`);
    setTimeout(() => warning.delete().catch(() => {}), 6000);
  } catch (err) {
    console.error('No se pudo aplicar automoderación:', err);
  }
}

async function applyAutomod(message, config) {
  const automod = config?.automod;

  if (automod?.enabled) {
    const lowerContent = message.content.toLowerCase();
    const hasBannedWord = automod.bannedWords.some((word) => word && lowerContent.includes(word.toLowerCase()));
    const hasInvite = automod.blockInvites && containsInviteLink(message.content);
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    const isMentionSpam = automod.mentionSpamLimit > 0 && mentionCount > automod.mentionSpamLimit;

    if (hasBannedWord || hasInvite || isMentionSpam) {
      const reason = hasBannedWord ? 'contenido no permitido' : hasInvite ? 'links de invitación' : 'demasiadas menciones';
      await deleteWithWarning(message, reason);
      return true;
    }
  }

  if (config?.ai?.enabled && config.ai.moderation && aiHelper.isConfigured(config) && message.content.trim().length > 0) {
    if (aiHelper.canRunModerationCheck(message.guild.id)) {
      const isToxic = await aiHelper.checkToxicMessage(client, config, message.content);
      if (isToxic) {
        await deleteWithWarning(message, 'contenido inapropiado (detectado por IA)');
        return true;
      }
    }
  }

  return false;
}

async function setUpGuild(guild) {
  await refreshGuildConfig(guild.id);
  try {
    await commandRegistry.registerGuildCommands(guild, configByGuild.get(guild.id));
  } catch (err) {
    console.error(`No se pudieron registrar los comandos en ${guild.name}:`, err);
  }
  startTipLoop(guild.id);
  startMiniEventLoop(guild.id);
  await updateMemberCounter(guild.id, configByGuild.get(guild.id));
  await inviteTracker.snapshotInvites(guild);
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  await db.connect();

  for (const guild of client.guilds.cache.values()) {
    await setUpGuild(guild);
  }

  setInterval(refreshAllConfigs, CONFIG_REFRESH_MS);
  setInterval(() => {
    giveawayCommand.checkExpiredGiveaways(client).catch((err) => {
      console.error('Error revisando sorteos vencidos:', err);
      errorReporter.reportError(client, null, 'giveawayCommand.checkExpiredGiveaways', err);
    });
  }, GIVEAWAY_CHECK_MS);
  setInterval(() => {
    sayCommand.checkScheduledAnnouncements(client).catch((err) => {
      console.error('Error revisando anuncios programados:', err);
      errorReporter.reportError(client, null, 'sayCommand.checkScheduledAnnouncements', err);
    });
  }, SCHEDULED_ANNOUNCEMENT_CHECK_MS);
  setInterval(updateAllMemberCounters, MEMBER_COUNTER_INTERVAL_MS);
  setInterval(() => {
    birthdayCommand.checkBirthdaysToday(client, configByGuild).catch((err) => {
      console.error('Error revisando cumpleaños:', err);
      errorReporter.reportError(client, null, 'birthdayCommand.checkBirthdaysToday', err);
    });
  }, BIRTHDAY_CHECK_MS);
  birthdayCommand.checkBirthdaysToday(client, configByGuild).catch((err) => console.error('Error revisando cumpleaños al iniciar:', err));

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
  stopMiniEventLoop(guild.id);
});

client.on('inviteCreate', (invite) => inviteTracker.handleInviteCreate(invite));
client.on('inviteDelete', (invite) => inviteTracker.handleInviteDelete(invite));

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  const guildId = message.guild.id;
  const config = configByGuild.get(guildId);

  try {
    const wasSuggestion = await suggestionBox.handleSuggestionMessage(message, config);
    if (wasSuggestion) return;

    afkCommand.handleAfkMessage(message).catch((err) => console.error('No se pudo procesar el estado AFK:', err));

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

    if (response === NEEDS_FALLBACK) {
      let reply = config?.helpResponses?.fallbackResponse;
      if (config?.ai?.enabled && config.ai.helpFallback && aiHelper.isConfigured(config)) {
        const aiReply = await aiHelper.answerHelpQuestion(client, config, message.content);
        if (aiReply) reply = aiReply;
      }
      if (reply) await message.reply(reply);
    } else if (response) {
      await message.reply(response);
    }
  } catch (err) {
    console.error('Error en messageCreate:', err);
    await errorReporter.reportError(client, config, 'messageCreate', err);
  }
});

client.on('messageDelete', async (message) => {
  if (!message.guild) return;
  const config = configByGuild.get(message.guild.id);
  try {
    await logging.logMessageDelete(client, config, message);
  } catch (err) {
    console.error('Error en messageDelete:', err);
    await errorReporter.reportError(client, config, 'messageDelete', err);
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  const config = configByGuild.get(newMessage.guild.id);
  try {
    await logging.logMessageUpdate(client, config, oldMessage, newMessage);
  } catch (err) {
    console.error('Error en messageUpdate:', err);
    await errorReporter.reportError(client, config, 'messageUpdate', err);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  const config = reaction.message.guild ? configByGuild.get(reaction.message.guild.id) : null;
  try {
    await reactionRoles.handleReactionChange(reaction, user, 'add');
    await miniEvents.handleMiniEventReaction(reaction, user);
    if (config) await starboard.handleStarboardReaction(reaction, config);
  } catch (err) {
    console.error('Error en messageReactionAdd:', err);
    await errorReporter.reportError(client, config, 'messageReactionAdd', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  const config = reaction.message.guild ? configByGuild.get(reaction.message.guild.id) : null;
  try {
    await reactionRoles.handleReactionChange(reaction, user, 'remove');
    if (config) await starboard.handleStarboardReaction(reaction, config);
  } catch (err) {
    console.error('Error en messageReactionRemove:', err);
    await errorReporter.reportError(client, config, 'messageReactionRemove', err);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const config = guild ? configByGuild.get(guild.id) : null;
  try {
    await voiceXp.handleVoiceStateUpdate(oldState, newState, config);
  } catch (err) {
    console.error('Error en voiceStateUpdate:', err);
    await errorReporter.reportError(client, config, 'voiceStateUpdate', err);
  }
});

client.on('guildMemberAdd', async (member) => {
  const config = configByGuild.get(member.guild.id);
  try {
    await logging.logMemberJoin(client, config, member);
    await inviteTracker.handleMemberJoin(member, config);

    const welcome = config?.welcome;
    if (welcome?.roleId) {
      try {
        await member.roles.add(welcome.roleId);
      } catch (err) {
        console.error('No se pudo asignar el autorole:', err);
      }
    }

    if (!welcome || !welcome.enabled || !welcome.channelId) return;

    const channel = await client.channels.fetch(welcome.channelId);
    if (channel && channel.isTextBased()) {
      const text = formatTemplate(welcome.message, member);
      if (welcome.useEmbed) {
        const embed = buildEmbed({ type: 'success', title: '👋 ¡Nuevo miembro!', description: text, thumbnail: member.user.displayAvatarURL(), config });
        await channel.send({ embeds: [embed] });
      } else {
        await channel.send(text);
      }
    }
  } catch (err) {
    console.error('No se pudo mandar el mensaje de bienvenida:', err);
    await errorReporter.reportError(client, config, 'guildMemberAdd', err);
  }
});

client.on('guildMemberRemove', async (member) => {
  const config = configByGuild.get(member.guild.id);
  try {
    await logging.logMemberLeave(client, config, member);

    const goodbye = config?.goodbye;
    if (!goodbye || !goodbye.enabled || !goodbye.channelId) return;

    const channel = await client.channels.fetch(goodbye.channelId);
    if (channel && channel.isTextBased()) {
      const text = formatTemplate(goodbye.message, member);
      if (goodbye.useEmbed) {
        const embed = buildEmbed({ type: 'warning', title: '👋 Se fue un miembro', description: text, thumbnail: member.user.displayAvatarURL(), config });
        await channel.send({ embeds: [embed] });
      } else {
        await channel.send(text);
      }
    }
  } catch (err) {
    console.error('No se pudo mandar el mensaje de despedida:', err);
    await errorReporter.reportError(client, config, 'guildMemberRemove', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  const guildConfig = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
  try {
    await handleInteraction(interaction);
  } catch (err) {
    console.error('Error en interactionCreate:', err);
    // código 10062 = la interacción expiró antes de que pudiéramos responder (lag de Discord/hosting),
    // no es un bug del bot y reportarla cada vez solo generaría ruido en el canal de errores
    if (err.code !== 10062) {
      await errorReporter.reportError(client, guildConfig, `interactionCreate (${interaction.type})`, err);
    }
  }
});

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;

    switch (interaction.commandName) {
      case 'anuncio':
        await announceCommand.handleAnnounceCommand(interaction, config);
        break;
      case 'ticket':
        await ticketCommand.handleTicketCommand(interaction, config);
        break;
      case 'nivel':
        await levelCommands.handleNivelCommand(interaction, config);
        break;
      case 'ranking':
        await levelCommands.handleRankingCommand(interaction, config);
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
        await moderationCommands.handleWarningsCommand(interaction, config);
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
        await memeCommand.handleMemeCommand(interaction, config);
        break;
      case 'debug':
        await debugCommand.handleDebugCommand(interaction, config);
        break;
      case 'sorteo':
        await giveawayCommand.handleGiveawayCommand(interaction, config);
        break;
      case 'encuesta':
        await pollCommand.handlePollCommand(interaction, config);
        break;
      case 'afk':
        await afkCommand.handleAfkCommand(interaction);
        break;
      case 'cumpleanos':
        await birthdayCommand.handleBirthdayCommand(interaction);
        break;
      case 'invitaciones':
        await inviteCommand.handleInviteCommand(interaction, config);
        break;
      case 'decir':
        await sayCommand.handleDecirCommand(interaction);
        break;
      case 'programar':
        await sayCommand.handleProgramarCommand(interaction);
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
    } else if (interaction.customId === selectRoles.SELECT_MENU_ID) {
      await selectRoles.handleSelectMenu(interaction);
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

    if (interaction.customId.startsWith(giveawayCommand.ENTER_BUTTON_PREFIX)) {
      await giveawayCommand.handleEnterButton(interaction, interaction.guild ? configByGuild.get(interaction.guild.id) : null);
      return;
    }

    if (interaction.customId.startsWith(pollCommand.VOTE_BUTTON_PREFIX)) {
      await pollCommand.handleVoteButton(interaction, interaction.guild ? configByGuild.get(interaction.guild.id) : null);
      return;
    }

    if (interaction.customId === suggestionBox.VOTE_UP_ID || interaction.customId === suggestionBox.VOTE_DOWN_ID) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await suggestionBox.handleVoteButton(interaction, config);
      return;
    }

    if (interaction.customId === suggestionBox.APPROVE_ID || interaction.customId === suggestionBox.REJECT_ID) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await suggestionBox.handleDecisionButton(interaction, config);
      return;
    }

    const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
    if (!config) return;

    if (interaction.customId === housesCommand.OPEN_BUTTON_ID) {
      await housesCommand.handleOpenButton(interaction, config);
    } else if (interaction.customId.startsWith('house-accept:') || interaction.customId.startsWith('house-reject:')) {
      await housesCommand.handleDecisionButton(interaction, config);
    } else if (interaction.customId.startsWith(serverGuide.BUTTON_PREFIX)) {
      await serverGuide.handleGuideButton(interaction, config);
    }
  }
}

client.login(TOKEN);
