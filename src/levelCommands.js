const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('./db');
const { resolveColor } = require('./embedStyle');
const { generateRankCard } = require('./rankCard');

const nivelDefinition = new SlashCommandBuilder()
  .setName('nivel')
  .setDescription('Muestra tu nivel y experiencia (o la de otro usuario)')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar (opcional)'));

const rankingDefinition = new SlashCommandBuilder()
  .setName('ranking')
  .setDescription('Muestra el top 10 de usuarios con más experiencia');

const lastAward = new Map();

function progressBar(current, total, length = 12) {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(ratio * length);
  return '🟩'.repeat(filled) + '⬜'.repeat(length - filled);
}

// comun a XP por mensaje y XP por voz: aplica el incremento, y si subio de
// nivel, avisa en el canal correspondiente y asigna el rol de ese nivel
async function grantXpAndAnnounce(client, guild, userId, amount, config, fallbackChannelId) {
  const leveling = config.leveling;
  const result = await db.addXp(guild.id, userId, amount);
  if (!result.leveledUp) return result;

  const channelId = leveling.levelUpChannelId || fallbackChannelId;
  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        await channel.send(`🎉 <@${userId}> subió a **nivel ${result.level}**!`);
      }
    } catch (err) {
      console.error('No se pudo mandar el mensaje de subida de nivel:', err);
    }
  }

  const roleForLevel = (leveling.levelRoles || []).find((entry) => entry.level === result.level);
  if (roleForLevel) {
    try {
      const member = await guild.members.fetch(userId);
      await member.roles.add(roleForLevel.roleId);
    } catch (err) {
      console.error('No se pudo asignar el rol de nivel:', err);
    }
  }

  return result;
}

async function awardXp(message, config) {
  const leveling = config.leveling;
  if (!leveling || !leveling.enabled) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const cooldownMs = Math.max(0, leveling.cooldownSeconds || 0) * 1000;
  if (lastAward.has(key) && now - lastAward.get(key) < cooldownMs) return;
  lastAward.set(key, now);

  const min = Math.min(leveling.xpMin, leveling.xpMax);
  const max = Math.max(leveling.xpMin, leveling.xpMax);
  const amount = Math.floor(Math.random() * (max - min + 1)) + min;

  await grantXpAndAnnounce(message.client, message.guild, message.author.id, amount, config, message.channel.id);
}

async function handleNivelCommand(interaction, config) {
  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const info = await db.getUserLevel(interaction.guild.id, targetUser.id);

  try {
    const rank = await db.getUserRank(interaction.guild.id, targetUser.id);
    const card = await generateRankCard({
      username: targetUser.username,
      avatarURL: targetUser.displayAvatarURL({ extension: 'png', size: 256 }),
      level: info.level,
      xpIntoLevel: info.xpIntoLevel,
      xpForNextLevel: info.xpForNextLevel,
      rank,
      brandColor: config?.branding?.colors?.brand,
    });
    const attachment = new AttachmentBuilder(card, { name: 'rank.png' });
    await interaction.reply({ files: [attachment] });
  } catch (err) {
    // si la generacion de imagen falla por cualquier motivo (fuente, canvas
    // nativo, etc.), no se pierde el comando: se cae al embed de texto
    console.error('No se pudo generar la tarjeta de rango, usando embed de respaldo:', err);
    const embed = new EmbedBuilder()
      .setColor(resolveColor(config, 'brand'))
      .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
      .setTitle(`Nivel ${info.level}`)
      .setDescription(`${progressBar(info.xpIntoLevel, info.xpForNextLevel)}\n${info.xpIntoLevel} / ${info.xpForNextLevel} XP`);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleRankingCommand(interaction, config) {
  const top = await db.getLeaderboard(interaction.guild.id, 10);

  if (!top.length) {
    await interaction.reply('Todavía nadie tiene experiencia registrada.');
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((entry, index) => {
    const info = db.levelInfoFromXp(entry.xp);
    const prefix = medals[index] || `${index + 1}.`;
    return `${prefix} <@${entry.userId}> — nivel ${info.level} (${entry.xp} XP)`;
  });

  const embed = new EmbedBuilder().setColor(resolveColor(config, 'brand')).setTitle('🏆 Ranking de experiencia').setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed] });
}

module.exports = {
  nivelDefinition,
  rankingDefinition,
  awardXp,
  grantXpAndAnnounce,
  handleNivelCommand,
  handleRankingCommand,
};
