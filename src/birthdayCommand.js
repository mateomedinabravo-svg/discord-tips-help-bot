const { SlashCommandBuilder } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const definition = new SlashCommandBuilder()
  .setName('cumpleanos')
  .setDescription('Sistema de cumpleaños')
  .addSubcommand((sub) =>
    sub
      .setName('configurar')
      .setDescription('Cargá tu fecha de cumpleaños (sin año)')
      .addIntegerOption((opt) => opt.setName('dia').setDescription('Día (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption((opt) => opt.setName('mes').setDescription('Mes (1-12)').setRequired(true).setMinValue(1).setMaxValue(12)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Ver el cumpleaños de alguien')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar')),
  );

async function handleConfigurar(interaction) {
  const day = interaction.options.getInteger('dia', true);
  const month = interaction.options.getInteger('mes', true);

  if (day > DAYS_IN_MONTH[month - 1]) {
    await interaction.reply({ content: `❌ Ese día no existe en ${MONTH_NAMES[month - 1]}.`, ephemeral: true });
    return;
  }

  await db.setBirthday(interaction.guild.id, interaction.user.id, day, month);
  await interaction.reply({ content: `✅ Guardé tu cumpleaños: ${day} de ${MONTH_NAMES[month - 1]}.`, ephemeral: true });
}

async function handleVer(interaction) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  const birthday = await db.getBirthday(interaction.guild.id, target.id);

  if (!birthday) {
    await interaction.reply({ content: `<@${target.id}> todavía no cargó su cumpleaños.`, ephemeral: true });
    return;
  }

  await interaction.reply(`🎂 El cumpleaños de <@${target.id}> es el ${birthday.day} de ${MONTH_NAMES[birthday.month - 1]}.`);
}

async function handleBirthdayCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'configurar') return handleConfigurar(interaction);
  if (sub === 'ver') return handleVer(interaction);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

async function checkBirthdaysToday(client, configByGuild) {
  const now = new Date();
  const day = now.getUTCDate();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();

  const birthdays = await db.getBirthdaysForToday(day, month);

  // en años no bisiestos el 29 de febrero nunca coincide con "hoy"; sin esto
  // esos cumpleaños no se anuncian nunca, asi que los festejamos el 1 de marzo
  if (month === 3 && day === 1 && !isLeapYear(year)) {
    birthdays.push(...(await db.getBirthdaysForToday(29, 2)));
  }

  for (const b of birthdays) {
    if (b.lastAnnouncedYear === year) continue;

    const config = configByGuild.get(b.guildId);
    const settings = config?.birthdays;
    if (!settings?.enabled || !settings.channelId) continue;

    try {
      const channel = await client.channels.fetch(settings.channelId);
      if (channel && channel.isTextBased()) {
        const text = settings.message.replace(/\{user\}/g, `<@${b.userId}>`);
        const embed = buildEmbed({ type: 'success', title: '🎂 ¡Feliz cumpleaños!', description: text, config });
        await channel.send({ embeds: [embed] });
      }
      await db.markBirthdayAnnounced(b.guildId, b.userId, year);
    } catch (err) {
      console.error(`No se pudo anunciar el cumpleaños de ${b.userId} en ${b.guildId}:`, err);
    }
  }
}

module.exports = { definition, handleBirthdayCommand, checkBirthdaysToday };
