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

  reset() {
    this.counts.clear();
  }
}

module.exports = { ActivityTracker };
