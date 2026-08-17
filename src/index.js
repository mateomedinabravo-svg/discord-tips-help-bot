require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { ActivityTracker } = require('./activityTracker');
const { buildEmbed } = require('./embedStyle');
const { buildResponder, NEEDS_FALLBACK } = require('./helpResponder');
const aiHelper = require('./aiHelper');
const announceCommand = require('./announceCommand');
const ticketCommand = require('./ticketCommand');
const textCommands = require('./textCommands');
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

// el creador/programador del bot: siempre puede pedirle acciones de
// moderacion por chat, ademas de quien este en config.ai.staffUserIds por
// server. Se identifica por ID real de Discord (no por nombre, que se puede
// cambiar o falsificar) — si no esta seteada, nadie tiene este acceso extra
const CREATOR_USER_ID = process.env.CREATOR_USER_ID || null;

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

// si el server eligio uno o varios canales exclusivos para la IA, solo
// responde ahi (ni por mencion ni como respaldo de ayuda); sin canal elegido,
// funciona en todos los canales como antes. Esto NO afecta comandos,
// respuestas pre-guardadas de ayuda, tips ni advertencias de automoderacion
// — nada de eso pasa por la IA
function isAiChannelAllowed(config, channelId) {
  const allowedChannels = config?.ai?.channelIds?.length
    ? config.ai.channelIds
    : config?.ai?.channelId
      ? [config.ai.channelId] // config vieja, un solo canal (legacy)
      : [];
  return !allowedChannels.length || allowedChannels.includes(channelId);
}

// reemplaza las menciones de OTROS usuarios por su nombre visible (para que
// la IA entienda "hablale a Juan" en vez de ver un id crudo) y saca la
// mencion al propio bot, que ya se maneja aparte
function prepareAiText(message) {
  let content = message.content;
  for (const [id, user] of message.mentions.users) {
    if (id === client.user.id) continue;
    const name = message.mentions.members?.get(id)?.displayName || user.username;
    content = content.split(`<@${id}>`).join(name).split(`<@!${id}>`).join(name);
  }
  return content.replace(/<@!?\d+>/g, '').trim();
}

// nombre del server, nombre del bot, nombre de quien escribe, y los ultimos
// mensajes del canal (para que la IA tenga contexto de la conversacion en
// vez de responder cada mensaje como si fuera la primera vez que le hablan)
// arma un directorio de "quien es quien" a partir de los roles etiquetados
// en el dashboard (Owner/CEO, Staff, Helper, etc). Los nombres se resuelven
// EN VIVO desde el cache de miembros del server — nunca se guardan nombres
// en la config, asi nunca queda desactualizado si alguien entra/sale del rol
function buildStaffDirectory(message, config) {
  const tags = config?.ai?.staffRoleTags || [];
  if (!tags.length) return '';
  return tags
    .map((tag) => {
      const role = message.guild.roles.cache.get(tag.roleId);
      if (!role) return `- ${tag.label}: (el rol ya no existe en el server)`;
      const memberNames = role.members.map((m) => m.displayName).slice(0, 20);
      return `- ${tag.label} (rol @${role.name}): ${memberNames.length ? memberNames.join(', ') : 'nadie tiene este rol actualmente'}`;
    })
    .join('\n');
}

// datos basicos y reales del server (para preguntas tipo "cuantos somos" o
// "hace cuanto existe el server"), siempre presentes sin depender de keywords
function buildServerFacts(message) {
  const guild = message.guild;
  return `Miembros totales: ${guild.memberCount}. Server creado el: ${guild.createdAt.toLocaleDateString('es-AR')}.`;
}

