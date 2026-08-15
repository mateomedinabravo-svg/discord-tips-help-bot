const errorReporter = require('./errorReporter');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b';
const MODERATION_COOLDOWN_MS = 3000;

const lastModerationCallByGuild = new Map();

function resolveApiKey(config) {
  return config?.ai?.apiKey || process.env.GROQ_API_KEY || null;
}

function isConfigured(config) {
  return Boolean(resolveApiKey(config));
}

async function askAI(apiKey, systemPrompt, userPrompt, { maxTokens = 200, temperature = 0.4 } = {}) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq API respondió ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function answerHelpQuestion(client, config, question) {
  const apiKey = resolveApiKey(config);
  if (!apiKey) return null;

  const topicsSummary = (config.helpResponses.topics || [])
    .map((t) => `- ${t.name}: ${t.response}`)
    .join('\n');

  const systemPrompt = `Sos el bot de ayuda de un server de Discord en español (Argentina). Solo sabés lo que está en esta lista de temas conocidos del server:
${topicsSummary}

Reglas:
- Respondé siempre en español, corto (1-3 oraciones), tono amigable.
- Si la pregunta se relaciona con algún tema de la lista, respondé basándote en eso.
- Si no tenés información para responder con seguridad, decí que no estás seguro y sugerí preguntar en el canal de ayuda o a un moderador. Nunca inventes canales, reglas o datos que no están en la lista.`;

  try {
    return await askAI(apiKey, systemPrompt, question, { maxTokens: 150 });
  } catch (err) {
    console.error('No se pudo consultar la IA para ayuda:', err.message);
    await errorReporter.reportError(client, config, 'aiHelper.answerHelpQuestion', err);
    return null;
  }
}

function canRunModerationCheck(guildId) {
  const now = Date.now();
  const last = lastModerationCallByGuild.get(guildId) || 0;
  if (now - last < MODERATION_COOLDOWN_MS) return false;
  lastModerationCallByGuild.set(guildId, now);
  return true;
}

async function checkToxicMessage(client, config, content) {
  const apiKey = resolveApiKey(config);
  if (!apiKey) return false;

  const systemPrompt =
    'Sos un moderador de un server de Discord en español. Tu unica tarea es decidir si el mensaje del usuario es toxico, acoso, insulto grave, discurso de odio o amenaza. No marques groserias comunes entre amigos ni bromas normales. Respondé UNICAMENTE con la palabra SI o NO, sin nada mas.';

  try {
    const reply = await askAI(apiKey, systemPrompt, content, { maxTokens: 5, temperature: 0 });
    return Boolean(reply && reply.trim().toUpperCase().startsWith('SI'));
  } catch (err) {
    console.error('No se pudo consultar la IA para moderación:', err.message);
    await errorReporter.reportError(client, config, 'aiHelper.checkToxicMessage', err);
    return false;
  }
}

module.exports = { isConfigured, answerHelpQuestion, canRunModerationCheck, checkToxicMessage };
