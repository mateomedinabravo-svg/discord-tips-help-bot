const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { buildEmbed } = require('./embedStyle');

const definition = new SlashCommandBuilder().setName('infoserver').setDescription('Muestra información real del server');

// nombres presentables para las features de Discord que le interesan a la
// mayoria de los admins de server (guild.features trae muchas mas, internas
// o poco relevantes, que se ignoran a proposito para no saturar el embed)
const FEATURE_LABELS = {
  COMMUNITY: 'Comunidad habilitada',
  NEWS: 'Canales de anuncios',
  VANITY_URL: 'Link de invitación personalizado',
  PARTNERED: 'Server Partner de Discord',
  VERIFIED: 'Server verificado',
  DISCOVERABLE: 'Aparece en Discovery',
  BANNER: 'Banner de server',
  ANIMATED_ICON: 'Ícono animado',
  ANIMATED_BANNER: 'Banner animado',
  WELCOME_SCREEN_ENABLED: 'Pantalla de bienvenida',
  INVITE_SPLASH: 'Fondo de invitación',
  MORE_STICKERS: 'Más stickers',
  THREADS_ENABLED: 'Hilos habilitados',
};

// slots de emojis por nivel de boost (estatico Y animado tienen cada uno
// este limite — no es un total compartido). Nivel 0 = sin boosts
const EMOJI_LIMITS_BY_TIER = [50, 100, 150, 250];

function formatElapsed(fromDate) {
  const days = Math.floor((Date.now() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'hoy';
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.floor(months / 12);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}

async function handleInfoServerCommand(interaction, config) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply('Este comando solo funciona dentro de un server.');
    return;
  }

  await guild.members.fetch(guild.ownerId).catch(() => null);
  const owner = await guild.fetchOwner().catch(() => null);

  const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
  const voiceChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;
  const categoryChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).size;

  const staticEmojis = guild.emojis.cache.filter((e) => !e.animated).size;
  const animatedEmojis = guild.emojis.cache.filter((e) => e.animated).size;
  const emojiLimit = EMOJI_LIMITS_BY_TIER[guild.premiumTier] ?? EMOJI_LIMITS_BY_TIER[0];

  const activeFeatures = guild.features.filter((f) => FEATURE_LABELS[f]).map((f) => `✅ ${FEATURE_LABELS[f]}`);

  const fields = [
    { name: 'ID', value: guild.id, inline: false },
    { name: 'Owner', value: owner ? `<@${owner.id}>` : `<@${guild.ownerId}>`, inline: false },
    {
      name: 'Fecha de creación',
      value: `${guild.createdAt.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (${formatElapsed(guild.createdAt)})`,
      inline: false,
    },
    { name: 'Features', value: activeFeatures.length ? activeFeatures.join('\n') : '(sin features especiales activadas)', inline: false },
    { name: 'Miembros', value: String(guild.memberCount), inline: true },
    { name: 'Boosts', value: `Nivel ${guild.premiumTier} — ${guild.premiumSubscriptionCount} boost${guild.premiumSubscriptionCount === 1 ? '' : 's'}`, inline: true },
    { name: 'Roles', value: `${Math.max(guild.roles.cache.size - 1, 0)} roles`, inline: true },
    { name: 'Canales', value: `Texto: ${textChannels}\nVoz: ${voiceChannels}\nCategorías: ${categoryChannels}`, inline: true },
    { name: 'Emojis', value: `Estáticos: ${staticEmojis}/${emojiLimit}\nAnimados: ${animatedEmojis}/${emojiLimit}\nTotal: ${staticEmojis + animatedEmojis}/${emojiLimit * 2}`, inline: true },
  ];

  const embed = buildEmbed({
    type: 'brand',
    title: `${guild.name} 🚀`,
    thumbnail: guild.iconURL({ size: 256 }) || undefined,
    fields,
    config,
  });

  await interaction.reply({ embeds: [embed] });
}

module.exports = { definition, handleInfoServerCommand };
