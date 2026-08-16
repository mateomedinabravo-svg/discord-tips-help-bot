const { SlashCommandBuilder } = require('discord.js');
const db = require('./db');

const AFK_PREFIX = '[AFK] ';

const definition = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Marcate como ausente (AFK)')
  .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo (opcional)'));

// le pone el prefijo "[AFK]" al apodo (estilo Sapphire), asi se nota en la
// lista de miembros sin tener que mirar el estado. Si el bot no tiene permiso
// (rol mas alto que el del bot, o es el dueño del server) no rompe el comando,
// solo no cambia el apodo
async function applyAfkNickname(member) {
  if (!member) return;
  try {
    const base = member.displayName;
    await member.setNickname(`${AFK_PREFIX}${base}`.slice(0, 32));
  } catch (err) {
    console.error('No se pudo poner el apodo de AFK:', err.message);
  }
}

async function restoreNickname(member, previousNickname) {
  if (!member) return;
  try {
    await member.setNickname(previousNickname || null);
  } catch (err) {
    console.error('No se pudo restaurar el apodo tras salir de AFK:', err.message);
  }
}

async function handleAfkCommand(interaction) {
  const reason = interaction.options.getString('motivo') || 'Sin motivo especificado';
  const wasAlreadyAfk = !!(await db.getAfk(interaction.guild.id, interaction.user.id));
  const member = interaction.member;

  await db.setAfk(interaction.guild.id, interaction.user.id, reason, member?.nickname ?? null);
  if (!wasAlreadyAfk) await applyAfkNickname(member);

  await interaction.reply(`💤 Te marqué como AFK: ${reason}`);
}

function minutesSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
}

async function handleAfkMessage(message) {
  const authorAfk = await db.getAfk(message.guild.id, message.author.id);
  if (authorAfk) {
    await db.removeAfk(message.guild.id, message.author.id);
    await restoreNickname(message.member, authorAfk.previousNickname);
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
