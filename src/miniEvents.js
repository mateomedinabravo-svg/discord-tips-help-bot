const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const EVENT_EMOJI = '🎉';
const activeEvents = new Map();

async function postEvent(client, guildId, config) {
  const miniEvents = config.miniEvents;
  if (!miniEvents.channelId) return;

  try {
    const channel = await client.channels.fetch(miniEvents.channelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = buildEmbed({
      type: 'warning',
      title: '🎉 ¡Evento sorpresa!',
      description: `Reaccioná con ${EVENT_EMOJI} para ganar **${miniEvents.reward} ${config.economy.currencySymbol}${config.economy.currencyName}**. ¡El primero se lo lleva!`,
    });

    const message = await channel.send({ embeds: [embed] });
    await message.react(EVENT_EMOJI);

    activeEvents.set(message.id, { guildId, reward: miniEvents.reward, claimed: false });
  } catch (err) {
    console.error('No se pudo publicar el mini-evento:', err);
  }
}

async function handleMiniEventReaction(reaction, user) {
  if (user.bot) return;

  const event = activeEvents.get(reaction.message.id);
  if (!event || event.claimed) return;
  if (reaction.emoji.name !== EVENT_EMOJI) return;

  event.claimed = true;
  activeEvents.delete(reaction.message.id);

  await db.addBalance(event.guildId, user.id, event.reward);

  try {
    await reaction.message.reply(`🏆 <@${user.id}> ganó el evento y se llevó ${event.reward} monedas!`);
  } catch (err) {
    console.error('No se pudo anunciar el ganador del mini-evento:', err);
  }
}

module.exports = { postEvent, handleMiniEventReaction };
