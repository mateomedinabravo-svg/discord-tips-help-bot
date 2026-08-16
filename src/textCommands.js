// version con prefijo (ej "!balance") de los comandos slash. Reutiliza los
// mismos handlers que /economia, /nivel, /ban, etc. armando un objeto
// "interaction" compatible con el subconjunto de la API que usan
// (options.getUser/getInteger/getString/getChannel/getSubcommand,
// reply/deferReply/editReply/fetchReply), en vez de duplicar logica de
// negocio.
//
// La mayoria de los comandos usan tokens separados por espacios (modo
// "words"), igual que se escribiria una frase. Los que tienen mas de un
// campo de texto libre (/anuncio, /encuesta, /programar, /sorteo crear) no
// se pueden separar por espacios sin ambiguedad (¿donde termina el mensaje y
// empieza el titulo?), asi que usan modo "pipes": los campos van separados
// por "|", ej. "!anuncio Mensaje | Titulo | #ff0000". /casa tampoco entra en
// ese esquema (la cantidad de campos es dinamica, configurada por server) y
// normalmente abre un modal de Discord, algo que no se puede disparar desde
// un mensaje de texto: para el modo texto se responde directo con las
// respuestas en orden, sin el modal.

const { PermissionFlagsBits } = require('discord.js');
const economyCommands = require('./economyCommands');
const casinoCommands = require('./casinoCommands');
const levelCommands = require('./levelCommands');
const ticketCommand = require('./ticketCommand');
const marriageCommands = require('./marriageCommands');
const petCommands = require('./petCommands');
const inviteCommand = require('./inviteCommand');
const birthdayCommand = require('./birthdayCommand');
const giveawayCommand = require('./giveawayCommand');
const memeCommand = require('./memeCommand');
const triviaCommand = require('./triviaCommand');
const afkCommand = require('./afkCommand');
const debugCommand = require('./debugCommand');
const sayCommand = require('./sayCommand');
const moderationCommands = require('./moderationCommands');
const announceCommand = require('./announceCommand');
const pollCommand = require('./pollCommand');
const housesCommand = require('./housesCommand');
const { buildEmbed } = require('./embedStyle');

class TextCommandError extends Error {}

const USER_MENTION_TOKEN = /^<@!?\d+>$/;
const CHANNEL_MENTION_TOKEN = /^<#\d+>$/;

function isMentionToken(token) {
  return USER_MENTION_TOKEN.test(token) || CHANNEL_MENTION_TOKEN.test(token);
}

// categorias para agrupar la lista de !help, en el orden en que se muestran
const CAT = {
  ECONOMIA: '💰 Economía',
  CASINO: '🎰 Casino',
  PROGRESION: '📈 Progresión',
  TICKETS: '🎫 Tickets',
  MATRIMONIO: '💍 Matrimonio',
  MASCOTAS: '🐾 Mascotas',
  COMUNIDAD: '🎉 Comunidad',
  STAFF: '🛡️ Staff',
};

