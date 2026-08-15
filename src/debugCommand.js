const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('./embedStyle');
const db = require('./db');
const pkg = require('../package.json');

const definition = new SlashCommandBuilder()
  .setName('debug')
  .setDescription('Info técnica del bot (solo staff)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}min`);
  return parts.join(' ');
}

async function handleDebugCommand(interaction) {
  const client = interaction.client;
  const mem = process.memoryUsage();
  const config = await db.getGuildConfig(interaction.guild.id);

  const embed = buildEmbed({
    type: 'brand',
    title: '🛠️ Debug',
    fields: [
      { name: 'Versión', value: pkg.version, inline: true },
      { name: 'Node', value: process.version, inline: true },
      { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
      { name: 'Uptime', value: formatUptime(client.uptime), inline: true },
      { name: 'Servers conectados', value: String(client.guilds.cache.size), inline: true },
      { name: 'Memoria (heap)', value: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`, inline: true },
      { name: 'ID de este server', value: interaction.guild.id },
    ],
    config,
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { definition, handleDebugCommand, formatUptime };
