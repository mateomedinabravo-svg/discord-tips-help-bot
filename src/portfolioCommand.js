const { SlashCommandBuilder } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const definition = new SlashCommandBuilder()
  .setName('portfolio')
  .setDescription('Muestra el portfolio de un miembro: sus posts más destacados, roles y nivel')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar (por defecto, vos)'));

async function handlePortfolioCommand(interaction, config) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply('Este comando solo funciona dentro de un server.');
    return;
  }

  const member = await guild.members.fetch(target.id).catch(() => null);

  const topPosts = config?.starboard?.enabled ? await db.getTopStarredPostsByAuthor(guild.id, target.id, 3) : [];
  const postsText = topPosts.length
    ? topPosts
        .map((p, i) => {
          const emoji = config?.starboard?.emoji || '⭐';
          const link = `https://discord.com/channels/${guild.id}/${p.originalChannelId}/${p.originalMessageId}`;
          return `${i + 1}. ${emoji} **${p.starCount}** — ${link}`;
        })
        .join('\n')
    : config?.starboard?.enabled
      ? '(todavía no tiene posts destacados en el starboard)'
      : '(el starboard no está activado en este server)';

  const roleNames = member
    ? member.roles.cache
        .filter((r) => r.id !== guild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map((r) => r.name)
        .slice(0, 8)
    : [];

  const fields = [
    { name: 'Posts destacados (starboard)', value: postsText, inline: false },
    { name: 'Roles', value: roleNames.length ? roleNames.join(', ') : '(sin roles)', inline: false },
  ];

  if (config?.leveling?.enabled) {
    const levelInfo = await db.getUserLevel(guild.id, target.id);
    fields.push({ name: 'Nivel', value: `Nivel ${levelInfo.level} (${levelInfo.xp} XP totales)`, inline: true });
  }

  if (member?.joinedAt) {
    fields.push({ name: 'Miembro desde', value: member.joinedAt.toLocaleDateString('es-AR'), inline: true });
  }

  const embed = buildEmbed({
    type: 'brand',
    title: `🎨 Portfolio de ${member?.displayName || target.username}`,
    thumbnail: target.displayAvatarURL(),
    fields,
    config,
  });

  await interaction.reply({ embeds: [embed] });
}

module.exports = { definition, handlePortfolioCommand };
