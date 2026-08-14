// Decide si un mensaje esta dirigido a otra persona (no al bot), para no
// meterse en una conversacion entre usuarios.
function isDirectedAtAnotherUser({ mentionsBot, repliedUserId, mentionedUserIds, botId }) {
  if (mentionsBot) return false;
  if (repliedUserId && repliedUserId !== botId) return true;
  if (mentionedUserIds.some((id) => id !== botId)) return true;
  return false;
}

module.exports = { isDirectedAtAnotherUser };
