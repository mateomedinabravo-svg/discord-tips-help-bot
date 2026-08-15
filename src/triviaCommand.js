const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const LETTERS = ['A', 'B', 'C', 'D'];
const TIME_LIMIT_MS = 20000;
const activeGames = new Map();

const definition = new SlashCommandBuilder().setName('trivia').setDescription('Una pregunta de trivia, el primero en acertar gana monedas');

function buildQuestionEmbed(config, game, { revealed = false, winnerId = null } = {}) {
  const optionsText = game.options.map((opt, i) => `**${LETTERS[i]}.** ${opt}`).join('\n');

  const embed = buildEmbed({
    type: revealed ? (winnerId ? 'success' : 'warning') : 'brand',
    title: '🧠 Trivia',
    description: `${game.question}\n\n${optionsText}`,
    footer: revealed
      ? winnerId
        ? `Ganó ${LETTERS[game.correctIndex]} — respondida correctamente`
        : `Se acabó el tiempo. La respuesta era ${LETTERS[game.correctIndex]}`
      : `Tenés ${TIME_LIMIT_MS / 1000} segundos para responder`,
  });

  return embed;
}

function buildOptionButtons(options, disabled = false) {
  const row = new ActionRowBuilder().addComponents(
    options.map((_, i) =>
      new ButtonBuilder().setCustomId(`trivia-opt-${i}`).setLabel(LETTERS[i]).setStyle(ButtonStyle.Primary).setDisabled(disabled),
    ),
  );
  return row;
}

async function handleTriviaCommand(interaction, config) {
  if (!config?.trivia?.enabled) {
    await interaction.reply({ content: '⚠️ La trivia no está habilitada en este server.', ephemeral: true });
    return;
  }

  const questions = config.trivia.questions || [];
  if (!questions.length) {
    await interaction.reply({ content: '⚠️ No hay preguntas cargadas todavía.', ephemeral: true });
    return;
  }

  const picked = questions[Math.floor(Math.random() * questions.length)];
  const game = {
    guildId: interaction.guild.id,
    question: picked.question,
    options: picked.options,
    correctIndex: picked.correctIndex,
    reward: config.trivia.rewardAmount,
    answered: false,
  };

  await interaction.reply({
    embeds: [buildQuestionEmbed(config, game)],
    components: [buildOptionButtons(game.options)],
  });
  const message = await interaction.fetchReply();

  const timeout = setTimeout(async () => {
    if (!activeGames.has(message.id)) return;
    activeGames.delete(message.id);
    try {
      await message.edit({
        embeds: [buildQuestionEmbed(config, game, { revealed: true, winnerId: null })],
        components: [buildOptionButtons(game.options, true)],
      });
    } catch (err) {
      console.error('No se pudo cerrar la trivia por tiempo:', err);
    }
  }, TIME_LIMIT_MS);

  activeGames.set(message.id, { ...game, timeout });
}

async function handleTriviaButton(interaction, config) {
  if (!interaction.customId.startsWith('trivia-opt-')) return;

  const game = activeGames.get(interaction.message.id);
  if (!game || game.answered) {
    await interaction.reply({ content: '⚠️ Esta trivia ya terminó.', ephemeral: true });
    return;
  }

  const chosenIndex = Number(interaction.customId.replace('trivia-opt-', ''));
  if (chosenIndex !== game.correctIndex) {
    await interaction.reply({ content: '❌ Incorrecto, probá de nuevo.', ephemeral: true });
    return;
  }

  game.answered = true;
  clearTimeout(game.timeout);
  activeGames.delete(interaction.message.id);

  await db.addBalance(game.guildId, interaction.user.id, game.reward);

  await interaction.update({
    embeds: [buildQuestionEmbed(config, game, { revealed: true, winnerId: interaction.user.id })],
    components: [buildOptionButtons(game.options, true)],
  });

  await interaction.followUp(`🎉 <@${interaction.user.id}> acertó y ganó ${game.reward} ${config.economy.currencySymbol}${config.economy.currencyName}!`);
}

module.exports = { definition, handleTriviaCommand, handleTriviaButton };
