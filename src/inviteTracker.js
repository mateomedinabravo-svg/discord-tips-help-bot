const { PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { buildEmbed } = require('./embedStyle');

// snapshot en memoria: guildId -> Map<codigoDeInvite, usos>
const inviteCacheByGuild = new Map();

function hasManageGuild(guild) {
  return Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild));
}

async function snapshotInvites(guild) {
  if (!hasManageGuild(guild)) return;

  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.forEach((inv) => map.set(inv.code, inv.uses));
    inviteCacheByGuild.set(guild.id, map);
  } catch (err) {
    console.error(`No se pudieron cargar las invitaciones de ${guild.name}:`, err.message);
  }
}

function handleInviteCreate(invite) {
  const cache = inviteCacheByGuild.get(invite.guild.id);
  if (cache) cache.set(invite.code, invite.uses);
}

function handleInviteDelete(invite) {
  const cache = inviteCacheByGuild.get(invite.guild.id);
  if (cache) cache.delete(invite.code);
}

async function resolveUsedInvite(guild) {
  if (!hasManageGuild(guild)) return { code: null, inviterId: null };

  const before = inviteCacheByGuild.get(guild.id);

  try {
    const invitesNow = await guild.invites.fetch();

    let usedCode = null;
    let inviterId = null;
    const newCache = new Map();

    invitesNow.forEach((inv) => {
      newCache.set(inv.code, inv.uses);
      const previousUses = before?.get(inv.code) || 0;
      if (usedCode === null && inv.uses > previousUses) {
        usedCode = inv.code;
        inviterId = inv.inviter?.id || null;
      }
    });

    inviteCacheByGuild.set(guild.id, newCache);
    return { code: usedCode, inviterId };
  } catch (err) {
    console.error(`No se pudo resolver la invitación usada en ${guild.name}:`, err.message);
    return { code: null, inviterId: null };
  }
}

async function handleMemberJoin(member, config) {
  const { code, inviterId } = await resolveUsedInvite(member.guild);

  await db.recordInviteJoin({ guildId: member.guild.id, userId: member.id, inviterId, code });

  const tracker = config?.inviteTracker;
  if (!tracker?.enabled || !tracker.channelId) return;

  try {
    const channel = await member.client.channels.fetch(tracker.channelId);
    if (!channel || !channel.isTextBased()) return;

    const description = inviterId
      ? `<@${member.id}> se unió invitado por <@${inviterId}> (ahora tiene **${await db.countInvitesByUser(member.guild.id, inviterId)}** invitación(es)).`
      : `<@${member.id}> se unió, pero no pude determinar quién lo invitó (link vanity, widget, o el bot no tiene permiso de "Gestionar servidor").`;

    const embed = buildEmbed({ type: 'success', title: '📥 Nuevo miembro', description, config });
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo mandar el log de invitaciones:', err.message);
  }
}

module.exports = {
  snapshotInvites,
  handleInviteCreate,
  handleInviteDelete,
  handleMemberJoin,
  hasManageGuild,
};
