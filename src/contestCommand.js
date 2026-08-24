const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');
const { parseDuration } = require('./giveawayCommand');

const DEFAULT_VOTE_EMOJI = '🏆';
// tope de mensajes escaneados al cerrar (5 paginas de 100) — un canal
// dedicado a un concurso nunca deberia acercarse a esto, pero evita un loop
// sin fin o demasiadas llamadas a la API en un canal muy activo
const MAX_SCAN_PAGES = 5;

const definition = new SlashCommandBuilder()
  .setName('concurso')
  .setDescription('Crea y gestiona concursos de render con votación real por reacción')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('crear')
      .setDescription('Crea un concurso nuevo')
      .addStringOption((opt) => opt.setName('premio').setDescription('Qué se premia').setRequired(true))
      .addStringOption((opt) => opt.setName('duracion').setDescription('Ej: 30m, 2h, 1d').setRequired(true))
      .addStringOption((opt) => opt.setName('emoji_voto').setDescription('Emoji para votar (default 🏆)'))
      .addIntegerOption((opt) => opt.setName('ganadores').setDescription('Cantidad de ganadores (default 1)').setMinValue(1).setMaxValue(10))
      .addChannelOption((opt) =>
        opt.setName('canal').setDescription('Canal donde se postean las entradas (default: este canal)').addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('terminar')
      .setDescription('Cierra un concurso antes de tiempo y anuncia ganador(es) según los votos reales hasta ahora')
      .addStringOption((opt) => opt.setName('mensaje_id').setDescription('ID del mensaje de anuncio del concurso').setRequired(true)),
  );

function buildContestEmbed({ prize, voteEmoji, endsAt, hostId, ended = false, resultsText = null, config }) {
  if (ended) {
    return buildEmbed({
      type: resultsText ? 'success' : 'warning',
      title: `🏆 Concurso finalizado: ${prize}`,
      description: resultsText || 'Nadie participó (nadie posteó una entrada con imagen), no hubo ganador.',
      footer: 'Concurso terminado',
      config,
    });
  }

  return buildEmbed({
    type: 'brand',
    config,
    title: `🖼️ Concurso: ${prize}`,
    description: `Posteá tu entrada en este canal con una imagen adjunta antes de que termine.\nSe vota reaccionando con ${voteEmoji} a la entrada que te guste.\nTermina: <t:${Math.floor(endsAt.getTime() / 1000)}:R>\nOrganiza: <@${hostId}>`,
  });
}

// junta las entradas reales: mensajes con adjunto, de gente real (no bots),
// posteados en el canal DESPUES de que arranco el concurso. Escanea como
// mucho 500 mensajes recientes (5 paginas) para no pegarle sin limite a la
// API en un canal muy activo
async function collectEntries(channel, startedAt) {
  const startedMs = startedAt.getTime();
  const entries = [];
  let before;

  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;

    const sorted = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    let reachedStart = false;
    for (const msg of sorted) {
      if (msg.createdTimestamp < startedMs) {
        reachedStart = true;
        break;
      }
      if (!msg.author.bot && msg.attachments.size > 0) entries.push(msg);
    }

    before = sorted[sorted.length - 1]?.id;
    if (reachedStart || sorted.length < 100) break;
  }

  return entries;
}

function countVotes(message, voteEmoji) {
  return message.reactions.cache.get(voteEmoji)?.count || 0;
}

async function finishContest(client, contest) {
  let resultsText = null;
  try {
    const channel = await client.channels.fetch(contest.channelId);
    if (channel && channel.isTextBased()) {
      const entries = await collectEntries(channel, contest.startedAt);
      const ranked = entries
        .map((msg) => ({ msg, votes: countVotes(msg, contest.voteEmoji) }))
        .filter((e) => e.votes > 0)
        .sort((a, b) => b.votes - a.votes)
        .slice(0, contest.winnerCount);

      if (ranked.length) {
        resultsText = ranked
          .map((e, i) => `${i + 1}. <@${e.msg.author.id}> — ${contest.voteEmoji} **${e.votes}** — ${e.msg.url}`)
          .join('\n');
        await db.endContest(contest.announcementMessageId, ranked.map((e) => e.msg.author.id));
        await channel.send(
          `🏆 ¡Felicitaciones ${ranked.map((e) => `<@${e.msg.author.id}>`).join(', ')}! Ganaste/Ganaron el concurso de **${contest.prize}**.`,
        );
      } else {
        await db.endContest(contest.announcementMessageId, []);
      }

      const config = await db.getGuildConfig(contest.guildId);
      const endedEmbed = buildContestEmbed({ prize: contest.prize, voteEmoji: contest.voteEmoji, ended: true, resultsText, config });
      try {
        const announcement = await channel.messages.fetch(contest.announcementMessageId);
        await announcement.edit({ embeds: [endedEmbed] });
      } catch (err) {
        console.error('No se pudo editar el mensaje de anuncio del concurso:', err);
      }
    } else {
      await db.endContest(contest.announcementMessageId, []);
    }
  } catch (err) {
    console.error('No se pudo cerrar el concurso:', err);
    await db.endContest(contest.announcementMessageId, []);
  }
}

async function checkExpiredContests(client) {
  const expired = await db.getExpiredContests();
  for (const contest of expired) {
    try {
      await finishContest(client, contest);
    } catch (err) {
      console.error('Error terminando concurso vencido:', err);
    }
  }
}

async function handleCreate(interaction, config) {
  const prize = interaction.options.getString('premio');
  const durationInput = interaction.options.getString('duracion');
  const voteEmoji = (interaction.options.getString('emoji_voto') || DEFAULT_VOTE_EMOJI).trim();
  const winnerCount = interaction.options.getInteger('ganadores') || 1;
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  const durationMs = parseDuration(durationInput);
  if (!durationMs) {
    await interaction.reply({ content: '⚠️ Duración inválida. Usá algo como "30m", "2h" o "1d".', ephemeral: true });
    return;
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + durationMs);
  const embed = buildContestEmbed({ prize, voteEmoji, endsAt, hostId: interaction.user.id, config });
  const message = await channel.send({ embeds: [embed] });

  await db.createContest({
    guildId: interaction.guild.id,
    channelId: channel.id,
    announcementMessageId: message.id,
    prize,
    voteEmoji,
    winnerCount,
    hostId: interaction.user.id,
    startedAt,
    endsAt,
  });

  await interaction.reply({ content: `✅ Concurso creado en ${channel}. Las entradas cuentan desde ahora.`, ephemeral: true });
}

async function handleEndEarly(interaction) {
  const messageId = interaction.options.getString('mensaje_id').trim();
  const contest = await db.getContest(messageId);

  if (!contest || contest.guildId !== interaction.guild.id) {
    await interaction.reply({ content: '⚠️ No encontré un concurso con ese ID de mensaje en este server.', ephemeral: true });
    return;
  }
  if (contest.ended) {
    await interaction.reply({ content: 'Ese concurso ya había terminado.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: '⏳ Cerrando el concurso y contando los votos reales...', ephemeral: true });
  await finishContest(interaction.client, contest);
}

async function handleContestCommand(interaction, config) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'crear') return handleCreate(interaction, config);
  if (sub === 'terminar') return handleEndEarly(interaction);
}

module.exports = {
  definition,
  handleContestCommand,
  checkExpiredContests,
  collectEntries,
  countVotes,
};
