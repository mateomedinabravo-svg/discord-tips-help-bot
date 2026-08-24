const aiHelper = require('./aiHelper');
const errorReporter = require('./errorReporter');

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

function findImageAttachment(message) {
  return message.attachments.find((a) => (a.contentType && a.contentType.startsWith('image/')) || IMAGE_EXTENSIONS.test(a.name || a.url));
}

// evita pedirle feedback a la IA mas de una vez para el mismo mensaje si
// varias personas reaccionan con el emoji configurado — vive en memoria
// (se pierde si el proceso reinicia, que en el peor caso solo permite un
// feedback duplicado, no rompe nada)
const alreadyGivenFeedback = new Set();

async function handleRenderFeedbackReaction(reaction, user, config) {
  const settings = config?.ai?.renderFeedback;
  if (!settings?.enabled || !settings.channelIds?.length) return;
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }
  if (reaction.emoji.name !== settings.emoji) return;

  const message = reaction.message;
  if (message.partial) {
    try {
      await message.fetch();
    } catch {
      return;
    }
  }
  if (!settings.channelIds.includes(message.channel.id)) return;
  if (alreadyGivenFeedback.has(message.id)) return;

  const imageAttachment = findImageAttachment(message);
  if (!imageAttachment) return;

  if (!aiHelper.isConfigured(config)) {
    alreadyGivenFeedback.add(message.id);
    await message.reply('⚠️ La IA no está configurada en este server, así que no puedo dar feedback. Avisale a un admin (dashboard → IA).');
    return;
  }

  alreadyGivenFeedback.add(message.id);

  try {
    const result = await aiHelper.critiqueRenderImage(message.client, config, imageAttachment.url, {
      botName: config?.branding?.nickname || message.guild.members.me?.displayName,
      tone: config?.ai?.tone,
      customPersonality: config?.ai?.customPersonality,
    });

    if (result.ok) {
      await message.reply(`🔍 **Feedback del render:**\n${result.text}`);
    } else if (result.reason === 'no-vision-access') {
      await message.reply(
        '⚠️ No puedo dar feedback visual real todavía: la cuenta de Groq de este bot no tiene acceso a un modelo con visión. Esto lo tiene que revisar el dueño del bot.',
      );
    } else {
      await message.reply('🤖 No pude generar el feedback ahora, probá de nuevo en un rato.');
    }
  } catch (err) {
    console.error('Error dando feedback de render:', err);
    await errorReporter.reportError(message.client, config, 'renderFeedback.handleRenderFeedbackReaction', err);
  }
}

module.exports = { handleRenderFeedbackReaction, findImageAttachment };