async function buildAiContext(message, config) {
  let recentMessages = '';
  try {
    const recent = await message.channel.messages.fetch({ limit: 6 });
    recentMessages = [...recent.values()]
      .filter((m) => m.id !== message.id)
      .reverse()
      .slice(-5)
      .map((m) => `${m.member?.displayName || m.author.username}: ${m.content}`.replace(/\s+/g, ' ').slice(0, 200))
      .join('\n');
  } catch (err) {
    console.error('No se pudo traer contexto reciente para la IA:', err.message);
  }

  // nombres de roles y canales de texto (limitados a 30 c/u para no inflar
  // demasiado el prompt en servers grandes), asi la IA puede mencionarlos con
  // propiedad si le preguntan "que canales hay" o "que roles hay"
  const roleNames = message.guild.roles.cache
    .filter((role) => role.id !== message.guild.id && !role.managed)
    .map((role) => role.name)
    .slice(0, 30)
    .join(', ');

  const channelNames = message.guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildText)
    .map((channel) => `#${channel.name}`)
    .slice(0, 30)
    .join(', ');

  return {
    serverName: message.guild.name,
    botName: config?.branding?.nickname || message.guild.members.me?.displayName || client.user.username,
    userName: message.member?.displayName || message.author.username,
    recentMessages,
    roleNames,
    channelNames,
    tone: config?.ai?.tone,
    customPersonality: config?.ai?.customPersonality,
    forbiddenTopics: config?.ai?.forbiddenTopics,
    staffDirectory: buildStaffDirectory(message, config),
    serverFacts: buildServerFacts(message),
    isCreator: Boolean(CREATOR_USER_ID) && message.author.id === CREATOR_USER_ID,
  };
}

const DEFAULT_AI_COOLDOWN_MS = 8000;
const lastAiReplyByUser = new Map();

// evita que un usuario spamee menciones a la IA (cuida el limite gratis de
// Groq y evita abuso); un solo Map global de userId alcanza porque el
// cooldown es "por usuario", no por servidor ni por canal. cooldownMs es
// configurable por server (config.ai.cooldownSeconds), con el default de
// arriba como respaldo si no esta seteado
function canUseAiNow(userId, cooldownMs = DEFAULT_AI_COOLDOWN_MS) {
  const now = Date.now();
  const last = lastAiReplyByUser.get(userId) || 0;
  if (now - last < cooldownMs) return false;
  lastAiReplyByUser.set(userId, now);
  return true;
}

