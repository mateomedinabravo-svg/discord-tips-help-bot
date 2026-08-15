const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('./db');

const TICKETS_CATEGORY_NAME = 'Tickets';
const CLOSE_BUTTON_ID = 'close-ticket';

const definition = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Abre un canal privado para recibir ayuda del staff')
  .addStringOption((opt) => opt.setName('motivo').setDescription('Contanos brevemente que necesitas (opcional)'));

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'usuario';
}

async function findOrCreateTicketsCategory(guild) {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === TICKETS_CATEGORY_NAME,
  );
  if (existing) return existing;
  return guild.channels.create({ name: TICKETS_CATEGORY_NAME, type: ChannelType.GuildCategory });
}

function staffRoles(guild) {
  return guild.roles.cache.filter(
    (role) =>
      role.permissions.has(PermissionFlagsBits.ManageGuild) || role.permissions.has(PermissionFlagsBits.Administrator),
  );
}

async function handleTicketCommand(interaction) {
  const guild = interaction.guild;
  const existingTickets = await db.listTickets(guild.id, 'open');
  const alreadyOpen = existingTickets.find((t) => t.userId === interaction.user.id);

  if (alreadyOpen) {
    await interaction.reply({
      content: `⚠️ Ya tenés un ticket abierto: <#${alreadyOpen.channelId}>`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const category = await findOrCreateTicketsCategory(guild);
  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
    },
    ...staffRoles(guild).map((role) => ({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  const channel = await guild.channels.create({
    name: `ticket-${slugify(interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites,
  });

  await db.createTicket({ guildId: guild.id, channelId: channel.id, userId: interaction.user.id });

  const motivo = interaction.options.getString('motivo');
  const closeButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Cerrar ticket').setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: `👋 <@${interaction.user.id}> abrió este ticket.${motivo ? `\n**Motivo:** ${motivo}` : ''}\nUn miembro del staff te va a responder pronto.`,
    components: [closeButton],
  });

  await interaction.editReply({ content: `✅ Ticket creado: ${channel}` });
}

async function handleCloseButton(interaction) {
  if (interaction.customId !== CLOSE_BUTTON_ID) return;

  await interaction.reply({ content: '🔒 Cerrando el ticket en 5 segundos...' });
  await db.closeTicket({ channelId: interaction.channel.id, closedBy: interaction.user.id });

  setTimeout(() => {
    interaction.channel.delete().catch((err) => console.error('No se pudo borrar el canal del ticket:', err));
  }, 5000);
}

module.exports = { definition, handleTicketCommand, handleCloseButton, CLOSE_BUTTON_ID };
