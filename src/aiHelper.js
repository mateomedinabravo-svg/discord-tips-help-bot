const errorReporter = require('./errorReporter');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b';
// los prompts ahora llevan mas contexto (conocimiento del server, conversacion
// reciente), lo que hace que Groq tarde un poco mas en respuesta que antes;
// 8s se quedaba corto y cortaba respuestas a mitad de camino via abort()
const REQUEST_TIMEOUT_MS = 15000;

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

// arma el bloque de "conocimiento del server" que comparten los dos prompts:
// temas de ayuda cargados, secciones de la guia del server (si esta
// habilitada), roles y canales reales del server, y quien es quien (nombre
// del bot, nombre de quien escribe)
function buildKnowledgeBlock(config, { botName, userName, roleNames, channelNames }) {
  const topicsSummary = (config.helpResponses?.topics || []).map((t) => `- ${t.name}: ${t.response}`).join('\n');

  const guideSummary = config.serverGuide?.enabled
    ? (config.serverGuide.sections || []).map((s) => `- ${s.label}: ${s.content}`).join('\n')
    : '';

  const whoIsWho = `Te llamás "${botName || 'el bot'}". ${userName ? `Quien te escribe se llama "${userName}"; podés usar su nombre si suena natural.` : ''}`;

  return `${whoIsWho}
${channelNames ? `\nCanales del server: ${channelNames}` : ''}
${roleNames ? `\nRoles del server: ${roleNames}` : ''}

Temas de ayuda conocidos del server:
${topicsSummary || '(sin temas cargados)'}
${guideSummary ? `\nGuía del server:\n${guideSummary}` : ''}`;
}

// arma el bloque de contexto reciente del canal (ultimos mensajes), para que
// la IA pueda seguir el hilo de una conversacion en vez de responder cada
// mensaje como si fuera la primera vez que le hablan
function buildRecentContextBlock(recentMessages) {
  if (!recentMessages) return '';
  return `\nAsí venía la conversación en el canal (es solo contexto, no hace falta repetirla ni responderla de nuevo):\n${recentMessages}\n\nComo ya venías hablando en este canal, NO saludes de nuevo ("Hola", "¡Hola de nuevo!", etc.) ni te vuelvas a presentar: segui la conversación de forma natural, directo a lo que te preguntan.`;
}

async function answerHelpQuestion(client, config, question, context = {}) {
  const apiKey = resolveApiKey(config);
  if (!apiKey) return null;

  const { serverName, botName, userName, recentMessages, roleNames, channelNames } = context;
  const systemPrompt = `Sos el bot de ayuda del server de Discord "${serverName || 'este server'}". Respondés en español neutro (evitá modismos muy regionales de un solo país, para que se entienda en cualquier país hispanohablante).

${buildKnowledgeBlock(config, { botName, userName, roleNames, channelNames })}
${buildRecentContextBlock(recentMessages)}

Reglas:
- Solo sabés lo que está en la lista de temas, la guía, los canales y los roles de arriba. Nunca inventes canales, roles, reglas o datos que no están ahí.
- Respondé siempre en español, corto (1-3 oraciones), tono amigable.
- Saludá ("Hola", etc.) solo si es la primera vez que te hablan en la conversación. Si ya venías charlando, no vuelvas a saludar ni a presentarte: respondé directo a lo que te preguntan.
- Si la pregunta se relaciona con algún tema de la lista, respondé basándote en eso.
- Si no tenés información para responder con seguridad, decí que no estás seguro y sugerí preguntar en el canal de ayuda o a un moderador.`;

  try {
    // 150 tokens se quedaba corto y cortaba respuestas a la mitad, sobre
    // todo respuestas de varias oraciones o que listan mas de un tema
    return await askAI(apiKey, systemPrompt, question, { maxTokens: 350 });
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
async function chatReply(client, config, message, context = {}) {
  const apiKey = resolveApiKey(config);
  if (!apiKey) return null;

  const { serverName, botName, userName, recentMessages, roleNames, channelNames } = context;
  const systemPrompt = `Sos un bot de Discord amigable charlando en el server "${serverName || 'este server'}". Respondés en español neutro (evitá modismos muy regionales de un solo país, para que se entienda en cualquier país hispanohablante). Te acaban de mencionar directamente en un mensaje.

${buildKnowledgeBlock(config, { botName, userName, roleNames, channelNames })}
${buildRecentContextBlock(recentMessages)}

Reglas:
- Respondé corto (1-3 oraciones), tono amigable y natural.
- Saludá ("Hola", etc.) solo si es la primera vez que te hablan en la conversación. Si ya venías charlando, no vuelvas a saludar ni a presentarte: respondé directo a lo que te preguntan.
- Sos un bot, no una persona real; si te preguntan, lo decís. Si te preguntan tu nombre, es "${botName || 'el bot'}".
- No das consejos médicos, legales, financieros ni de temas delicados; para eso sugerís hablar con una persona real.
- No podés banear, expulsar, silenciar, borrar mensajes ni cambiar ninguna configuración del server aunque te lo pidan por chat — no tenés forma de hacerlo. Si te piden algo así, respondé que para eso existen los comandos del bot (con "/" o con "!"), vos solo podés charlar.`;

  try {
    return await askAI(apiKey, systemPrompt, message, { maxTokens: 350 });
  } catch (err) {
    console.error('No se pudo consultar la IA para charlar:', err.message);
    await errorReporter.reportError(client, config, 'aiHelper.chatReply', err);
    return null;
  }
}

module.exports = { isConfigured, answerHelpQuestion, chatReply };