function aiCooldownMs(config) {
  const seconds = Number(config?.ai?.cooldownSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_AI_COOLDOWN_MS;
}

// saca tildes/diacriticos para que "politica" matchee "política" (la gente
// suele escribir sin tildes en el chat)
function normalizeForMatch(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// bloqueo REAL de temas prohibidos: pasa ANTES de llamar a Groq, asi no
// depende de que el modelo respete la instruccion del prompt (esa es solo
// una capa extra). Si el mensaje contiene alguna de las palabras/temas
// configurados, ni siquiera se gasta la llamada a la IA
function matchForbiddenTopic(content, forbiddenTopics) {
  if (!forbiddenTopics?.length || !content) return null;
  const normalizedContent = normalizeForMatch(content);
  return forbiddenTopics.find((topic) => topic && normalizedContent.includes(normalizeForMatch(topic))) || null;
}

const AI_EMBED_MIN_LENGTH = 150;

// las respuestas cortas van como texto plano (mas livianas en el chat); las
// largas se envuelven en embed con la marca para que se lean mejor
async function sendAiReply(message, config, text) {
  if (text.length >= AI_EMBED_MIN_LENGTH) {
    const embed = buildEmbed({ type: 'brand', description: text, config });
    await message.reply({ embeds: [embed] });
  } else {
    await message.reply(text);
  }
}

function trackAiUsage(guildId, success) {
  db.incrementAiUsage(guildId, success).catch((err) => console.error('No se pudo registrar uso de IA:', err.message));
}

// si el mensaje pregunta por nivel/balance/roles/etc, busca el dato REAL en
// la base (o en el propio member de discord) para el que escribe y para
// cualquier usuario mencionado, asi la IA contesta con el dato real en vez
// de inventarlo
async function buildRealDataForQuery(message) {
  const wantsStats = /\b(nivel|balance|monedas|plata|perfil|experiencia|xp)\b/i.test(message.content);
  const wantsRoles = /\b(rol|roles|permiso|permisos)\b/i.test(message.content);
  if (!wantsStats && !wantsRoles) return '';

  const targets = [{ id: message.author.id, name: message.member?.displayName || message.author.username, member: message.member }];
  for (const [id, user] of message.mentions.users) {
    if (id === client.user.id) continue;
    const member = message.mentions.members?.get(id);
    targets.push({ id, name: member?.displayName || user.username, member });
  }

  const lines = [];
  for (const target of targets) {
    const parts = [];
    if (wantsStats) {
      try {
        const [levelInfo, account] = await Promise.all([
          db.getUserLevel(message.guild.id, target.id),
          db.getEconomyAccount(message.guild.id, target.id),
        ]);
        parts.push(`nivel ${levelInfo.level} (${levelInfo.xp} XP total), balance ${account.balance}`);
      } catch (err) {
        console.error('No se pudo traer datos reales para la IA:', err.message);
      }
    }
    if (wantsRoles) {
      const roleNames = target.member?.roles.cache
        .filter((role) => role.id !== message.guild.id)
        .map((role) => role.name)
        .join(', ');
      parts.push(`roles: ${roleNames || '(sin roles)'}`);
    }
    if (parts.length) lines.push(`- ${target.name}: ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

async function buildChannelSummaryTranscript(message) {
  const recent = await message.channel.messages.fetch({ limit: 25 });
  return [...recent.values()]
    .filter((m) => m.id !== message.id && !m.author.bot)
    .reverse()
    .map((m) => `${m.member?.displayName || m.author.username}: ${m.content}`.replace(/\s+/g, ' ').slice(0, 200))
    .join('\n');
}

// ==== acciones de moderacion por chat con la IA ====
//
// IMPORTANTE: la IA (Groq) NUNCA participa en decidir ni ejecutar estas
// acciones. Todo esto es deteccion por palabra clave (regex) + validacion de
// permisos en código, exactamente igual al patron ya usado para /meme y
// /trivia por chat. Esto es a proposito: como no hay ningun LLM en el medio,
// no existe ningun prompt/injection posible que pueda "convencer" al bot de
// banear a alguien — la unica forma de que esto se ejecute es que un ID de
// Discord real y autorizado escriba un mensaje que matchee el patron, con
// una mencion real (@usuario) como objetivo.
const STAFF_ACTIONS = [
  { type: 'ban', label: 'banear', pattern: /\b(banea(lo|la)?|banear|ban)\b/i, confirm: true },
  { type: 'kick', label: 'expulsar', pattern: /\b(expulsa(lo|la)?|expulsar|echa(lo|la)?|echar|kick(ealo)?)\b/i, confirm: true },
  { type: 'mute', label: 'silenciar', pattern: /\b(silencia(lo|la)?|silenciar|mutea(lo|la)?|mutear|mute|timeout)\b/i, confirm: true },
  { type: 'warn', label: 'advertir', pattern: /\b(advi(e|é)rte(le)?|advertir|amonesta(lo|la)?|amonestar|warn(ealo)?)\b/i, confirm: false },
];

function detectStaffAction(content) {
  for (const action of STAFF_ACTIONS) {
    const match = content.match(action.pattern);
    if (match) return { ...action, matchedText: match[0] };
  }
  return null;
}

// solo el creador del bot (CREATOR_USER_ID) o quien este explicitamente en
// config.ai.staffUserIds de ESE server puede pedir esto por chat — no se usa
// el rol/permiso de discord de quien escribe, es una lista aparte a
// proposito (asi el dueño del bot controla esto independiente de quien sea
// mod en cada server)
function isAiStaffAuthorized(config, userId) {
  if (CREATOR_USER_ID && userId === CREATOR_USER_ID) return true;
  return (config?.ai?.staffUserIds || []).includes(userId);
}

// el objetivo SIEMPRE tiene que ser una mencion real de discord (@usuario),
// nunca se adivina un nombre desde el texto libre — asi no hay forma de que
// la IA (ni nadie por texto) apunte a la persona equivocada
function extractStaffActionTarget(message) {
  return message.mentions.members?.find((member) => member.id !== client.user.id) || null;
}

function extractStaffActionReason(message, targetId, matchedText) {
  let text = message.content;
  text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '');
  text = text.replace(new RegExp(`<@!?${targetId}>`, 'g'), '');
  text = text.replace(matchedText, '');
  text = text.replace(/^\s*((a|al|le|por|que)\s+)+/i, '').trim();
  return text || 'Sin especificar';
}

function extractMuteMinutes(content) {
  const match = content.match(/(\d+)\s*(minutos?|min\b|horas?|hs\b|hrs?\b)/i);
  if (!match) return 10;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('hora') || unit.startsWith('hs') || unit.startsWith('hr')) return amount * 60;
  return amount;
}

// shim minimo de "interaction" para reusar los handlers REALES de
// moderationCommands.js sin duplicar su logica (mismos chequeos de rol
// protegido y jerarquia que ya tienen /ban /kick /mute /warn)
function buildModerationShim(message, target, reason, minutes) {
  return {
    guild: message.guild,
    user: message.author,
    member: message.member,
    client,
    options: {
      getUser: () => target.user,
      getString: () => reason,
      getInteger: () => minutes,
    },
    reply: (payload) => message.reply(payload),
  };
}

// pide confirmacion con reacciones antes de ejecutar acciones destructivas;
// solo cuenta la reaccion del mismo usuario que pidio la accion
async function requestModerationConfirmation(message, description) {
  const confirmMsg = await message.reply(`${description}\n\nReaccioná con ✅ para confirmar o ❌ para cancelar (15s).`);
  await confirmMsg.react('✅').catch(() => {});
  await confirmMsg.react('❌').catch(() => {});
  try {
    const collected = await confirmMsg.awaitReactions({
      filter: (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === message.author.id,
      max: 1,
      time: 15000,
      errors: ['time'],
    });
    return collected.first().emoji.name === '✅';
  } catch {
    await message.reply('⏳ Se venció el tiempo para confirmar, cancelado.').catch(() => {});
    return false;
  }
}

// devuelve true si el mensaje matcheaba una accion de staff (autorizada,
// rechazada o cancelada) — en ese caso el caller no debe seguir con el resto
// del flujo de IA para este mensaje. Devuelve false si no era este tipo de
// pedido, y el mensaje sigue su curso normal (ayuda / charla / etc)
async function handleStaffActionRequest(message, config) {
  const action = detectStaffAction(message.content);
  if (!action) return false;

  if (!isAiStaffAuthorized(config, message.author.id)) {
    await message.reply('❌ No tenés permiso para pedirme acciones de moderación por chat.');
    return true;
  }

  if (!canUseAiNow(message.author.id, aiCooldownMs(config))) {
    await message.reply('⏳ Esperá unos segundos antes de pedirme otra acción.');
    return true;
  }

  const target = extractStaffActionTarget(message);
  if (!target) {
    await message.reply(`Mencioná a la persona (@usuario) para poder ${action.label}la/o.`);
    return true;
  }

  const reason = extractStaffActionReason(message, target.id, action.matchedText);

  try {
    if (action.type === 'mute') {
      const minutes = extractMuteMinutes(message.content);
      if (action.confirm) {
        const ok = await requestModerationConfirmation(message, `🔇 Vas a **silenciar** a <@${target.id}> por ${minutes} min. Motivo: ${reason}`);
        if (!ok) {
          await message.reply('❌ Cancelado.');
          return true;
        }
      }
      await moderationCommands.handleMuteCommand(buildModerationShim(message, target, reason, minutes), config);
      return true;
    }

    if (action.type === 'warn') {
      await moderationCommands.handleWarnCommand(buildModerationShim(message, target, reason, null), config);
      return true;
    }

    const emoji = action.type === 'ban' ? '🔨' : '👢';
    const verb = action.type === 'ban' ? 'banear' : 'expulsar';
    const ok = await requestModerationConfirmation(message, `${emoji} Vas a **${verb}** a <@${target.id}>. Motivo: ${reason}`);
    if (!ok) {
      await message.reply('❌ Cancelado.');
      return true;
    }
    if (action.type === 'ban') {
      await moderationCommands.handleBanCommand(buildModerationShim(message, target, reason, null), config);
    } else {
      await moderationCommands.handleKickCommand(buildModerationShim(message, target, reason, null), config);
    }
    return true;
  } catch (err) {
    console.error('Error ejecutando acción de moderación por IA:', err);
    await errorReporter.reportError(client, config, 'handleStaffActionRequest', err);
    await message.reply('⚠️ Algo falló al ejecutar esa acción.').catch(() => {});
    return true;
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
      const wasTextCommand = await textCommands.handleTextCommand(message, config);
      if (wasTextCommand) return;

      levelCommands.awardXp(message, config).catch((err) => console.error('No se pudo otorgar XP:', err));
    }

    const mentionsBot = message.mentions.has(client.user.id);
    const directedElsewhere = isDirectedAtAnotherUser({
      mentionsBot,
      repliedUserId: message.mentions.repliedUser ? message.mentions.repliedUser.id : null,
      mentionedUserIds: message.mentions.users.map((user) => user.id),
      botId: client.user.id,
    });
    if (directedElsewhere) return;

    if (mentionsBot && config?.ai?.enabled) {
      const wasStaffAction = await handleStaffActionRequest(message, config);
      if (wasStaffAction) return;
    }

    const findHelpResponse = findHelpResponseByGuild.get(guildId) || (() => null);
    const response = findHelpResponse(message.content);

    if (response === NEEDS_FALLBACK) {
      let reply = config?.helpResponses?.fallbackResponse;
      let aiGenerated = false;
      if (matchForbiddenTopic(message.content, config?.ai?.forbiddenTopics)) {
        reply = 'No puedo hablar de ese tema.';
      } else if (
        config?.ai?.enabled &&
        config.ai.helpFallback &&
        aiHelper.isConfigured(config) &&
        isAiChannelAllowed(config, message.channel.id) &&
        canUseAiNow(message.author.id, aiCooldownMs(config))
      ) {
        const aiContext = await buildAiContext(message, config);
        const aiReply = await aiHelper.answerHelpQuestion(client, config, prepareAiText(message), aiContext);
        trackAiUsage(guildId, Boolean(aiReply));
        if (aiReply) {
          reply = aiReply;
          aiGenerated = true;
        }
      }
      if (reply) {
        if (aiGenerated) await sendAiReply(message, config, reply);
        else await message.reply(reply);
      }
    } else if (response) {
      await message.reply(response);
    } else if (
      mentionsBot &&
      config?.ai?.enabled &&
      config.ai.helpFallback &&
      aiHelper.isConfigured(config) &&
      isAiChannelAllowed(config, message.channel.id)
    ) {
      // lo mencionaron directo y no matcheo ningun tema de ayuda: charla en
      // modo mas general en vez de quedarse callado
      const cleanedContent = prepareAiText(message);
      if (cleanedContent) {
        if (!canUseAiNow(message.author.id, aiCooldownMs(config))) {
          await message.reply('⏳ Esperá unos segundos antes de volver a preguntarme algo.');
        } else {
          // reacciona mientras procesa (puede tardar unos segundos), y la
          // saca pase lo que pase al terminar
          const reaction = await message.react('🤔').catch(() => null);
          try {
            if (/\bmemes?\b/i.test(cleanedContent)) {
              // pidio un meme por chat: se manda un meme real (misma logica
              // que /meme) en vez de que la IA "hable" de mandarlo, que es lo
              // que generaba el link falso de imgur.com
              await memeCommand.handleMemeCommand(
                { deferReply: async () => {}, editReply: (payload) => message.reply(payload) },
                config,
              );
            } else if (/\btrivia\b/i.test(cleanedContent)) {
              // idem, pero disparando una trivia real en vez de que la IA
              // hable de hacer una
              let sentMessage = null;
              await triviaCommand.handleTriviaCommand(
                {
                  reply: async (payload) => {
                    sentMessage = await message.reply(payload);
                    return sentMessage;
                  },
                  fetchReply: async () => sentMessage,
                  guild: message.guild,
                },
                config,
              );
            } else if (/\bresum/i.test(cleanedContent)) {
              const transcript = await buildChannelSummaryTranscript(message).catch((err) => {
                console.error('No se pudo traer mensajes para el resumen:', err.message);
                return '';
              });
              const aiContext = await buildAiContext(message, config);
              const summary = await aiHelper.summarizeChannel(client, config, transcript, aiContext);
              trackAiUsage(guildId, Boolean(summary));
              if (summary) await sendAiReply(message, config, summary);
              else await message.reply('🤖 No pude armar el resumen ahora, probá de nuevo en un rato.');
            } else if (matchForbiddenTopic(cleanedContent, config?.ai?.forbiddenTopics)) {
              await message.reply('No puedo hablar de ese tema.');
            } else {
              const aiContext = await buildAiContext(message, config);
              aiContext.realData = await buildRealDataForQuery(message);
              const chatReply = await aiHelper.chatReply(client, config, cleanedContent, aiContext);
              trackAiUsage(guildId, Boolean(chatReply));
              // si la IA falla (timeout, rate limit, etc.) igual contesta algo
              // en vez de quedarse en silencio total despues de que la mencionaron
              if (chatReply) await sendAiReply(message, config, chatReply);
              else await message.reply('🤖 No pude pensar una respuesta ahora, mencioname de nuevo en un rato.');
            }
          } finally {
            if (reaction) await reaction.users.remove(client.user.id).catch(() => {});
          }
        }
      }
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
    if (interaction.customId.startsWith(ticketCommand.CATEGORY_SELECT_ID)) {
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

    if (interaction.customId.startsWith(`${ticketCommand.OPEN_BUTTON_PREFIX}:`)) {
      const config = interaction.guild ? configByGuild.get(interaction.guild.id) : null;
      if (config) await ticketCommand.handleOpenButton(interaction, config);
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
