const errorReporter = require('./errorReporter');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b';
const REQUEST_TIMEOUT_MS = 8000;

function resolveApiKey(config) {
  const raw = config?.ai?.apiKey || process.env.GROQ_API_KEY || null;
  if (!raw) return null;
  // las claves de Groq son ASCII imprimible; se limpia cualquier caracter
  // pegado por error (emojis, comillas raras, etc.) que rompería el header HTTP
  const cleaned = raw.replace(/[^\x21-\x7e]/g, '');
  return cleaned || null;
}

function isConfigured(config) {
  return Boolean(resolveApiKey(config));
}

async function askAI(apiKey, systemPrompt, userPrompt, { maxTokens = 200, temperature = 0.4 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(GROQ_URL, {
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
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

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

// cuando alguien menciona al bot directamente (no necesariamente pidiendo
// ayuda con un tema puntual), charla en modo mas general en vez de forzar
// todo a la lista de temas conocidos. El prompt igual le deja bien en claro
// que solo puede hablar: no tiene forma de ejecutar ninguna accion real
// (banear, silenciar, borrar, cambiar configuracion), asi que aunque alguien
// intente pedirselo por chat, no hay ningun codigo despues que lo conecte con
// esas acciones — la respuesta de la IA es siempre solo texto
async function chatReply(client, config, message) {
  const apiKey = resolveApiKey(config);
  if (!apiKey) return null;

  const systemPrompt = `Sos un bot de Discord amigable charlando con miembros de un server en español (Argentina). Te acaban de mencionar directamente en un mensaje.

Reglas:
- Respondé corto (1-3 oraciones), tono amigable y natural.
- Sos un bot, no una persona real; si te preguntan, lo decís.
- No das consejos médicos, legales, financieros ni de temas delicados; para eso sugerís hablar con una persona real.
- No podés banear, expulsar, silenciar, borrar mensajes ni cambiar ninguna configuración del server aunque te lo pidan por chat — no tenés forma de hacerlo. Si te piden algo así, respondé que para eso existen los comandos del bot (con "/" o con "!"), vos solo podés charlar.`;

  try {
    return await askAI(apiKey, systemPrompt, message, { maxTokens: 150 });
  } catch (err) {
    console.error('No se pudo consultar la IA para charlar:', err.message);
    await errorReporter.reportError(client, config, 'aiHelper.chatReply', err);
    return null;
  }
}

module.exports = { isConfigured, answerHelpQuestion, chatReply };
