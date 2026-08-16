const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const VOTE_BUTTON_PREFIX = 'poll-vote:';
const OPTION_EMOJI = ['🇦', '🇧', '🇨', '🇩', '🇪'];
const BAR_LENGTH = 12;

const definition = new SlashCommandBuilder()
  .setName('encuesta')
  .setDescription('Crea una encuesta con hasta 5 opciones')
  .addStringOption((opt) => opt.setName('pregunta').setDescription('La pregunta de la encuesta').setRequired(true))
  .addStringOption((opt) => opt.setName('opcion1').setDescription('Opción 1').setRequired(true))
  .addStringOption((opt) => opt.setName('opcion2').setDescription('Opción 2').setRequired(true))
  .addStringOption((opt) => opt.setName('opcion3').setDescription('Opción 3 (opcional)'))
  .addStringOption((opt) => opt.setName('opcion4').setDescription('Opción 4 (opcional)'))
  .addStringOption((opt) => opt.setName('opcion5').setDescription('Opción 5 (opcional)'));

function buildResultsBar(count, total) {
  const ratio = total > 0 ? count / total : 0;
  const filled = Math.round(ratio * BAR_LENGTH);
  return '🟦'.repeat(filled) + '⬜'.repeat(BAR_LENGTH - filled);
}

function buildPollEmbed(poll, config) {
  const votesByOption = poll.options.map((_, i) => Object.values(poll.votes || {}).filter((v) => v === i).length);
  const total = votesByOption.reduce((a, b) => a + b, 0);

  const lines = poll.options.map((opt, i) => {
    const count = votesByOption[i];
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `${OPTION_EMOJI[i]} **${opt}**\n${buildResultsBar(count, total)} ${count} (${pct}%)`;
  });

  return buildEmbed({
    type: 'brand',
    title: `📊 ${poll.question}`,
    description: lines.join('\n\n'),
    footer: `${total} voto(s) en total`,
    config,
  });
}

function buildOptionButtons(options) {
  return new ActionRowBuilder().addComponents(
    options.map((opt, i) =>
      new ButtonBuilder()
        .setCustomId(`${VOTE_BUTTON_PREFIX}${i}`)
        .setLabel(`${OPTION_EMOJI[i]} ${opt}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
    ),
  );
}

async function handlePollCommand(interaction, config) {
  const question = interaction.options.getString('pregunta', true);
  const options = [];
  for (let i = 1; i <= 5; i++) {
    const opt = interaction.options.getString(`opcion${i}`);
    if (opt) options.push(opt);
  }

  const draft = { question, options, votes: {}, hostId: interaction.user.id };

  await interaction.reply({ embeds: [buildPollEmbed(draft, config)], components: [buildOptionButtons(options)] });
  const message = await interaction.fetchReply();

  await db.createPoll({
    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    messageId: message.id,
    question,
    options,
    hostId: interaction.user.id,
  });
}

async function handleVoteButton(interaction, config) {
  if (!interaction.customId.startsWith(VOTE_BUTTON_PREFIX)) return;

  const optionIndex = Number(interaction.customId.slice(VOTE_BUTTON_PREFIX.length));
  const poll = await db.setPollVote(interaction.message.id, interaction.user.id, optionIndex);

  if (!poll) {
    await interaction.reply({ content: '⚠️ Esta encuesta ya no existe.', ephemeral: true });
    return;
  }

  await interaction.update({ embeds: [buildPollEmbed(poll, config)] });
}

module.exports = { definition, VOTE_BUTTON_PREFIX, handlePollCommand, handleVoteButton };
