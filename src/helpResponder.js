function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '');
}

function buildResponder(helpData) {
  const generalTriggers = helpData.generalTriggers.map(normalize);
  const topics = helpData.topics.map((topic) => ({
    ...topic,
    keywords: topic.keywords.map(normalize),
  }));

  return function findResponse(messageContent) {
    const text = normalize(messageContent);

    const hasGeneralTrigger = generalTriggers.some((trigger) => text.includes(trigger));
    if (!hasGeneralTrigger) return null;

    for (const topic of topics) {
      if (topic.keywords.some((keyword) => text.includes(keyword))) {
        return topic.response;
      }
    }

    return helpData.fallbackResponse;
  };
}

module.exports = { buildResponder, normalize };
