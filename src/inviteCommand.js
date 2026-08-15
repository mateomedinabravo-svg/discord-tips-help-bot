const { SlashCommandBuilder } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const definition = new SlashCommandBuilder()
  .setName('invitaciones')
  .setDescription('Sistema de invitaciones')
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Ver cuántas invitaciones tiene alguien')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar')),
  )
  .addSubcommand((sub) => sub.setName('ranking').setDescription('Top 10 de invitaciones del server'));

async function handleVer(interaction, config) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const count = await db.countInvitesByUser(interaction.guild.id, target.id);
  await interaction.reply(`📨 <@${target.id}> tiene **${count}** invitación(es) confirmada(s).`);
}

async function handleRanking(interaction, config) {
  const top = await db.getInviteLeaderboard(interaction.guild.id, 10);

  if (!top.length) {
    await interaction.reply('Todavía nadie invitó a alguien que se pueda rastrear.');
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((entry, index) => {
    const prefix = medals[index] || `${index + 1}.`;
    return `${prefix} <@${entry._id}> — ${entry.count} invitación(es)`;
  });

  const embed = buildEmbed({ type: 'brand', title: '🏆 Ranking de invitaciones', description: lines.join('\n'), config });
  await interaction.reply({ embeds: [embed] });
}

async function handleInviteCommand(interaction, config) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'ver') return handleVer(interaction, config);
  if (sub === 'ranking') return handleRanking(interaction, config);
}

module.exports = { definition, handleInviteCommand };
