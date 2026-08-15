const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildEmbed } = require('./embedStyle');

const BUTTON_PREFIX = 'guide-section:';
const BUTTON_STYLES = [ButtonStyle.Success, ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Danger];

function buildSectionButtons(sections) {
  const rows = [];
  for (let i = 0; i < sections.length; i += 5) {
    const chunk = sections.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        chunk.map((section, idx) =>
          new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}${section.id}`)
            .setLabel(section.label.slice(0, 80))
            .setEmoji(section.emoji || undefined)
            .setStyle(BUTTON_STYLES[(i + idx) % BUTTON_STYLES.length]),
        ),
      ),
    );
  }
  return rows;
}

async function publishGuide(guild, config) {
  const guide = config.serverGuide;
  if (!guide.channelId) throw new Error('No hay canal configurado');
  if (!guide.sections.length) throw new Error('No hay secciones configuradas');

  const channel = await guild.channels.fetch(guide.channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Canal inválido');

  if (guide.messageId) {
    try {
      const old = await channel.messages.fetch(guide.messageId);
      await old.delete();
    } catch {
      // el mensaje viejo ya no existe
    }
  }

  const embed = buildEmbed({ type: 'brand', title: guide.title, description: guide.description });
  const message = await channel.send({ embeds: [embed], components: buildSectionButtons(guide.sections) });
  return message.id;
}

async function handleGuideButton(interaction, config) {
  if (!interaction.customId.startsWith(BUTTON_PREFIX)) return;

  const sectionId = interaction.customId.slice(BUTTON_PREFIX.length);
  const section = (config.serverGuide.sections || []).find((s) => s.id === sectionId);

  if (!section) {
    await interaction.reply({ content: '⚠️ Esta sección ya no existe.', ephemeral: true });
    return;
  }

  const embed = buildEmbed({
    type: 'brand',
    title: `${section.emoji || ''} ${section.label}`.trim(),
    description: section.content,
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { publishGuide, handleGuideButton, BUTTON_PREFIX };
