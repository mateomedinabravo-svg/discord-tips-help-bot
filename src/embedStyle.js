const { EmbedBuilder } = require('discord.js');

const COLORS = {
  brand: 0x5865f2,
  success: 0x3ba55d,
  error: 0xed4245,
  warning: 0xf0b232,
  info: 0x5865f2,
};

function buildEmbed({ type = 'brand', title, description, fields, footer, thumbnail, image, author } = {}) {
  const embed = new EmbedBuilder().setColor(COLORS[type] || COLORS.brand).setTimestamp();
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (fields) embed.addFields(fields);
  if (footer) embed.setFooter(typeof footer === 'string' ? { text: footer } : footer);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (author) embed.setAuthor(author);
  return embed;
}

module.exports = { COLORS, buildEmbed };
