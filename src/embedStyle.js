const { EmbedBuilder } = require('discord.js');

const COLORS = {
  brand: 0x5865f2,
  success: 0x3ba55d,
  error: 0xed4245,
  warning: 0xf0b232,
  info: 0x5865f2,
};

function hexToInt(hex) {
  if (!hex) return null;
  const value = parseInt(String(hex).replace('#', ''), 16);
  return Number.isNaN(value) ? null : value;
}

// resuelve el color de un embed: primero el que configuró el server desde el
// dashboard (config.branding.colors), si no hay usa el default de la marca
function resolveColor(config, type = 'brand') {
  const custom = hexToInt(config?.branding?.colors?.[type]);
  return custom !== null ? custom : COLORS[type] || COLORS.brand;
}

function buildEmbed({ type = 'brand', title, description, fields, footer, thumbnail, image, author, config } = {}) {
  const embed = new EmbedBuilder().setColor(resolveColor(config, type)).setTimestamp();
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (fields) embed.addFields(fields);

  const brandedFooter =
    footer || (config?.branding?.footerText ? { text: config.branding.footerText, iconURL: config.branding.footerIcon || undefined } : null);
  if (brandedFooter) embed.setFooter(typeof brandedFooter === 'string' ? { text: brandedFooter } : brandedFooter);

  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (author) embed.setAuthor(author);
  return embed;
}

module.exports = { COLORS, buildEmbed, resolveColor };
