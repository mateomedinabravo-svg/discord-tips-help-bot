const { buildEmbed } = require('./embedStyle');

async function reportError(client, config, context, error) {
  if (!config?.debug?.enabled || !config.debug.errorChannelId) return;

  try {
    const channel = await client.channels.fetch(config.debug.errorChannelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = buildEmbed({
      type: 'error',
      title: '⚠️ Error interno',
      description: `**Contexto:** ${context}\n\`\`\`${String(error?.stack || error?.message || error).slice(0, 1000)}\`\`\``,
    });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo reportar el error al canal de debug:', err);
  }
}

module.exports = { reportError };
