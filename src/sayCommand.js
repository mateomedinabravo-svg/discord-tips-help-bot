const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('./db');
const { parseDuration } = require('./giveawayCommand');

const decirDefinition = new SlashCommandBuilder()
  .setName('decir')
  .setDescription('El bot manda un mensaje como si fuera él (solo staff)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((opt) => opt.setName('mensaje').setDescription('Qué decir').setRequired(true))
  .addChannelOption((opt) =>
    opt.setName('canal').setDescription('Canal (default: este canal)').addChannelTypes(ChannelType.GuildText),
  );

async function handleDecirCommand(interaction) {
  const message = interaction.options.getString('mensaje', true);
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  if (!channel.isTextBased()) {
    await interaction.reply({ content: '⚠️ Ese canal no admite mensajes de texto.', ephemeral: true });
    return;
  }

  try {
    await channel.send(message);
    await interaction.reply({ content: `✅ Mensaje enviado en ${channel}.`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `❌ No pude mandar el mensaje: ${err.message}`, ephemeral: true });
  }
}

const programarDefinition = new SlashCommandBuilder()
  .setName('programar')
  .setDescription('Programa un anuncio para el futuro (solo staff)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((opt) => opt.setName('mensaje').setDescription('Qué anunciar').setRequired(true))
  .addStringOption((opt) => opt.setName('cuando').setDescription('Ej: 30m, 2h, 1d').setRequired(true))
  .addChannelOption((opt) =>
    opt.setName('canal').setDescription('Canal (default: este canal)').addChannelTypes(ChannelType.GuildText),
  );

async function handleProgramarCommand(interaction) {
  const message = interaction.options.getString('mensaje', true);
  const when = interaction.options.getString('cuando', true);
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  const durationMs = parseDuration(when);
  if (!durationMs) {
    await interaction.reply({ content: '⚠️ Duración inválida. Usá algo como "30m", "2h" o "1d".', ephemeral: true });
    return;
  }
  if (!channel.isTextBased()) {
    await interaction.reply({ content: '⚠️ Ese canal no admite mensajes de texto.', ephemeral: true });
    return;
  }

  const sendAt = new Date(Date.now() + durationMs);
  await db.createScheduledAnnouncement({
    guildId: interaction.guild.id,
    channelId: channel.id,
    message,
    hostId: interaction.user.id,
    sendAt,
  });

  await interaction.reply({
    content: `✅ Anuncio programado en ${channel} para <t:${Math.floor(sendAt.getTime() / 1000)}:R>.`,
    ephemeral: true,
  });
}

async function checkScheduledAnnouncements(client) {
  const due = await db.getDueScheduledAnnouncements();
  for (const item of due) {
    try {
      const channel = await client.channels.fetch(item.channelId);
      if (channel && channel.isTextBased()) {
        await channel.send(item.message);
      }
    } catch (err) {
      console.error('No se pudo mandar el anuncio programado:', err);
    } finally {
      // se marca como enviado incluso si fallo (canal borrado, etc.) para no
      // reintentar el mismo anuncio para siempre
      await db.markScheduledAnnouncementSent(item._id);
    }
  }
}

module.exports = {
  decirDefinition,
  programarDefinition,
  handleDecirCommand,
  handleProgramarCommand,
  checkScheduledAnnouncements,
};
