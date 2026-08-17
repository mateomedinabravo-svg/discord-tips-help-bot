const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

const SELECT_MENU_ID = 'self-role-menu';

function buildSelectRoleComponents({ title, description, placeholder, options, config }) {
  const embed = buildEmbed({ type: 'brand', title: title || 'Elegí tus roles', description, config });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_MENU_ID)
    .setPlaceholder((placeholder || 'Elegí una o varias opciones').slice(0, 150))
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(
      options.map((opt) => ({
        label: opt.label.slice(0, 100),
        value: opt.roleId,
        description: (opt.description || '').slice(0, 100) || undefined,
        emoji: opt.emoji || undefined,
      })),
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function postSelectRoleMessage(guild, { channelId, title, description, placeholder, options, config }) {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Canal inválido');

  const message = await channel.send(buildSelectRoleComponents({ title, description, placeholder, options, config }));

  await db.createSelectRoleSet({ guildId: guild.id, channelId, messageId: message.id, title, description, placeholder, options });
  return message;
}

// si el canal no cambio, edita el mensaje ya publicado en el lugar (no
// pierde reacciones/historial del canal); si cambio de canal (o el mensaje
// original ya no existe), borra el viejo y publica uno nuevo
async function updateSelectRoleMessage(guild, { originalMessageId, channelId, title, description, placeholder, options, config }) {
  const existing = originalMessageId ? await db.getSelectRoleSet(originalMessageId) : null;

  if (!existing || existing.channelId !== channelId) {
    if (existing) await deleteSelectRoleSet(guild, originalMessageId);
    return postSelectRoleMessage(guild, { channelId, title, description, placeholder, options, config });
  }

  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Canal inválido');

  const message = await channel.messages.fetch(originalMessageId);
  await message.edit(buildSelectRoleComponents({ title, description, placeholder, options, config }));

  await db.updateSelectRoleSet(originalMessageId, { title, description, placeholder, options });
  return message;
}

async function deleteSelectRoleSet(guild, messageId) {
  const set = await db.getSelectRoleSet(messageId);
  if (!set) return;

  try {
    const channel = await guild.channels.fetch(set.channelId);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
    }
  } catch (err) {
    console.error('No se pudo borrar el mensaje del menú de roles:', err.message);
  }

  await db.deleteSelectRoleSet(messageId);
}

async function handleSelectMenu(interaction) {
  if (interaction.customId !== SELECT_MENU_ID) return;

  const set = await db.getSelectRoleSet(interaction.message.id);
  if (!set) {
    await interaction.reply({ content: '⚠️ Este menú ya no está configurado.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const manageableRoleIds = set.options.map((o) => o.roleId).filter((id) => guild.roles.cache.has(id));
  const selectedRoleIds = interaction.values.filter((id) => guild.roles.cache.has(id));

  const member = interaction.member;
  const toAdd = selectedRoleIds.filter((id) => !member.roles.cache.has(id));
  const toRemove = manageableRoleIds.filter((id) => !selectedRoleIds.includes(id) && member.roles.cache.has(id));

  try {
    if (toAdd.length) await member.roles.add(toAdd);
    if (toRemove.length) await member.roles.remove(toRemove);
  } catch (err) {
    console.error('No se pudieron actualizar los roles del menú:', err.message);
    await interaction.reply({
      content: '❌ No pude actualizar tus roles. Revisá que el bot tenga permiso de "Gestionar roles" y que su rol esté por encima de los que asigna.',
      ephemeral: true,
    });
    return;
  }

  const followingLabels = set.options.filter((o) => selectedRoleIds.includes(o.roleId)).map((o) => o.label);
  const content = followingLabels.length
    ? `✅ Ahora seguís: ${followingLabels.join(', ')}`
    : '✅ Ya no seguís ninguna opción de este menú.';

  await interaction.reply({ content, ephemeral: true });
}

module.exports = { SELECT_MENU_ID, postSelectRoleMessage, updateSelectRoleMessage, deleteSelectRoleSet, handleSelectMenu };
