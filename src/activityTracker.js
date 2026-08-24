class ActivityTracker {
  constructor() {
    this.counts = new Map();
  }

  registerMessage(channelId) {
    this.counts.set(channelId, (this.counts.get(channelId) || 0) + 1);
  }

  getMostActiveChannelId() {
    let bestId = null;
    let bestCount = 0;
    for (const [channelId, count] of this.counts) {
      if (count > bestCount) {
        bestCount = count;
        bestId = channelId;
      }
    }
    return bestId;
  }

  // todos los canales con actividad, del mas al menos activo — permite elegir
  // el mas activo que NO este excluido, en vez de solo el numero 1
  getRankedChannelIds() {
    return [...this.counts.entries()].sort((a, b) => b[1] - a[1]).map(([channelId]) => channelId);
  }

  reset() {
    this.counts.clear();
  }
}

module.exports = { ActivityTracker };
