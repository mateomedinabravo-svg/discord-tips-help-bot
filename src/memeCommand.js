const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('./embedStyle');

// r/MemesEnEspanol en vez del pool general (que es predominantemente en
// ingles) — asi los memes que manda el bot son en español de verdad
const MEME_API_URL = 'https://meme-api.com/gimme/memesenespanol';
const MAX_ATTEMPTS = 3;

const definition = new SlashCommandBuilder().setName('meme').setDescription('Manda un meme random');

async function fetchSafeMeme() {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(MEME_API_URL);
    if (!res.ok) continue;
    const data = await res.json();
    if (!data.nsfw && !data.spoiler) return data;
  }
  return null;
}

async function handleMemeCommand(interaction, config) {
  await interaction.deferReply();

  try {
    const meme = await fetchSafeMeme();
    if (!meme) {
      await interaction.editReply('⚠️ No pude conseguir un meme ahora, probá de nuevo en un rato.');
      return;
    }

    const embed = buildEmbed({
      type: 'brand',
      title: meme.title.slice(0, 256),
      image: meme.url,
      footer: `r/${meme.subreddit} · 👍 ${meme.ups}`,
      config,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo traer un meme:', err);
    await interaction.editReply('⚠️ No pude conseguir un meme ahora, probá de nuevo en un rato.');
  }
}

module.exports = { definition, handleMemeCommand };