// comandos de una sola palabra -> un modulo/subcomando especifico
const FLAT_COMMANDS = {
  help: { module: 'help' },

  balance: { module: 'economia', subcommand: 'balance', category: CAT.ECONOMIA },
  daily: { module: 'economia', subcommand: 'daily', category: CAT.ECONOMIA },
  work: { module: 'economia', subcommand: 'work', category: CAT.ECONOMIA },
  pay: { module: 'economia', subcommand: 'pay', usage: '!pay @usuario <cantidad>', category: CAT.ECONOMIA },
  perfil: { module: 'economia', subcommand: 'perfil', category: CAT.ECONOMIA },
  shop: { module: 'economia', subcommand: 'shop', category: CAT.ECONOMIA },
  comprar: { module: 'economia', subcommand: 'comprar', usage: '!comprar <item>', category: CAT.ECONOMIA },
  inventario: { module: 'economia', subcommand: 'inventario', category: CAT.ECONOMIA },

  apostar: { module: 'casino', subcommand: 'apostar', choices: { eleccion: ['cara', 'cruz'] }, usage: '!apostar <cantidad> <cara|cruz>', category: CAT.CASINO },
  slots: { module: 'casino', subcommand: 'slots', usage: '!slots <cantidad>', category: CAT.CASINO },
  ruleta: {
    module: 'casino',
    subcommand: 'ruleta',
    choices: { apuesta: ['rojo', 'negro', 'numero'] },
    usage: '!ruleta <cantidad> <rojo|negro|numero> [numero]',
    category: CAT.CASINO,
  },
  blackjack: { module: 'casino', subcommand: 'blackjack', usage: '!blackjack <cantidad>', category: CAT.CASINO },
  dados: { module: 'casino', subcommand: 'dados', usage: '!dados <cantidad>', category: CAT.CASINO },
  ppt: { module: 'casino', subcommand: 'ppt', choices: { eleccion: ['piedra', 'papel', 'tijera'] }, usage: '!ppt <cantidad> <piedra|papel|tijera>', category: CAT.CASINO },

  nivel: { module: 'nivel', category: CAT.PROGRESION },
  ranking: { module: 'ranking', category: CAT.PROGRESION },

  ticket: { module: 'ticket', category: CAT.TICKETS },

  casar: { module: 'casar', usage: '!casar @usuario', category: CAT.MATRIMONIO },
  divorciar: { module: 'divorciar', category: CAT.MATRIMONIO },
  pareja: { module: 'pareja', category: CAT.MATRIMONIO },

  meme: { module: 'meme', category: CAT.COMUNIDAD },
  trivia: { module: 'trivia', category: CAT.COMUNIDAD },
  afk: { module: 'afk', restStringOptions: ['motivo'], category: CAT.COMUNIDAD },
  casa: {
    module: 'casa',
    mode: 'pipes',
    usage: '!casa <respuesta 1> | <respuesta 2> | ...',
    category: CAT.COMUNIDAD,
  },

  debug: { module: 'debug', permission: PermissionFlagsBits.ManageGuild, category: CAT.STAFF },
  decir: {
    module: 'decir',
    permission: PermissionFlagsBits.ManageGuild,
    restStringOptions: ['mensaje'],
    usage: '!decir [#canal] <mensaje>',
    category: CAT.STAFF,
  },
  anuncio: {
    module: 'anuncio',
    permission: PermissionFlagsBits.ManageGuild,
    mode: 'pipes',
    minSegments: 1,
    usage: '!anuncio <mensaje> [| #canal] [| <titulo>] [| <color hex>] [| <url imagen>]',
    category: CAT.STAFF,
  },
  encuesta: {
    module: 'encuesta',
    mode: 'pipes',
    minSegments: 3,
    usage: '!encuesta <pregunta> | <opcion1> | <opcion2> [| <opcion3>] [| <opcion4>] [| <opcion5>]',
    category: CAT.COMUNIDAD,
  },
  programar: {
    module: 'programar',
    permission: PermissionFlagsBits.ManageGuild,
    mode: 'pipes',
    minSegments: 2,
    usage: '!programar <mensaje> | <cuando, ej 2h> [| #canal]',
    category: CAT.STAFF,
  },

  ban: { module: 'moderacion', subcommand: 'ban', permission: PermissionFlagsBits.BanMembers, restStringOptions: ['razon'], usage: '!ban @usuario [razon]', category: CAT.STAFF },
  kick: { module: 'moderacion', subcommand: 'kick', permission: PermissionFlagsBits.KickMembers, restStringOptions: ['razon'], usage: '!kick @usuario [razon]', category: CAT.STAFF },
  mute: {
    module: 'moderacion',
    subcommand: 'mute',
    permission: PermissionFlagsBits.ModerateMembers,
    restStringOptions: ['razon'],
    usage: '!mute @usuario <minutos> [razon]',
    category: CAT.STAFF,
  },
  warn: { module: 'moderacion', subcommand: 'warn', permission: PermissionFlagsBits.ModerateMembers, restStringOptions: ['razon'], usage: '!warn @usuario <razon>', category: CAT.STAFF },
  warnings: { module: 'moderacion', subcommand: 'warnings', permission: PermissionFlagsBits.ModerateMembers, usage: '!warnings @usuario', category: CAT.STAFF },
};

