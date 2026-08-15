const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SLOT_SYMBOLS = [
  { emoji: '🍒', weight: 30, multiplier3: 2 },
  { emoji: '🍋', weight: 25, multiplier3: 3 },
  { emoji: '🍇', weight: 20, multiplier3: 5 },
  { emoji: '💎', weight: 15, multiplier3: 10 },
  { emoji: '7️⃣', weight: 10, multiplier3: 20 },
];

const blackjackGames = new Map();

const definition = new SlashCommandBuilder()
  .setName('casino')
  .setDescription('Juegos con la moneda del server')
  .addSubcommand((sub) =>
    sub
      .setName('apostar')
      .setDescription('Cara o cruz, doble o nada')
      .addIntegerOption((opt) => opt.setName('cantidad').setDescription('Cuánto apostar').setRequired(true).setMinValue(1))
      .addStringOption((opt) =>
        opt
          .setName('eleccion')
          .setDescription('Cara o cruz')
          .setRequired(true)
          .addChoices({ name: 'Cara', value: 'cara' }, { name: 'Cruz', value: 'cruz' }),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('slots')
      .setDescription('Tragamonedas')
      .addIntegerOption((opt) => opt.setName('cantidad').setDescription('Cuánto apostar').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ruleta')
      .setDescription('Ruleta')
      .addIntegerOption((opt) => opt.setName('cantidad').setDescription('Cuánto apostar').setRequired(true).setMinValue(1))
      .addStringOption((opt) =>
        opt
          .setName('apuesta')
          .setDescription('Rojo, negro o número')
          .setRequired(true)
          .addChoices({ name: 'Rojo', value: 'rojo' }, { name: 'Negro', value: 'negro' }, { name: 'Número', value: 'numero' }),
      )
      .addIntegerOption((opt) => opt.setName('numero').setDescription('Número (0-36), solo si elegís "Número"').setMinValue(0).setMaxValue(36)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('blackjack')
      .setDescription('Blackjack contra el bot')
      .addIntegerOption((opt) => opt.setName('cantidad').setDescription('Cuánto apostar').setRequired(true).setMinValue(1)),
  );

function formatMoney(amount, config) {
  return `${amount} ${config.economy.currencySymbol}${config.economy.currencyName}`;
}

async function validateBet(interaction, config, amount) {
  if (!config?.casino?.enabled) {
    await interaction.reply({ content: '⚠️ El casino no está habilitado en este server.', ephemeral: true });
    return null;
  }
  if (!config?.economy?.enabled) {
    await interaction.reply({ content: '⚠️ La economía no está habilitada en este server.', ephemeral: true });
    return null;
  }
  if (amount < config.casino.minBet || amount > config.casino.maxBet) {
    await interaction.reply({
      content: `❌ La apuesta tiene que estar entre ${formatMoney(config.casino.minBet, config)} y ${formatMoney(config.casino.maxBet, config)}.`,
      ephemeral: true,
    });
    return null;
  }

  const account = await db.getEconomyAccount(interaction.guild.id, interaction.user.id);
  if (account.balance < amount) {
    await interaction.reply({ content: `❌ No tenés suficiente saldo (tenés ${formatMoney(account.balance, config)}).`, ephemeral: true });
    return null;
  }

  return account;
}

async function handleCasinoCommand(interaction, config) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'apostar':
      return handleCoinFlip(interaction, config);
    case 'slots':
      return handleSlots(interaction, config);
    case 'ruleta':
      return handleRoulette(interaction, config);
    case 'blackjack':
      return handleBlackjackStart(interaction, config);
    default:
      return null;
  }
}

async function handleCoinFlip(interaction, config) {
  const amount = interaction.options.getInteger('cantidad', true);
  const choice = interaction.options.getString('eleccion', true);
  if (!(await validateBet(interaction, config, amount))) return;

  const result = Math.random() < 0.5 ? 'cara' : 'cruz';
  const won = result === choice;

  await db.addBalance(interaction.guild.id, interaction.user.id, won ? amount : -amount);
  const emoji = result === 'cara' ? '🪙' : '🌀';
  await interaction.reply(
    won
      ? `${emoji} Salió **${result}**. ¡Ganaste ${formatMoney(amount, config)}!`
      : `${emoji} Salió **${result}**. Perdiste ${formatMoney(amount, config)}.`,
  );
}

function pickWeightedSymbol() {
  const totalWeight = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const symbol of SLOT_SYMBOLS) {
    if (roll < symbol.weight) return symbol;
    roll -= symbol.weight;
  }
  return SLOT_SYMBOLS[0];
}

async function handleSlots(interaction, config) {
  const amount = interaction.options.getInteger('cantidad', true);
  if (!(await validateBet(interaction, config, amount))) return;

  const reels = [pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()];
  const display = reels.map((s) => s.emoji).join(' | ');

  let winnings = -amount;
  let outcome = `Perdiste ${formatMoney(amount, config)}.`;

  if (reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji) {
    winnings = amount * reels[0].multiplier3;
    outcome = `¡Combo! Ganaste ${formatMoney(winnings, config)}.`;
  } else if (reels[0].emoji === reels[1].emoji || reels[1].emoji === reels[2].emoji || reels[0].emoji === reels[2].emoji) {
    winnings = 0;
    outcome = 'Dos iguales, recuperás tu apuesta.';
  }

  await db.addBalance(interaction.guild.id, interaction.user.id, winnings);
  await interaction.reply(`🎰 [ ${display} ]\n${outcome}`);
}

