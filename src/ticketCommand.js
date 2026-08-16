const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const db = require('./db');
const { resolveColor } = require('./embedStyle');

const TICKETS_CATEGORY_NAME = 'Tickets';
const CLOSE_BUTTON_ID = 'close-ticket';
const CLAIM_BUTTON_ID = 'claim-ticket';
const CATEGORY_SELECT_ID = 'ticket-category-select';
const RATE_PREFIX = 'ticket-rate:';

const definition = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Abre un canal privado para recibir ayuda del staff');

function slugify(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'usuario'
  );
}

async function findOrCreateTicketsCategory(guild) {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === TICKETS_CATEGORY_NAME,
  );
  if (existing) return existing;
  return guild.channels.create({ name: TICKETS_CATEGORY_NAME, type: ChannelType.GuildCategory });
}

// si el admin eligio una categoria de Discord desde el dashboard se usa esa;
// si no existe mas (borrada) o no eligio ninguna, se cae al comportamiento
// original de buscar/crear una categoria llamada "Tickets"
async function resolveTicketParentCategory(guild, config) {
  const categoryChannelId = config.ticketPanel?.categoryChannelId;
  if (categoryChannelId) {
    const chosen = await guild.channels.fetch(categoryChannelId).catch(() => null);
    if (chosen && chosen.type === ChannelType.GuildCategory) return chosen;
  }
  return findOrCreateTicketsCategory(guild);
}

function staffRoles(guild) {
  return guild.roles.cache.filter(
    (role) =>
      role.permissions.has(PermissionFlagsBits.ManageGuild) || role.permissions.has(PermissionFlagsBits.Administrator),
  );
}

