const natural = require('natural');

const CLASSIFIER_CONFIDENCE_THRESHOLD = 0.4;

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '');
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[rows - 1][cols - 1];
}

// palabras cortas (<=4) exigen match exacto para no generar falsos positivos
function toleranceFor(wordLength) {
  if (wordLength <= 4) return 0;
  if (wordLength <= 7) return 1;
  return 2;
}

// busca "keyword" dentro de "text" tolerando errores de tipeo (distancia de Levenshtein)
function fuzzyIncludes(text, keyword) {
  if (keyword.includes(' ')) {
    return text.includes(keyword);
  }
  if (text.includes(keyword)) return true;

  const tolerance = toleranceFor(keyword.length);
  if (tolerance === 0) return false;

  for (let windowLength = keyword.length - 1; windowLength <= keyword.length + 1; windowLength++) {
    if (windowLength < 1) continue;
    for (let i = 0; i + windowLength <= text.length; i++) {
      const window = text.substr(i, windowLength);
      if (levenshtein(window, keyword) <= tolerance) return true;
    }
  }

  return false;
}

// clasificador bayesiano local (sin costo, sin API externa): aprende a reconocer
// el tema de un mensaje aunque no use ninguna de las palabras clave exactas
function buildClassifier(topics) {
  const classifier = new natural.BayesClassifier();

  for (const topic of topics) {
    for (const keyword of topic.keywords) {
      classifier.addDocument(keyword, topic.name);
    }
    for (const example of topic.examples || []) {
      classifier.addDocument(normalize(example), topic.name);
    }
  }

  classifier.train();
  return classifier;
}

function classifyTopic(classifier, topics, text) {
  const classifications = classifier.getClassifications(text);
  if (!classifications.length) return null;

  const best = classifications[0];
  if (best.value < CLASSIFIER_CONFIDENCE_THRESHOLD) return null;

  return topics.find((topic) => topic.name === best.label) || null;
}

function buildResponder(helpData) {
  const generalTriggers = helpData.generalTriggers.map(normalize);
  const topics = helpData.topics.map((topic) => ({
    ...topic,
    keywords: topic.keywords.map(normalize),
  }));
  const classifier = buildClassifier(topics);

  return function findResponse(messageContent) {
    const text = normalize(messageContent);

    const hasGeneralTrigger = generalTriggers.some((trigger) => fuzzyIncludes(text, trigger));
    if (!hasGeneralTrigger) return null;

    const keywordMatch = topics.find((topic) => topic.keywords.some((keyword) => fuzzyIncludes(text, keyword)));
    if (keywordMatch) return keywordMatch.response;

    const classifiedTopic = classifyTopic(classifier, topics, text);
    if (classifiedTopic) return classifiedTopic.response;

    return helpData.fallbackResponse;
  };
}

module.exports = { buildResponder, normalize, fuzzyIncludes };
