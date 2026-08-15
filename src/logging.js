const { EmbedBuilder } = require('discord.js');

async function sendLog(client, config, { color, title, description, fields }) {
  const logging = config?.logging;
  if (!logging || !logging.enabled || !logging.channelId) return;

  try {
    const channel = await client.channels.fetch(logging.channelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder().setColor(color || 0x5865f2).setTimestamp();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (fields) embed.addFields(fields);

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo mandar el log:', err);
  }
}

async function logMessageDelete(client, config, message) {
  if (!config?.logging?.logDeletes) return;
  if (message.author?.bot) return;

  await sendLog(client, config, {
    color: 0xed4245,
    title: '🗑️ Mensaje borrado',
    description: message.content || '*(sin contenido de texto)*',
    fields: [
      { name: 'Autor', value: message.author ? `<@${message.author.id}>` : 'Desconocido', inline: true },
      { name: 'Canal', value: `<#${message.channelId}>`, inline: true },
    ],
  });
}

async function logMessageUpdate(client, config, oldMessage, newMessage) {
  if (!config?.logging?.logEdits) return;
  if (newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  await sendLog(client, config, {
    color: 0xf0b232,
    title: '✏️ Mensaje editado',
    fields: [
      { name: 'Autor', value: `<@${newMessage.author.id}>`, inline: true },
      { name: 'Canal', value: `<#${newMessage.channelId}>`, inline: true },
      { name: 'Antes', value: (oldMessage.content || '*(vacío)*').slice(0, 1000) },
      { name: 'Después', value: (newMessage.content || '*(vacío)*').slice(0, 1000) },
    ],
  });
}

async function logMemberJoin(client, config, member) {
  if (!config?.logging?.logJoins) return;
  await sendLog(client, config, {
    color: 0x57f287,
    title: '📥 Miembro se unió',
    description: `<@${member.id}> (${member.user.username})`,
  });
}

async function logMemberLeave(client, config, member) {
  if (!config?.logging?.logJoins) return;
  await sendLog(client, config, {
    color: 0xed4245,
    title: '📤 Miembro se fue',
    description: `<@${member.id}> (${member.user.username})`,
  });
}

module.exports = { sendLog, logMessageDelete, logMessageUpdate, logMemberJoin, logMemberLeave };
