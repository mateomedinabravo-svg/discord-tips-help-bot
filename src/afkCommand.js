const { SlashCommandBuilder } = require('discord.js');
const db = require('./db');

const definition = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Marcate como ausente (AFK)')
  .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo (opcional)'));

async function handleAfkCommand(interaction) {
  const reason = interaction.options.getString('motivo') || 'Sin motivo especificado';
  await db.setAfk(interaction.guild.id, interaction.user.id, reason);
  await interaction.reply(`💤 Te marqué como AFK: ${reason}`);
}

function minutesSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
}

async function handleAfkMessage(message) {
  const authorAfk = await db.getAfk(message.guild.id, message.author.id);
  if (authorAfk) {
    await db.removeAfk(message.guild.id, message.author.id);
    await message.reply('👋 Bienvenido de vuelta, ya no estás AFK.').catch(() => {});
  }

  const mentionedUsers = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id);
  if (!mentionedUsers.size) return;

  const lines = [];
  for (const user of mentionedUsers.values()) {
    const afk = await db.getAfk(message.guild.id, user.id);
    if (afk) {
      lines.push(`💤 <@${user.id}> está AFK: ${afk.reason} (hace ${minutesSince(afk.since)} min)`);
    }
  }

  if (lines.length) {
    await message.reply(lines.join('\n')).catch(() => {});
  }
}

module.exports = { definition, handleAfkCommand, handleAfkMessage };
