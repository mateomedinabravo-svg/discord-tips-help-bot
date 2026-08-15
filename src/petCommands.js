const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { resolveColor } = require('./embedStyle');

const SPECIES_EMOJI = { perro: '🐶', gato: '🐱', dragon: '🐲', conejo: '🐰', pajaro: '🐦' };

const definition = new SlashCommandBuilder()
  .setName('mascota')
  .setDescription('Tu mascota virtual')
  .addSubcommand((sub) =>
    sub
      .setName('adoptar')
      .setDescription('Adoptar una mascota nueva')
      .addStringOption((opt) => opt.setName('nombre').setDescription('Nombre de tu mascota').setRequired(true).setMaxLength(32))
      .addStringOption((opt) =>
        opt
          .setName('especie')
          .setDescription('Especie')
          .setRequired(true)
          .addChoices(
            { name: 'Perro', value: 'perro' },
            { name: 'Gato', value: 'gato' },
            { name: 'Dragón', value: 'dragon' },
            { name: 'Conejo', value: 'conejo' },
            { name: 'Pájaro', value: 'pajaro' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Ver tu mascota o la de otro usuario')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar')),
  )
  .addSubcommand((sub) => sub.setName('alimentar').setDescription('Darle de comer a tu mascota'))
  .addSubcommand((sub) => sub.setName('jugar').setDescription('Jugar con tu mascota'));

function bar(value) {
  const filled = Math.round((value / 100) * 10);
  return '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
}

function formatRemaining(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

async function handlePetCommand(interaction, config) {
  if (!config?.pets?.enabled) {
    await interaction.reply({ content: '⚠️ Las mascotas no están habilitadas en este server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'adoptar':
      return handleAdopt(interaction);
    case 'ver':
      return handleView(interaction, config);
    case 'alimentar':
      return handleFeed(interaction, config);
    case 'jugar':
      return handlePlay(interaction, config);
    default:
      return null;
  }
}

async function handleAdopt(interaction) {
  const existing = await db.getPet(interaction.guild.id, interaction.user.id);
  if (existing) {
    await interaction.reply({ content: `❌ Ya tenés una mascota: ${existing.name}.`, ephemeral: true });
    return;
  }

  const name = interaction.options.getString('nombre', true);
  const species = interaction.options.getString('especie', true);
  await db.createPet(interaction.guild.id, interaction.user.id, { name, species });

  await interaction.reply(`${SPECIES_EMOJI[species] || '🐾'} ¡Adoptaste a **${name}**! Usá /mascota alimentar y /mascota jugar para cuidarla.`);
}

function buildPetEmbed(pet, ownerUsername, config) {
  const levelInfo = db.petLevelInfoFromXp(pet.xp);
  return new EmbedBuilder()
    .setColor(resolveColor(config, 'brand'))
    .setTitle(`${SPECIES_EMOJI[pet.species] || '🐾'} ${pet.name}`)
    .setDescription(`Mascota de ${ownerUsername}`)
    .addFields(
      { name: 'Nivel', value: `${levelInfo.level} (${levelInfo.xpIntoLevel}/${levelInfo.xpForNextLevel} XP)` },
      { name: 'Hambre', value: bar(pet.hunger) },
      { name: 'Felicidad', value: bar(pet.happiness) },
    );
}

async function handleView(interaction, config) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const pet = await db.getPet(interaction.guild.id, target.id);

  if (!pet) {
    await interaction.reply({ content: `<@${target.id}> todavía no tiene mascota.`, ephemeral: true });
    return;
  }

  await interaction.reply({ embeds: [buildPetEmbed(pet, target.username, config)] });
}

async function handleFeed(interaction, config) {
  const pet = await db.getPet(interaction.guild.id, interaction.user.id);
  if (!pet) {
    await interaction.reply({ content: '❌ No tenés mascota. Usá /mascota adoptar primero.', ephemeral: true });
    return;
  }

  const cooldownMs = config.pets.feedCooldownMinutes * 60 * 1000;
  const now = Date.now();
  if (pet.lastFed && now - new Date(pet.lastFed).getTime() < cooldownMs) {
    const remaining = cooldownMs - (now - new Date(pet.lastFed).getTime());
    await interaction.reply({ content: `⏳ ${pet.name} todavía no tiene hambre. Volvé en ${formatRemaining(remaining)}.`, ephemeral: true });
    return;
  }

  await db.updatePet(interaction.guild.id, interaction.user.id, {
    hunger: Math.min(100, pet.hunger + 25),
    xp: pet.xp + 10,
    lastFed: new Date(),
  });

  await interaction.reply(`🍖 Alimentaste a **${pet.name}**!`);
}

async function handlePlay(interaction, config) {
  const pet = await db.getPet(interaction.guild.id, interaction.user.id);
  if (!pet) {
    await interaction.reply({ content: '❌ No tenés mascota. Usá /mascota adoptar primero.', ephemeral: true });
    return;
  }

  const cooldownMs = config.pets.playCooldownMinutes * 60 * 1000;
  const now = Date.now();
  if (pet.lastPlayed && now - new Date(pet.lastPlayed).getTime() < cooldownMs) {
    const remaining = cooldownMs - (now - new Date(pet.lastPlayed).getTime());
    await interaction.reply({ content: `⏳ ${pet.name} está cansada. Volvé en ${formatRemaining(remaining)}.`, ephemeral: true });
    return;
  }

  await db.updatePet(interaction.guild.id, interaction.user.id, {
    happiness: Math.min(100, pet.happiness + 25),
    xp: pet.xp + 10,
    lastPlayed: new Date(),
  });

  await interaction.reply(`🎾 Jugaste con **${pet.name}**!`);
}

module.exports = { definition, handlePetCommand };