function categorySelectRow(categories) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(CATEGORY_SELECT_ID)
    .setPlaceholder('Elegí un tipo de ticket')
    .addOptions(
      categories.slice(0, 25).map((cat) => ({
        label: cat.label.slice(0, 100),
        value: cat.id,
        description: (cat.description || '').slice(0, 100) || undefined,
        emoji: cat.emoji || undefined,
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

async function publishPanel(guild, config) {
  const panel = config.ticketPanel;
  if (!panel.channelId) throw new Error('No hay canal de panel configurado');

  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Canal inválido');

  if (panel.messageId) {
    try {
      const old = await channel.messages.fetch(panel.messageId);
      await old.delete();
    } catch {
      // ya no existe, sin problema
    }
  }

  const embed = new EmbedBuilder().setColor(resolveColor(config, 'brand')).setTitle(panel.title).setDescription(panel.description);
  const row = categorySelectRow(config.ticketCategories);

  const message = await channel.send({ embeds: [embed], components: [row] });
  return message.id;
}

async function createTicketChannel(interaction, config, categoryId) {
  const category = config.ticketCategories.find((c) => c.id === categoryId);
  if (!category) {
    await interaction.reply({ content: '⚠️ Esa categoría ya no existe.', ephemeral: true });
    return;
  }

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

  const parent = await resolveTicketParentCategory(guild, config);
  const staffRoleIds = category.staffRoleIds && category.staffRoleIds.length ? category.staffRoleIds : staffRoles(guild).map((r) => r.id);

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
    ...staffRoleIds.map((roleId) => ({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  const number = await db.getNextTicketNumber(guild.id);
  const paddedNumber = String(number).padStart(4, '0');

  const channel = await guild.channels.create({
    name: `ticket-${paddedNumber}-${slugify(interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites,
  });

  const created = await db.createTicket({
    guildId: guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    categoryId: category.id,
    categoryLabel: category.label,
    number,
  });

  if (!created) {
    // otra invocacion casi simultanea ya le abrio un ticket a este usuario;
    // borramos el canal huerfano que acabamos de crear en vez de duplicar
    await channel.delete().catch((err) => console.error('No se pudo borrar el canal de ticket duplicado:', err));
    await interaction.editReply({ content: '⚠️ Ya tenés un ticket abierto.' });
    return;
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CLAIM_BUTTON_ID).setLabel('Reclamar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Cerrar ticket').setStyle(ButtonStyle.Danger),
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(config, 'brand'))
    .setTitle(`Ticket #${paddedNumber} — ${category.label}`)
    .setDescription(category.description || 'Un miembro del staff te va a responder pronto.');

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [buttons] });
  await interaction.editReply({ content: `✅ Ticket creado: ${channel}` });
}

async function handleTicketCommand(interaction, config) {
  const categories = config.ticketCategories || [];
  if (!categories.length) {
    await interaction.reply({ content: '⚠️ No hay categorías de tickets configuradas.', ephemeral: true });
    return;
  }

  if (categories.length === 1) {
    await createTicketChannel(interaction, config, categories[0].id);
    return;
  }

  await interaction.reply({ components: [categorySelectRow(categories)], ephemeral: true });
}

async function handleCategorySelect(interaction, config) {
  if (interaction.customId !== CATEGORY_SELECT_ID) return;
  await createTicketChannel(interaction, config, interaction.values[0]);
}

async function handleClaimButton(interaction) {
  if (interaction.customId !== CLAIM_BUTTON_ID) return;

  const ticket = await db.getTicketByChannelId(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ No encontré este ticket en la base de datos.', ephemeral: true });
    return;
  }
  if (ticket.claimedBy) {
    await interaction.reply({ content: `⚠️ Ya lo reclamó <@${ticket.claimedBy}>.`, ephemeral: true });
    return;
  }

  await db.claimTicket({ channelId: interaction.channel.id, claimedBy: interaction.user.id });
  await interaction.reply(`🙋 <@${interaction.user.id}> reclamó este ticket.`);
}

async function buildTranscript(channel) {
  let allMessages = [];
  let before;

  for (let i = 0; i < 5; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    allMessages = allMessages.concat(Array.from(batch.values()));
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = allMessages.map((m) => {
    const time = new Date(m.createdTimestamp).toLocaleString('es-AR');
    const attachments = m.attachments.size ? ` [${m.attachments.size} archivo(s) adjunto(s)]` : '';
    return `[${time}] ${m.author.tag || m.author.username}: ${m.content}${attachments}`;
  });

  return lines.join('\n') || '(sin mensajes)';
}

async function handleCloseButton(interaction, config) {
  await interaction.reply({ content: '🔒 Cerrando el ticket en 5 segundos...' });

  const transcriptText = await buildTranscript(interaction.channel).catch(() => '(no se pudo generar la transcripción)');
  const ticket = await db.closeTicket({ channelId: interaction.channel.id, closedBy: interaction.user.id });

  if (config?.ticketTranscripts?.enabled && config.ticketTranscripts.channelId) {
    try {
      const logChannel = await interaction.client.channels.fetch(config.ticketTranscripts.channelId);
      if (logChannel && logChannel.isTextBased()) {
        const attachment = new AttachmentBuilder(Buffer.from(transcriptText, 'utf8'), {
          name: `ticket-${ticket ? String(ticket.number).padStart(4, '0') : interaction.channel.name}.txt`,
        });
        const embed = new EmbedBuilder()
          .setColor(resolveColor(config, 'brand'))
          .setTitle(`📄 Transcripción — ${interaction.channel.name}`)
          .addFields(
            { name: 'Usuario', value: ticket ? `<@${ticket.userId}>` : 'Desconocido', inline: true },
            { name: 'Cerrado por', value: `<@${interaction.user.id}>`, inline: true },
          );
        await logChannel.send({ embeds: [embed], files: [attachment] });
      }
    } catch (err) {
      console.error('No se pudo mandar la transcripción:', err);
    }
  }

  if (config?.ticketFeedback?.enabled && ticket) {
    try {
      const user = await interaction.client.users.fetch(ticket.userId);
      const stars = new ActionRowBuilder().addComponents(
        [1, 2, 3, 4, 5].map((n) =>
          new ButtonBuilder().setCustomId(`${RATE_PREFIX}${ticket._id}:${n}`).setLabel('⭐'.repeat(n)).setStyle(ButtonStyle.Secondary),
        ),
      );
      await user.send({ content: '¿Cómo calificarías la atención que recibiste en tu ticket?', components: [stars] });
    } catch (err) {
      console.error('No se pudo mandar la encuesta de satisfacción:', err.message);
    }
  }

  setTimeout(() => {
    interaction.channel.delete().catch((err) => console.error('No se pudo borrar el canal del ticket:', err));
  }, 5000);
}

async function handleRatingButton(interaction) {
  if (!interaction.customId.startsWith(RATE_PREFIX)) return;

  const [, ticketId, stars] = interaction.customId.split(':');
  await db.rateTicket(ticketId, Number(stars));
  await interaction.update({ content: `¡Gracias por tu calificación! ${'⭐'.repeat(Number(stars))}`, components: [] });
}

module.exports = {
  definition,
  publishPanel,
  handleTicketCommand,
  handleCategorySelect,
  handleClaimButton,
  handleCloseButton,
  handleRatingButton,
  CLOSE_BUTTON_ID,
  CLAIM_BUTTON_ID,
  CATEGORY_SELECT_ID,
  RATE_PREFIX,
  resolveTicketParentCategory,
};
