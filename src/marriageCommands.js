const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');

const ACCEPT_PREFIX = 'marry-accept:';
const REJECT_PREFIX = 'marry-reject:';

const casarDefinition = new SlashCommandBuilder()
  .setName('casar')
  .setDescription('Proponerle matrimonio a otro usuario')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Con quién querés casarte').setRequired(true));

const divorciarDefinition = new SlashCommandBuilder().setName('divorciar').setDescription('Terminar tu matrimonio actual');

const parejaDefinition = new SlashCommandBuilder()
  .setName('pareja')
  .setDescription('Ver con quién está casado un usuario')
  .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar'));

async function handleCasarCommand(interaction) {
  const target = interaction.options.getUser('usuario', true);

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: '❌ No podés casarte con vos mismo.', ephemeral: true });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: '❌ No podés casarte con un bot.', ephemeral: true });
    return;
  }

  const [proposerMarriage, targetMarriage] = await Promise.all([
    db.getMarriage(interaction.guild.id, interaction.user.id),
    db.getMarriage(interaction.guild.id, target.id),
  ]);

  if (proposerMarriage) {
    await interaction.reply({ content: '❌ Ya estás casado/a. Usá /divorciar primero.', ephemeral: true });
    return;
  }
  if (targetMarriage) {
    await interaction.reply({ content: `❌ <@${target.id}> ya está casado/a con otra persona.`, ephemeral: true });
    return;
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ACCEPT_PREFIX}${interaction.user.id}:${target.id}`)
      .setLabel('Aceptar 💍')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${REJECT_PREFIX}${interaction.user.id}:${target.id}`)
      .setLabel('Rechazar')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    content: `💍 <@${interaction.user.id}> le propone matrimonio a <@${target.id}>! ¿Aceptás?`,
    components: [buttons],
  });
}

async function handleMarriageButton(interaction) {
  const isAccept = interaction.customId.startsWith(ACCEPT_PREFIX);
  const isReject = interaction.customId.startsWith(REJECT_PREFIX);
  if (!isAccept && !isReject) return;

  const [, proposerId, targetId] = interaction.customId.split(':');

  if (interaction.user.id !== targetId) {
    await interaction.reply({ content: '❌ Esta propuesta no es para vos.', ephemeral: true });
    return;
  }

  if (isReject) {
    await interaction.update({ content: `💔 <@${targetId}> rechazó la propuesta de <@${proposerId}>.`, components: [] });
    return;
  }

  const [proposerMarriage, targetMarriage] = await Promise.all([
    db.getMarriage(interaction.guild.id, proposerId),
    db.getMarriage(interaction.guild.id, targetId),
  ]);

  if (proposerMarriage || targetMarriage) {
    await interaction.update({ content: '❌ Uno de los dos ya se casó con otra persona mientras tanto.', components: [] });
    return;
  }

  await db.createMarriage(interaction.guild.id, proposerId, targetId);
  await interaction.update({ content: `🎉 <@${proposerId}> y <@${targetId}> se casaron! 💍`, components: [] });
}

async function handleDivorciarCommand(interaction) {
  const marriage = await db.getMarriage(interaction.guild.id, interaction.user.id);
  if (!marriage) {
    await interaction.reply({ content: '❌ No estás casado/a.', ephemeral: true });
    return;
  }

  await db.deleteMarriage(interaction.guild.id, interaction.user.id);
  const partnerId = marriage.user1Id === interaction.user.id ? marriage.user2Id : marriage.user1Id;
  await interaction.reply(`💔 <@${interaction.user.id}> se divorció de <@${partnerId}>.`);
}

async function handleParejaCommand(interaction) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const marriage = await db.getMarriage(interaction.guild.id, target.id);

  if (!marriage) {
    await interaction.reply({ content: `<@${target.id}> no está casado/a.`, ephemeral: true });
    return;
  }

  const partnerId = marriage.user1Id === target.id ? marriage.user2Id : marriage.user1Id;
  const marriedDate = `<t:${Math.floor(new Date(marriage.marriedAt).getTime() / 1000)}:D>`;
  await interaction.reply(`💑 <@${target.id}> está casado/a con <@${partnerId}> desde ${marriedDate}.`);
}

module.exports = {
  casarDefinition,
  divorciarDefinition,
  parejaDefinition,
  handleCasarCommand,
  handleMarriageButton,
  handleDivorciarCommand,
  handleParejaCommand,
};