// comandos de dos palabras ("!mascota ver"): el primer token es el nombre del
// grupo, el segundo (si coincide con una de las subacciones conocidas) elige
// cual usar; si no aparece ninguna reconocida se usa defaultSubcommand (o,
// si no hay default, se responde con el uso correcto)
const GROUPED_COMMANDS = {
  mascota: {
    module: 'mascota',
    defaultSubcommand: 'ver',
    usage: '!mascota ver|adoptar|alimentar|jugar',
    category: CAT.MASCOTAS,
    subcommands: {
      ver: {},
      adoptar: { choices: { especie: ['perro', 'gato', 'dragon', 'conejo', 'pajaro'] }, usage: '!mascota adoptar <nombre> <perro|gato|dragon|conejo|pajaro>' },
      alimentar: {},
      jugar: {},
    },
  },
  invitaciones: {
    module: 'invitaciones',
    defaultSubcommand: 'ver',
    usage: '!invitaciones ver|ranking',
    category: CAT.COMUNIDAD,
    subcommands: { ver: {}, ranking: {} },
  },
  cumpleanos: {
    module: 'cumpleanos',
    defaultSubcommand: 'ver',
    usage: '!cumpleanos ver|configurar <dia> <mes>',
    category: CAT.COMUNIDAD,
    subcommands: { ver: {}, configurar: { usage: '!cumpleanos configurar <dia (1-31)> <mes (1-12)>' } },
  },
  sorteo: {
    module: 'sorteo',
    defaultSubcommand: null,
    permission: PermissionFlagsBits.ManageGuild,
    usage: '!sorteo terminar <mensaje_id>  o  !sorteo crear <premio> | <duracion>',
    category: CAT.STAFF,
    subcommands: {
      terminar: { usage: '!sorteo terminar <mensaje_id>' },
      crear: { mode: 'pipes', minSegments: 2, usage: '!sorteo crear <premio> | <duracion, ej 2h> [| <ganadores>] [| #canal]' },
    },
  },
};

const CATEGORY_ORDER = [CAT.ECONOMIA, CAT.CASINO, CAT.PROGRESION, CAT.TICKETS, CAT.MATRIMONIO, CAT.MASCOTAS, CAT.COMUNIDAD, CAT.STAFF];

// Discord no ofrece autocompletado nativo para comandos de prefijo (eso es
// exclusivo de los comandos "/"), asi que esta es la alternativa mas cercana:
// un listado armado a partir de las mismas tablas que usa el enrutador, asi
// no se desactualiza cuando se agrega o saca un comando
function buildHelpFields(prefix) {
  const byCategory = new Map();

  function pushLine(category, usage, locked) {
    if (!category) return;
    const list = byCategory.get(category) || [];
    const displayUsage = usage.replace(/^!/, prefix);
    list.push(`\`${displayUsage}\`${locked ? ' 🔒' : ''}`);
    byCategory.set(category, list);
  }

  for (const [name, entry] of Object.entries(FLAT_COMMANDS)) {
    if (entry.module === 'help') continue;
    pushLine(entry.category, entry.usage || `!${name}`, !!entry.permission);
  }

  for (const [name, group] of Object.entries(GROUPED_COMMANDS)) {
    for (const [sub, subConfig] of Object.entries(group.subcommands)) {
      const locked = !!(subConfig.permission || group.permission);
      pushLine(group.category, subConfig.usage || `!${name} ${sub}`, locked);
    }
  }

  return CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => ({
    name: cat,
    value: byCategory.get(cat).join('\n'),
    inline: false,
  }));
}

async function handleHelpCommand(interaction, config, prefix) {
  const embed = buildEmbed({
    type: 'brand',
    title: '📋 Comandos con prefijo',
    description: `Todos estos también funcionan como comandos "/". Lo que tiene 🔒 pide permiso de staff.`,
    fields: buildHelpFields(prefix),
    footer: `Prefijo actual: ${prefix}`,
    config,
  });
  await interaction.reply({ embeds: [embed] });
}

