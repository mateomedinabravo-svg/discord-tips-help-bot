const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const RESERVED_NAMES = [
  'anuncio',
  'ticket',
  'nivel',
  'ranking',
  'ban',
  'kick',
  'mute',
  'warn',
  'warnings',
  'casa',
  'economia',
  'casino',
  'casar',
  'divorciar',
  'pareja',
  'mascota',
];
const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

const lastUse = new Map();

function validateCommandName(name) {
  if (!NAME_PATTERN.test(name)) {
    return 'El nombre solo puede tener minúsculas, números, "-" y "_", sin espacios (1 a 32 caracteres).';
  }
  if (RESERVED_NAMES.includes(name)) {
    return `"${name}" ya es un comando del bot, elegí otro nombre.`;
  }
  return null;
}

function buildCustomCommandDefinition(cmd) {
  const builder = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description.slice(0, 100));
  if (cmd.adminOnly) {
    builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  }
  return builder;
}

async function registerGuildCommands(guild, config, staticDefinitions) {
  const customDefinitions = (config.customCommands || []).map((cmd) => buildCustomCommandDefinition(cmd).toJSON());
  await guild.commands.set([...staticDefinitions, ...customDefinitions]);
}

function findCustomCommand(config, name) {
  return (config.customCommands || []).find((cmd) => cmd.name === name);
}

function formatResponse(template, interaction) {
  return template.replace(/\{user\}/g, `<@${interaction.user.id}>`);
}

async function handleCustomCommand(interaction, config, command) {
  if (command.adminOnly) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ No tenés permiso para usar este comando.', ephemeral: true });
      return;
    }
    await interaction.reply(formatResponse(command.response, interaction));
    return;
  }

  const cooldownSeconds = Math.max(0, command.cooldownSeconds || 0);
  const key = `${interaction.guild.id}:${interaction.user.id}:${command.name}`;
  const now = Date.now();
  const cooldownMs = cooldownSeconds * 1000;

  if (lastUse.has(key) && now - lastUse.get(key) < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastUse.get(key))) / 1000);
    await interaction.reply({ content: `⏳ Esperá ${remaining}s antes de volver a usar este comando.`, ephemeral: true });
    return;
  }

  lastUse.set(key, now);
  await interaction.reply(formatResponse(command.response, interaction));
}

module.exports = {
  validateCommandName,
  buildCustomCommandDefinition,
  registerGuildCommands,
  findCustomCommand,
  handleCustomCommand,
};
