const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const DEFAULT_COLOR = 0x5865f2; // blurple
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

const definition = new SlashCommandBuilder()
  .setName('anuncio')
  .setDescription('Manda un anuncio con formato embed a un canal')
  .addStringOption((opt) => opt.setName('mensaje').setDescription('Texto del anuncio').setRequired(true))
  .addChannelOption((opt) =>
    opt
      .setName('canal')
      .setDescription('Canal donde mandarlo (si no elegís, se manda en este mismo canal)')
      .addChannelTypes(ChannelType.GuildText),
  )
  .addStringOption((opt) => opt.setName('titulo').setDescription('Título del anuncio (opcional)'))
  .addStringOption((opt) => opt.setName('color').setDescription('Color en hex, ej #ff0000 (opcional)'))
  .addStringOption((opt) => opt.setName('imagen').setDescription('URL de una imagen para el anuncio (opcional)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function parseColor(colorInput) {
  if (!colorInput) return DEFAULT_COLOR;
  if (!HEX_COLOR_PATTERN.test(colorInput)) return DEFAULT_COLOR;
  const hex = colorInput.replace('#', '');
  return parseInt(hex, 16);
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function handleAnnounceCommand(interaction) {
  const mensaje = interaction.options.getString('mensaje', true);
  const canal = interaction.options.getChannel('canal') || interaction.channel;
  const titulo = interaction.options.getString('titulo');
  const color = interaction.options.getString('color');
  const imagen = interaction.options.getString('imagen');

  if (!canal || !canal.isTextBased()) {
    await interaction.reply({ content: '⚠️ Ese canal no admite mensajes de texto.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder().setDescription(mensaje).setColor(parseColor(color)).setTimestamp();
  if (titulo) embed.setTitle(titulo);
  if (imagen && isValidHttpUrl(imagen)) embed.setImage(imagen);

  try {
    await canal.send({ embeds: [embed] });
    await interaction.reply({ content: `✅ Anuncio enviado en ${canal}.`, ephemeral: true });
  } catch (err) {
    console.error('No se pudo mandar el anuncio:', err);
    await interaction.reply({
      content: '❌ No pude mandar el anuncio ahí. Revisá que el bot tenga permiso de escribir en ese canal.',
      ephemeral: true,
    });
  }
}

module.exports = { definition, handleAnnounceCommand };