function buildTextInteraction(message, { subcommand, args, restStringOptions, choices }) {
  const mentionedUsers = [...message.mentions.users.values()];
  let mentionCursor = 0;
  let replyMessage = null;

  function stripEphemeral(payload) {
    const data = typeof payload === 'string' ? { content: payload } : { ...payload };
    delete data.ephemeral;
    return data;
  }

  async function sendReply(payload) {
    replyMessage = await message.reply(stripEphemeral(payload));
    return replyMessage;
  }

  return {
    user: message.author,
    guild: message.guild,
    member: message.member,
    channel: message.channel,
    client: message.client,
    options: {
      getSubcommand: () => subcommand,
      getUser: (name, required) => {
        const user = mentionedUsers[mentionCursor];
        if (user) mentionCursor++;
        if (required && !user) throw new TextCommandError('Te faltó mencionar a un usuario (@usuario).');
        return user || null;
      },
      getChannel: (name) => message.mentions.channels.first() || null,
      getInteger: (name, required) => {
        const raw = args.shift();
        if (raw === undefined || raw === '') {
          if (required) throw new TextCommandError('Te faltó un número.');
          return null;
        }
        const value = parseInt(raw, 10);
        if (Number.isNaN(value)) throw new TextCommandError(`"${raw}" no es un número válido.`);
        return value;
      },
      getString: (name, required) => {
        if (restStringOptions.has(name)) {
          const joined = args.join(' ').trim();
          args.length = 0;
          if (!joined) {
            if (required) throw new TextCommandError('Te faltó texto para completar el comando.');
            return null;
          }
          return joined;
        }

        const raw = args.shift();
        if (raw === undefined || raw === '') {
          if (required) throw new TextCommandError('Te faltó un valor.');
          return null;
        }

        const allowedChoices = choices[name];
        if (allowedChoices) {
          const normalized = raw.toLowerCase();
          if (!allowedChoices.includes(normalized)) {
            throw new TextCommandError(`"${raw}" no es válido. Opciones: ${allowedChoices.join(', ')}.`);
          }
          return normalized;
        }

        return raw;
      },
    },
    reply: sendReply,
    deferReply: async () => {},
    editReply: async (payload) => {
      if (replyMessage) return replyMessage.edit(stripEphemeral(payload));
      return sendReply(payload);
    },
    fetchReply: async () => replyMessage,
  };
}

// /casa normalmente abre un modal de Discord (imposible desde un mensaje de
// texto): la version con prefijo salta el modal y arma las respuestas
// directo desde los segmentos separados por "|", en el mismo orden que las
// preguntas configuradas en el dashboard
async function handleCasaText(interaction, config, segments) {
  if (!config?.houses?.enabled) {
    await interaction.reply('⚠️ Las solicitudes de House no están habilitadas en este server.');
    return;
  }

  const fields = (config.houses.formFields || []).slice(0, 5);
  if (!fields.length) {
    await interaction.reply('⚠️ El formulario no tiene campos configurados todavía.');
    return;
  }

  if (segments.length < fields.length || segments.some((s) => !s)) {
    throw new TextCommandError(`Te faltan respuestas. Campos del formulario: ${fields.join(' | ')}`);
  }

  const answers = {};
  fields.forEach((label, index) => {
    answers[label] = segments[index].slice(0, 1000);
  });

  await housesCommand.submitHouseApplication(interaction, config, answers);
}

async function dispatchModeracion(subcommand, interaction, config) {
  switch (subcommand) {
    case 'ban':
      return moderationCommands.handleBanCommand(interaction, config);
    case 'kick':
      return moderationCommands.handleKickCommand(interaction, config);
    case 'mute':
      return moderationCommands.handleMuteCommand(interaction, config);
    case 'warn':
      return moderationCommands.handleWarnCommand(interaction, config);
    case 'warnings':
      return moderationCommands.handleWarningsCommand(interaction, config);
    default:
      return null;
  }
}

async function dispatch(resolved, interaction, config, segments, prefix) {
  switch (resolved.module) {
    case 'help':
      return handleHelpCommand(interaction, config, prefix);
    case 'economia':
      return economyCommands.handleEconomyCommand(interaction, config);
    case 'casino':
      return casinoCommands.handleCasinoCommand(interaction, config);
    case 'nivel':
      return levelCommands.handleNivelCommand(interaction, config);
    case 'ranking':
      return levelCommands.handleRankingCommand(interaction, config);
    case 'ticket':
      return ticketCommand.handleTicketCommand(interaction, config);
    case 'casar':
      return marriageCommands.handleCasarCommand(interaction);
    case 'divorciar':
      return marriageCommands.handleDivorciarCommand(interaction);
    case 'pareja':
      return marriageCommands.handleParejaCommand(interaction);
    case 'mascota':
      return petCommands.handlePetCommand(interaction, config);
    case 'invitaciones':
      return inviteCommand.handleInviteCommand(interaction, config);
    case 'cumpleanos':
      return birthdayCommand.handleBirthdayCommand(interaction);
    case 'sorteo':
      return giveawayCommand.handleGiveawayCommand(interaction, config);
    case 'meme':
      return memeCommand.handleMemeCommand(interaction, config);
    case 'trivia':
      return triviaCommand.handleTriviaCommand(interaction, config);
    case 'afk':
      return afkCommand.handleAfkCommand(interaction);
    case 'casa':
      return handleCasaText(interaction, config, segments);
    case 'debug':
      return debugCommand.handleDebugCommand(interaction, config);
    case 'decir':
      return sayCommand.handleDecirCommand(interaction);
    case 'anuncio':
      return announceCommand.handleAnnounceCommand(interaction, config);
    case 'encuesta':
      return pollCommand.handlePollCommand(interaction, config);
    case 'programar':
      return sayCommand.handleProgramarCommand(interaction);
    case 'moderacion':
      return dispatchModeracion(resolved.subcommand, interaction, config);
    default:
      return null;
  }
}

