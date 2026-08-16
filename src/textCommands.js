// version con prefijo (ej "!balance") de los comandos slash mas usados en
// chat. Reutiliza los mismos handlers que /economia, /nivel, etc. armando un
// objeto "interaction" compatible con el subconjunto de la API que usan
// (options.getUser/getInteger/getString, reply/deferReply/editReply/fetchReply)
// en vez de duplicar la logica de cada comando.

const economyCommands = require('./economyCommands');
const levelCommands = require('./levelCommands');
const ticketCommand = require('./ticketCommand');
const marriageCommands = require('./marriageCommands');
const petCommands = require('./petCommands');

class TextCommandError extends Error {}

const MENTION_TOKEN = /^<@!?\d+>$/;

// mapea el nombre del comando de texto a que modulo/subcomando slash llamar
const PREFIX_COMMANDS = {
  balance: { module: 'economia', subcommand: 'balance' },
  daily: { module: 'economia', subcommand: 'daily' },
  work: { module: 'economia', subcommand: 'work' },
  pay: { module: 'economia', subcommand: 'pay' },
  perfil: { module: 'economia', subcommand: 'perfil' },
  nivel: { module: 'nivel' },
  ranking: { module: 'ranking' },
  ticket: { module: 'ticket' },
  casar: { module: 'casar' },
  mascota: { module: 'mascota', subcommand: 'ver' },
};

function buildTextInteraction(message, { subcommand, args }) {
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
        if (required && !user) throw new TextCommandError(`Te faltó mencionar a un usuario (@usuario).`);
        return user || null;
      },
      getInteger: (name, required) => {
        const raw = args.shift();
        if (raw === undefined) {
          if (required) throw new TextCommandError(`Te faltó un número.`);
          return null;
        }
        const value = parseInt(raw, 10);
        if (Number.isNaN(value)) throw new TextCommandError(`"${raw}" no es un número válido.`);
        return value;
      },
      getString: (name, required) => {
        const value = args.shift();
        if (value === undefined) {
          if (required) throw new TextCommandError(`Te faltó un valor.`);
          return null;
        }
        return value;
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

async function dispatch(entry, interaction, config) {
  switch (entry.module) {
    case 'economia':
      return economyCommands.handleEconomyCommand(interaction, config);
    case 'nivel':
      return levelCommands.handleNivelCommand(interaction, config);
    case 'ranking':
      return levelCommands.handleRankingCommand(interaction, config);
    case 'ticket':
      return ticketCommand.handleTicketCommand(interaction, config);
    case 'casar':
      return marriageCommands.handleCasarCommand(interaction);
    case 'mascota':
      return petCommands.handlePetCommand(interaction, config);
    default:
      return null;
  }
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

  const tokens = withoutPrefix.split(/\s+/);
  const commandName = tokens.shift().toLowerCase();
  const entry = PREFIX_COMMANDS[commandName];
  if (!entry) return false;

  // las menciones de usuario se sacan de message.mentions, no de los tokens
  // de texto (si no, "100" en "!pay @user 100" quedaria mezclado con el "<@..>")
  const args = tokens.filter((t) => !MENTION_TOKEN.test(t));
  const interaction = buildTextInteraction(message, { subcommand: entry.subcommand, args });

  try {
    await dispatch(entry, interaction, config);
  } catch (err) {
    if (err instanceof TextCommandError) {
      await message.reply(`❌ ${err.message}`);
    } else {
      throw err;
    }
  }

  return true;
}

module.exports = { handleTextCommand, TextCommandError, PREFIX_COMMANDS };