async function handleRoulette(interaction, config) {
  const amount = interaction.options.getInteger('cantidad', true);
  const bet = interaction.options.getString('apuesta', true);
  const number = interaction.options.getInteger('numero');

  if (bet === 'numero' && (number === null || number === undefined)) {
    await interaction.reply({ content: '❌ Elegiste apostar a un número pero no dijiste cuál.', ephemeral: true });
    return;
  }
  if (!(await validateBet(interaction, config, amount))) return;

  const result = Math.floor(Math.random() * 37); // 0-36
  const resultColor = result === 0 ? 'verde' : RED_NUMBERS.has(result) ? 'rojo' : 'negro';

  let winnings = -amount;
  if (bet === 'numero' && number === result) {
    winnings = amount * 35;
  } else if ((bet === 'rojo' || bet === 'negro') && bet === resultColor) {
    winnings = amount;
  }

  await db.addBalance(interaction.guild.id, interaction.user.id, winnings);
  const outcome = winnings > 0 ? `¡Ganaste ${formatMoney(winnings, config)}!` : `Perdiste ${formatMoney(amount, config)}.`;
  await interaction.reply(`🎡 Salió **${result} (${resultColor})**.\n${outcome}`);
}

// --- Blackjack ---

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function newShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces++;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function formatHand(cards) {
  return cards.map((c) => `${c.rank}${c.suit}`).join(' ');
}

function buildBlackjackEmbed(game, { reveal = false } = {}) {
  const playerTotal = handValue(game.playerCards);
  const dealerCards = reveal ? game.dealerCards : [game.dealerCards[0]];
  const dealerLabel = reveal ? `${formatHand(game.dealerCards)} (${handValue(game.dealerCards)})` : `${formatHand(dealerCards)} y una carta oculta`;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🃏 Blackjack')
    .addFields(
      { name: 'Tu mano', value: `${formatHand(game.playerCards)} (${playerTotal})` },
      { name: 'Mano del bot', value: dealerLabel },
    );
}

async function handleBlackjackStart(interaction, config) {
  const amount = interaction.options.getInteger('cantidad', true);
  if (!(await validateBet(interaction, config, amount))) return;

  await db.addBalance(interaction.guild.id, interaction.user.id, -amount);

  const deck = newShuffledDeck();
  const game = {
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    bet: amount,
    deck,
    playerCards: [deck.pop(), deck.pop()],
    dealerCards: [deck.pop(), deck.pop()],
  };

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj-hit').setLabel('Pedir carta').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj-stand').setLabel('Plantarse').setStyle(ButtonStyle.Secondary),
  );

  const playerBlackjack = handValue(game.playerCards) === 21;

  if (playerBlackjack) {
    const winnings = Math.floor(amount * 2.5);
    await db.addBalance(interaction.guild.id, interaction.user.id, winnings);
    const embed = buildBlackjackEmbed(game, { reveal: true }).setFooter({ text: `¡Blackjack! Ganaste ${formatMoney(winnings, config)}.` });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  await interaction.reply({ embeds: [buildBlackjackEmbed(game)], components: [buttons] });
  const reply = await interaction.fetchReply();
  blackjackGames.set(reply.id, game);
}

async function finishBlackjack(interaction, game, config) {
  let dealerTotal = handValue(game.dealerCards);
  while (dealerTotal < 17) {
    game.dealerCards.push(game.deck.pop());
    dealerTotal = handValue(game.dealerCards);
  }

  const playerTotal = handValue(game.playerCards);
  let outcome;
  let winnings;

  if (dealerTotal > 21 || playerTotal > dealerTotal) {
    winnings = game.bet * 2;
    outcome = `¡Ganaste ${formatMoney(winnings, config)}!`;
  } else if (playerTotal === dealerTotal) {
    winnings = game.bet;
    outcome = 'Empate, recuperás tu apuesta.';
  } else {
    winnings = 0;
    outcome = `Perdiste ${formatMoney(game.bet, config)}.`;
  }

  if (winnings > 0) await db.addBalance(game.guildId, game.userId, winnings);

  const embed = buildBlackjackEmbed(game, { reveal: true }).setFooter({ text: outcome });
  await interaction.update({ embeds: [embed], components: [] });
}

async function handleBlackjackButton(interaction, config) {
  if (interaction.customId !== 'bj-hit' && interaction.customId !== 'bj-stand') return;

  const game = blackjackGames.get(interaction.message.id);
  if (!game) {
    await interaction.reply({ content: '⚠️ Esta partida ya terminó.', ephemeral: true });
    return;
  }
  if (game.userId !== interaction.user.id) {
    await interaction.reply({ content: '❌ Esta no es tu partida.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'bj-hit') {
    game.playerCards.push(game.deck.pop());
    const total = handValue(game.playerCards);

    if (total > 21) {
      blackjackGames.delete(interaction.message.id);
      const embed = buildBlackjackEmbed(game, { reveal: true }).setFooter({ text: `Te pasaste. Perdiste ${formatMoney(game.bet, config)}.` });
      await interaction.update({ embeds: [embed], components: [] });
      return;
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bj-hit').setLabel('Pedir carta').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('bj-stand').setLabel('Plantarse').setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [buildBlackjackEmbed(game)], components: [buttons] });
    return;
  }

  blackjackGames.delete(interaction.message.id);
  await finishBlackjack(interaction, game, config);
}

module.exports = { definition, handleCasinoCommand, handleBlackjackButton };
