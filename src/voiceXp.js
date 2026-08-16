const levelCommands = require('./levelCommands');

// guildId:userId -> timestamp de cuando se conecto a voz por ultima vez
const voiceJoinTimestamps = new Map();

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function handleVoiceStateUpdate(oldState, newState, config) {
  const leveling = config?.leveling;
  if (!leveling?.enabled || !leveling.voiceXpEnabled) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guildId = newState.guild.id;
  const userId = member.id;
  const k = key(guildId, userId);

  const wasConnected = Boolean(oldState.channelId);
  const isConnected = Boolean(newState.channelId);

  if (!wasConnected && isConnected) {
    voiceJoinTimestamps.set(k, Date.now());
    return;
  }

  // sigue conectado pero cambio de canal: el timer sigue corriendo tal cual
  if (wasConnected && isConnected) return;

  if (wasConnected && !isConnected) {
    const joinedAt = voiceJoinTimestamps.get(k);
    voiceJoinTimestamps.delete(k);
    if (!joinedAt) return;

    const minutes = Math.floor((Date.now() - joinedAt) / 60000);
    if (minutes <= 0) return;

    const perMinute = Math.max(0, leveling.voiceXpPerMinute || 0);
    const amount = minutes * perMinute;
    if (amount <= 0) return;

    await levelCommands.grantXpAndAnnounce(newState.client, newState.guild, userId, amount, config, null);
  }
}

module.exports = { handleVoiceStateUpdate };