// resuelve el nombre de comando a {module, subcommand, permission, mode,
// minSegments, restStringOptions, choices, usage} o null si no es
// reconocido. Para los agrupados, tambien consume de `restTokens` el token
// de subcomando si encuentra uno valido
function resolveCommand(commandName, restTokens) {
  const flat = FLAT_COMMANDS[commandName];
  if (flat) return flat;

  const group = GROUPED_COMMANDS[commandName];
  if (!group) return null;

  let subcommandName = group.defaultSubcommand;
  if (restTokens.length && Object.prototype.hasOwnProperty.call(group.subcommands, restTokens[0].toLowerCase())) {
    subcommandName = restTokens.shift().toLowerCase();
  }
  if (!subcommandName) return { module: group.module, subcommand: null, usage: group.usage };

  const subConfig = group.subcommands[subcommandName] || {};
  return { module: group.module, subcommand: subcommandName, permission: group.permission, usage: group.usage, ...subConfig };
}

// devuelve true si el mensaje era un comando con prefijo reconocido (se haya
// podido ejecutar o no), para que el llamador sepa si tiene que cortar el
// resto del procesamiento del mensaje (XP, respuestas automaticas, etc.)
async function handleTextCommand(message, config) {
  const settings = config?.textCommands;
  if (!settings?.enabled) return false;

  const prefix = settings.prefix || '!';
  if (!message.content.startsWith(prefix)) return false;

  const withoutPrefix = message.content.slice(prefix.length).trim();
  if (!withoutPrefix) return false;

  const firstSpace = withoutPrefix.search(/\s/);
  const commandName = (firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace)).toLowerCase();
  const rest = firstSpace === -1 ? '' : withoutPrefix.slice(firstSpace + 1).trim();

  const restWordTokens = rest.length ? rest.split(/\s+/) : [];
  const resolved = resolveCommand(commandName, restWordTokens);
  if (!resolved) return false;

  if (!resolved.subcommand && GROUPED_COMMANDS[commandName]) {
    // grupo reconocido pero sin subaccion valida ni default (ej "!sorteo" solo)
    await message.reply(`❌ Uso: ${resolved.usage}`);
    return true;
  }

  if (resolved.permission && !message.member.permissions.has(resolved.permission)) {
    await message.reply('❌ No tenés permiso para usar este comando.');
    return true;
  }

  // modo "pipes": el texto restante (ya sin el token de subcomando, si lo
  // consumio resolveCommand) se separa por "|" en vez de por espacios, para
  // permitir campos de texto libre con varias palabras cada uno
  let segments;
  if (resolved.mode === 'pipes') {
    const pipesText = restWordTokens.join(' ');
    segments = pipesText.length ? pipesText.split('|').map((s) => s.trim()) : [];
  } else {
    segments = restWordTokens;
  }
  // las menciones (de usuario o canal) se sacan de message.mentions, no de
  // los segmentos de texto (si no, "100" en "!pay @user 100" quedaria
  // mezclado con el "<@..>", o el canal se colaria dentro de un mensaje libre)
  const args = segments.filter((s) => !isMentionToken(s));

  if (resolved.minSegments && args.length < resolved.minSegments) {
    await message.reply(`❌ Uso: ${resolved.usage}`);
    return true;
  }

  const interaction = buildTextInteraction(message, {
    subcommand: resolved.subcommand,
    args,
    restStringOptions: new Set(resolved.restStringOptions || []),
    choices: resolved.choices || {},
  });

  try {
    await dispatch(resolved, interaction, config, args, prefix);
  } catch (err) {
    if (err instanceof TextCommandError) {
      await message.reply(`❌ ${err.message}${resolved.usage ? `\nUso: ${resolved.usage}` : ''}`);
    } else {
      throw err;
    }
  }

  return true;
}

module.exports = { handleTextCommand, TextCommandError, FLAT_COMMANDS, GROUPED_COMMANDS };
