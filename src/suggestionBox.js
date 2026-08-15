const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const VOTE_UP_ID = 'suggestion-vote-up';
const VOTE_DOWN_ID = 'suggestion-vote-down';
const APPROVE_ID = 'suggestion-approve';
const REJECT_ID = 'suggestion-reject';

const STATUS_LABEL = { pending: '🟡 Pendiente', approved: '✅ Aprobada', rejected: '❌ Rechazada' };

function tally(votes) {
  const values = Object.values(votes || {});
  return {
    up: values.filter((v) => v === 1).length,
    down: values.filter((v) => v === -1).length,
  };
}

function canDecide(member, config) {
  const approvalRoleIds = config?.suggestions?.approvalRoleIds || [];
  if (!approvalRoleIds.length) return member.permissions.has(PermissionFlagsBits.ManageGuild);
  return member.roles.cache.some((role) => approvalRoleIds.includes(role.id));
}

function buildSuggestionEmbed(suggestion, config) {
  const { up, down } = tally(suggestion.votes);
  const decided = suggestion.status !== 'pending';

  return buildEmbed({
    type: suggestion.status === 'approved' ? 'success' : suggestion.status === 'rejected' ? 'error' : 'brand',
    author: config.suggestions.anonymous ? undefined : { name: suggestion.authorTag, iconURL: suggestion.authorAvatar },
    description: suggestion.content,
    fields: [
      { name: 'Estado', value: STATUS_LABEL[suggestion.status], inline: true },
      { name: 'Votos', value: `👍 ${up}  👎 ${down}`, inline: true },
    ],
    footer: decided ? `${STATUS_LABEL[suggestion.status]} por ${suggestion.staffTag}` : 'Vota con los botones de abajo',
    config,
  });
}

function buildButtons({ disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VOTE_UP_ID).setLabel('👍').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(VOTE_DOWN_ID).setLabel('👎').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(APPROVE_ID).setLabel('Aprobar').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(REJECT_ID).setLabel('Rechazar').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

async function handleSuggestionMessage(message, config) {
  const suggestions = config?.suggestions;
  if (!suggestions?.enabled || !suggestions.channelId || message.channel.id !== suggestions.channelId) return false;
  if (message.author.bot) return false;

  const content = message.content.trim();
  if (!content) return false;

  const draft = {
    content,
    status: 'pending',
    votes: {},
    authorTag: suggestions.anonymous ? 'Anónimo' : message.author.username,
    authorAvatar: message.author.displayAvatarURL(),
  };

  try {
    const posted = await message.channel.send({ embeds: [buildSuggestionEmbed(draft, config)], components: [buildButtons()] });

    await db.createSuggestion({
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: posted.id,
      authorId: message.author.id,
      authorTag: message.author.username,
      authorAvatar: message.author.displayAvatarURL(),
      content,
    });

    await message.delete().catch(() => {});
  } catch (err) {
    console.error('No se pudo publicar la sugerencia:', err);
  }

  return true;
}

async function handleVoteButton(interaction, config) {
  const value = interaction.customId === VOTE_UP_ID ? 1 : -1;
  const suggestion = await db.getSuggestion(interaction.message.id);

  if (!suggestion || suggestion.status !== 'pending') {
    await interaction.reply({ content: '⚠️ Esta sugerencia ya no está abierta a votos.', ephemeral: true });
    return;
  }

  const current = suggestion.votes?.[interaction.user.id];
  const updated =
    current === value
      ? await db.removeSuggestionVote(interaction.message.id, interaction.user.id)
      : await db.setSuggestionVote(interaction.message.id, interaction.user.id, value);

  await interaction.update({ embeds: [buildSuggestionEmbed(updated, config)] });
}

async function handleDecisionButton(interaction, config) {
  if (!canDecide(interaction.member, config)) {
    await interaction.reply({ content: '❌ No tenés permiso para decidir sobre sugerencias.', ephemeral: true });
    return;
  }

  const suggestion = await db.getSuggestion(interaction.message.id);
  if (!suggestion || suggestion.status !== 'pending') {
    await interaction.reply({ content: '⚠️ Esta sugerencia ya fue decidida.', ephemeral: true });
    return;
  }

  const status = interaction.customId === APPROVE_ID ? 'approved' : 'rejected';
  const updated = await db.setSuggestionStatus(interaction.message.id, status, interaction.user.id, interaction.user.username);

  await interaction.update({ embeds: [buildSuggestionEmbed(updated, config)], components: [buildButtons({ disabled: true })] });
}

module.exports = {
  VOTE_UP_ID,
  VOTE_DOWN_ID,
  APPROVE_ID,
  REJECT_ID,
  handleSuggestionMessage,
  handleVoteButton,
  handleDecisionButton,
};
