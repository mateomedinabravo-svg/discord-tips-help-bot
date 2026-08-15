const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

const MODAL_ID = 'house-application';
const ACCEPT_PREFIX = 'house-accept:';
const REJECT_PREFIX = 'house-reject:';

const definition = new SlashCommandBuilder().setName('casa').setDescription('Solicitá tu propia House para mostrar tu trabajo');

async function handleCasaCommand(interaction, config) {
  if (!config?.houses?.enabled) {
    await interaction.reply({ content: '⚠️ Las solicitudes de House no están habilitadas en este server.', ephemeral: true });
    return;
  }

  const fields = (config.houses.formFields || []).slice(0, 5);
  if (!fields.length) {
    await interaction.reply({ content: '⚠️ El formulario no tiene campos configurados todavía.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('Solicitud de House');

  fields.forEach((label, index) => {
    const input = new TextInputBuilder()
      .setCustomId(`field_${index}`)
      .setLabel(label.slice(0, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });

  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction, config) {
  if (interaction.customId !== MODAL_ID) return;

  const fields = config.houses.formFields || [];
  const answers = {};
  fields.forEach((label, index) => {
    answers[label] = interaction.fields.getTextInputValue(`field_${index}`);
  });

  const applicationId = await db.createHouseApplication({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    answers,
  });

  if (config.houses.reviewChannelId) {
    try {
      const channel = await interaction.client.channels.fetch(config.houses.reviewChannelId);
      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🏠 Nueva solicitud de House')
          .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
          .addFields(Object.entries(answers).map(([label, value]) => ({ name: label, value: value.slice(0, 1024) })))
          .setFooter({ text: `Usuario: ${interaction.user.id}` })
          .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ACCEPT_PREFIX}${applicationId}`).setLabel('Aceptar').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${REJECT_PREFIX}${applicationId}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger),
        );

        await channel.send({ embeds: [embed], components: [buttons] });
      }
    } catch (err) {
      console.error('No se pudo publicar la solicitud de House:', err);
    }
  }

  await interaction.reply({ content: '✅ Tu solicitud fue enviada, te vamos a avisar por MD cuando se revise.', ephemeral: true });
}

async function handleDecisionButton(interaction, config) {
  const isAccept = interaction.customId.startsWith(ACCEPT_PREFIX);
  const isReject = interaction.customId.startsWith(REJECT_PREFIX);
  if (!isAccept && !isReject) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: '❌ No tenés permiso para decidir sobre esta solicitud.', ephemeral: true });
    return;
  }

  const applicationId = interaction.customId.slice(isAccept ? ACCEPT_PREFIX.length : REJECT_PREFIX.length);
  const status = isAccept ? 'accepted' : 'rejected';

  const application = await db.getHouseApplication(applicationId);
  if (!application) {
    await interaction.reply({ content: '⚠️ No encontré esa solicitud (puede que ya haya sido borrada).', ephemeral: true });
    return;
  }
  if (application.status !== 'pending') {
    await interaction.reply({ content: `⚠️ Esta solicitud ya fue ${application.status === 'accepted' ? 'aceptada' : 'rechazada'}.`, ephemeral: true });
    return;
  }

  await db.decideHouseApplication(applicationId, { status, decidedBy: interaction.user.id });

  const message = isAccept ? config.houses.acceptMessage : config.houses.rejectMessage;
  try {
    const user = await interaction.client.users.fetch(application.userId);
    await user.send(message);
  } catch (err) {
    console.error('No se pudo mandar el MD de resultado de House:', err.message);
  }

  const decisionLabel = isAccept ? '✅ Aceptada' : '❌ Rechazada';
  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = EmbedBuilder.from(originalEmbed)
    .setColor(isAccept ? 0x3ba55d : 0xed4245)
    .setFooter({ text: `${decisionLabel} por ${interaction.user.username}` });

  await interaction.update({ embeds: [updatedEmbed], components: [] });
}

module.exports = {
  definition,
  handleCasaCommand,
  handleModalSubmit,
  handleDecisionButton,
  MODAL_ID,
};
