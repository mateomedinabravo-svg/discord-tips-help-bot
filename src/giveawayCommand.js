const { SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const ENTER_BUTTON_PREFIX = 'giveaway-enter:';

const definition = new SlashCommandBuilder()
  .setName('sorteo')
  .setDescription('Crea y gestiona sorteos')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('crear')
      .setDescription('Crea un sorteo nuevo')
      .addStringOption((opt) => opt.setName('premio').setDescription('Qué se sortea').setRequired(true))
      .addStringOption((opt) => opt.setName('duracion').setDescription('Ej: 30m, 2h, 1d').setRequired(true))
      .addIntegerOption((opt) => opt.setName('ganadores').setDescription('Cantidad de ganadores (default 1)').setMinValue(1).setMaxValue(20))
      .addChannelOption((opt) =>
        opt.setName('canal').setDescription('Canal donde publicarlo (default: este canal)').addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('terminar')
      .setDescription('Termina un sorteo antes de tiempo y elige ganador(es) ya')
      .addStringOption((opt) => opt.setName('mensaje_id').setDescription('ID del mensaje del sorteo').setRequired(true)),
  );

function parseDuration(input) {
  const match = /^(\d+)\s*(m|min|h|d)$/i.exec((input || '').trim());
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMs = unit.startsWith('m') ? 60 * 1000 : unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return amount * unitMs;
}

function buildGiveawayEmbed({ prize, winnerCount, endsAt, hostId, entryCount = 0, ended = false, winnerIds = [], config }) {
  if (ended) {
    return buildEmbed({
      type: winnerIds.length ? 'success' : 'warning',
      title: `🎉 Sorteo finalizado: ${prize}`,
      description: winnerIds.length
        ? `Ganador(es): ${winnerIds.map((id) => `<@${id}>`).join(', ')}`
        : 'Nadie participó, no hubo ganador.',
      footer: 'Sorteo terminado',
      config,
    });
  }

  return buildEmbed({
    type: 'brand',
    config,
    title: `🎉 Sorteo: ${prize}`,
    description: `Apretá el botón para participar.\nGanadores: **${winnerCount}**\nTermina: <t:${Math.floor(endsAt.getTime() / 1000)}:R>\nOrganiza: <@${hostId}>\nParticipantes: **${entryCount}**`,
  });
}

function pickWinners(entries, count) {
  const pool = [...entries];
  const winners = [];
  while (pool.length && winners.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  return winners;
}

async function finishGiveaway(client, giveaway) {
  const winnerIds = pickWinners(giveaway.entries, giveaway.winnerCount);
  await db.endGiveaway(giveaway.messageId, winnerIds);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel || !channel.isTextBased()) return;

    const config = await db.getGuildConfig(giveaway.guildId);
    const endedEmbed = buildGiveawayEmbed({
      prize: giveaway.prize,
      winnerCount: giveaway.winnerCount,
      hostId: giveaway.hostId,
      ended: true,
      winnerIds,
      config,
    });

    try {
      const message = await channel.messages.fetch(giveaway.messageId);
      await message.edit({ embeds: [endedEmbed], components: [] });
    } catch (err) {
      console.error('No se pudo editar el mensaje del sorteo:', err);
    }

    if (winnerIds.length) {
      await channel.send(`🎉 ¡Felicitaciones ${winnerIds.map((id) => `<@${id}>`).join(', ')}! Ganaste/Ganaron: **${giveaway.prize}**`);
    } else {
      await channel.send(`😕 El sorteo de **${giveaway.prize}** terminó sin participantes.`);
    }
  } catch (err) {
    console.error('No se pudo anunciar el resultado del sorteo:', err);
  }
}

async function checkExpiredGiveaways(client) {
  const expired = await db.getExpiredGiveaways();
  for (const giveaway of expired) {
    try {
      await finishGiveaway(client, giveaway);
    } catch (err) {
      console.error('Error terminando sorteo vencido:', err);
    }
  }
}

async function handleCreate(interaction) {
  const prize = interaction.options.getString('premio');
  const durationInput = interaction.options.getString('duracion');
  const winnerCount = interaction.options.getInteger('ganadores') || 1;
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  const durationMs = parseDuration(durationInput);
  if (!durationMs) {
    await interaction.reply({ content: '⚠️ Duración inválida. Usá algo como "30m", "2h" o "1d".', ephemeral: true });
    return;
  }

  const endsAt = new Date(Date.now() + durationMs);
  const config = await db.getGuildConfig(interaction.guild.id);
  const embed = buildGiveawayEmbed({ prize, winnerCount, endsAt, hostId: interaction.user.id, entryCount: 0, config });
  const pendingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway-enter-pending').setLabel('🎉 Participar').setStyle(ButtonStyle.Primary),
  );

  const message = await channel.send({ embeds: [embed], components: [pendingRow] });

  const finalRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ENTER_BUTTON_PREFIX}${message.id}`).setLabel('🎉 Participar').setStyle(ButtonStyle.Primary),
  );
  await message.edit({ components: [finalRow] });

  await db.createGiveaway({
    guildId: interaction.guild.id,
    channelId: channel.id,
    messageId: message.id,
    prize,
    winnerCount,
    hostId: interaction.user.id,
    endsAt,
  });

  await interaction.reply({ content: `✅ Sorteo creado en ${channel}.`, ephemeral: true });
}

async function handleEndEarly(interaction) {
  const messageId = interaction.options.getString('mensaje_id').trim();
  const giveaway = await db.getGiveaway(messageId);

  if (!giveaway || giveaway.guildId !== interaction.guild.id) {
    await interaction.reply({ content: '⚠️ No encontré un sorteo con ese ID de mensaje en este server.', ephemeral: true });
    return;
  }
  if (giveaway.ended) {
    await interaction.reply({ content: 'Ese sorteo ya había terminado.', ephemeral: true });
    return;
  }

  await finishGiveaway(interaction.client, giveaway);
  await interaction.reply({ content: '✅ Sorteo terminado y ganador(es) elegido(s).', ephemeral: true });
}

async function handleGiveawayCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'crear') return handleCreate(interaction);
  if (sub === 'terminar') return handleEndEarly(interaction);
}

async function handleEnterButton(interaction) {
  const messageId = interaction.customId.slice(ENTER_BUTTON_PREFIX.length);
  const giveaway = await db.getGiveaway(messageId);

  if (!giveaway || giveaway.ended) {
    await interaction.reply({ content: '⚠️ Este sorteo ya terminó.', ephemeral: true });
    return;
  }
  if (giveaway.entries.includes(interaction.user.id)) {
    await interaction.reply({ content: 'Ya estás participando en este sorteo. 🎉', ephemeral: true });
    return;
  }

  const updated = await db.addGiveawayEntry(messageId, interaction.user.id);
  await interaction.reply({ content: '✅ ¡Entraste al sorteo! Buena suerte.', ephemeral: true });

  try {
    const config = await db.getGuildConfig(interaction.guild.id);
    const embed = buildGiveawayEmbed({
      prize: updated.prize,
      winnerCount: updated.winnerCount,
      endsAt: updated.endsAt,
      hostId: updated.hostId,
      entryCount: updated.entries.length,
      config,
    });
    await interaction.message.edit({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo actualizar el contador de participantes del sorteo:', err);
  }
}

module.exports = {
  definition,
  ENTER_BUTTON_PREFIX,
  parseDuration,
  handleGiveawayCommand,
  handleEnterButton,
  checkExpiredGiveaways,
};
