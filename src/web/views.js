function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function layout({ title, user, body, flash }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Panel del bot</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #1e1f22; color: #dbdee1; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; background: #111214; border-bottom: 1px solid #2b2d31; }
  header a.brand { color: #fff; font-weight: 700; text-decoration: none; font-size: 18px; }
  header .user { display: flex; align-items: center; gap: 10px; font-size: 14px; color: #b5bac1; }
  header .user a { color: #f2b8b5; text-decoration: none; }
  nav { display: flex; gap: 4px; flex-wrap: wrap; padding: 12px 24px; background: #111214; border-bottom: 1px solid #2b2d31; }
  nav a { color: #b5bac1; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 14px; }
  nav a:hover { background: #2b2d31; color: #fff; }
  main { max-width: 900px; margin: 0 auto; padding: 28px 24px 60px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .muted { color: #949ba4; font-size: 14px; margin-bottom: 24px; }
  .card { background: #2b2d31; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
  .card h2 { margin-top: 0; font-size: 16px; }
  label { display: block; font-size: 13px; color: #b5bac1; margin: 14px 0 6px; }
  input[type=text], input[type=number], input[type=url], select, textarea {
    width: 100%; padding: 9px 10px; border-radius: 6px; border: 1px solid #1e1f22;
    background: #1e1f22; color: #dbdee1; font-size: 14px; font-family: inherit;
  }
  textarea { min-height: 110px; resize: vertical; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .checkbox-row input { width: auto; }
  button { margin-top: 18px; background: #5865f2; color: #fff; border: none; padding: 10px 18px;
    border-radius: 6px; font-size: 14px; cursor: pointer; font-weight: 600; }
  button:hover { background: #4752c4; }
  .flash { background: #2f5d3a; color: #d7ffe0; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #1e1f22; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 12px; }
  .pill.open { background: #3a4a2f; color: #b9f2a0; }
  .pill.closed { background: #4a3a3a; color: #f2a0a0; }
  .login-wrap { display: flex; align-items: center; justify-content: center; height: 100vh; }
  .login-card { background: #2b2d31; padding: 40px; border-radius: 12px; text-align: center; }
  .login-card a { display: inline-block; margin-top: 20px; background: #5865f2; color: #fff; padding: 12px 24px;
    border-radius: 6px; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
${user ? `<header>
  <a class="brand" href="/dashboard">🤖 Panel del bot</a>
  <div class="user">${escapeHtml(user.username)} · <a href="/logout">salir</a></div>
</header>
<nav>
  <a href="/dashboard">General</a>
  <a href="/dashboard/bienvenida">Bienvenida / Despedida</a>
  <a href="/dashboard/automoderacion">Automoderación</a>
  <a href="/dashboard/mensajes">Tips y ayuda</a>
  <a href="/dashboard/anuncio">Anuncios</a>
  <a href="/dashboard/estadisticas">Estadísticas</a>
  <a href="/dashboard/tickets">Tickets</a>
</nav>` : ''}
<main>
${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ''}
${body}
</main>
</body>
</html>`;
}

function loginPage({ authorizeUrl, error }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Ingresar · Panel del bot</title>
<style>
  body { margin:0; background:#1e1f22; color:#dbdee1; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  .login-wrap { display:flex; align-items:center; justify-content:center; height:100vh; }
  .login-card { background:#2b2d31; padding:40px; border-radius:12px; text-align:center; max-width: 360px; }
  .login-card a { display:inline-block; margin-top:20px; background:#5865f2; color:#fff; padding:12px 24px;
    border-radius:6px; text-decoration:none; font-weight:600; }
  .error { color:#f2a0a0; font-size: 14px; margin-top: 12px; }
</style></head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <h1>🤖 Panel del bot</h1>
    <p>Iniciá sesión con Discord para administrar el server.</p>
    <a href="${authorizeUrl}">Iniciar sesión con Discord</a>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  </div>
</div>
</body></html>`;
}

function generalPage({ user, config, flash }) {
  const body = `
  <h1>Configuración general</h1>
  <p class="muted">Idioma e intervalo del tip automático.</p>
  <form class="card" method="post" action="/dashboard/general">
    <label>Idioma</label>
    <select name="language">
      <option value="es" ${config.language === 'es' ? 'selected' : ''}>Español</option>
      <option value="en" ${config.language === 'en' ? 'selected' : ''}>English</option>
    </select>
    <label>Intervalo del tip automático (minutos)</label>
    <input type="number" name="tipsIntervalMinutes" min="1" value="${escapeHtml(config.tipsIntervalMinutes)}">
    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'General', user, body, flash });
}

function welcomePage({ user, config, channels, flash }) {
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const body = `
  <h1>Bienvenida y despedida</h1>
  <p class="muted">Usá <code>{user}</code> en el mensaje para mencionar al usuario.</p>

  <form class="card" method="post" action="/dashboard/bienvenida/welcome">
    <h2>Mensaje de bienvenida</h2>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="w-enabled" ${config.welcome.enabled ? 'checked' : ''}>
      <label for="w-enabled" style="margin:0;">Activado</label></div>
    <label>Canal</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions(config.welcome.channelId)}</select>
    <label>Mensaje</label>
    <textarea name="message">${escapeHtml(config.welcome.message)}</textarea>
    <button type="submit">Guardar bienvenida</button>
  </form>

  <form class="card" method="post" action="/dashboard/bienvenida/goodbye">
    <h2>Mensaje de despedida</h2>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="g-enabled" ${config.goodbye.enabled ? 'checked' : ''}>
      <label for="g-enabled" style="margin:0;">Activado</label></div>
    <label>Canal</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions(config.goodbye.channelId)}</select>
    <label>Mensaje</label>
    <textarea name="message">${escapeHtml(config.goodbye.message)}</textarea>
    <button type="submit">Guardar despedida</button>
  </form>`;
  return layout({ title: 'Bienvenida / Despedida', user, body, flash });
}

function automodPage({ user, config, flash }) {
  const body = `
  <h1>Automoderación</h1>
  <form class="card" method="post" action="/dashboard/automoderacion">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="a-enabled" ${config.automod.enabled ? 'checked' : ''}>
      <label for="a-enabled" style="margin:0;">Activada</label></div>

    <label>Palabras prohibidas (una por línea, se borra el mensaje si aparece alguna)</label>
    <textarea name="bannedWords">${escapeHtml((config.automod.bannedWords || []).join('\n'))}</textarea>

    <div class="checkbox-row"><input type="checkbox" name="blockInvites" id="a-invites" ${config.automod.blockInvites ? 'checked' : ''}>
      <label for="a-invites" style="margin:0;">Bloquear links de invitación a otros servers de Discord</label></div>

    <label>Límite de menciones en un mismo mensaje (0 = sin límite)</label>
    <input type="number" name="mentionSpamLimit" min="0" value="${escapeHtml(config.automod.mentionSpamLimit)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Automoderación', user, body, flash });
}

function messagesPage({ user, config, flash }) {
  const body = `
  <h1>Tips y respuestas de ayuda</h1>

  <form class="card" method="post" action="/dashboard/mensajes/tips">
    <h2>Tips automáticos</h2>
    <p class="muted">Uno por línea. Se elige uno al azar cada vez que se manda.</p>
    <textarea name="tips" style="min-height:180px;">${escapeHtml((config.tips || []).join('\n'))}</textarea>
    <button type="submit">Guardar tips</button>
  </form>

  <form class="card" method="post" action="/dashboard/mensajes/ayuda">
    <h2>Respuestas de ayuda (avanzado)</h2>
    <p class="muted">JSON completo: triggers generales, temas, palabras clave, ejemplos y respuesta de cada uno. Si el JSON es inválido, no se guarda.</p>
    <textarea name="helpResponsesJson" style="min-height:320px; font-family: monospace;">${escapeHtml(JSON.stringify(config.helpResponses, null, 2))}</textarea>
    <button type="submit">Guardar respuestas de ayuda</button>
  </form>`;
  return layout({ title: 'Tips y ayuda', user, body, flash });
}

function announcePage({ user, channels, flash }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  const body = `
  <h1>Mandar un anuncio</h1>
  <form class="card" method="post" action="/dashboard/anuncio">
    <label>Canal</label>
    <select name="channelId" required>${channelOptions}</select>
    <label>Título (opcional)</label>
    <input type="text" name="titulo">
    <label>Mensaje</label>
    <textarea name="mensaje" required></textarea>
    <label>Color (hex, opcional)</label>
    <input type="text" name="color" placeholder="#5865f2">
    <label>Imagen (URL, opcional)</label>
    <input type="url" name="imagen">
    <button type="submit">Enviar anuncio</button>
  </form>`;
  return layout({ title: 'Anuncios', user, body, flash });
}

function statsPage({ user, stats, channelNames }) {
  const rows = Object.entries(stats.channelMessageCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([channelId, count]) => `<tr><td>#${escapeHtml(channelNames[channelId] || channelId)}</td><td>${count}</td></tr>`)
    .join('');

  const body = `
  <h1>Estadísticas</h1>
  <div class="card">
    <h2>Resumen</h2>
    <p>Mensajes totales registrados: <strong>${stats.totalMessages}</strong></p>
    <p>Tickets abiertos: <strong>${stats.openTickets}</strong> · Tickets cerrados: <strong>${stats.closedTickets}</strong></p>
  </div>
  <div class="card">
    <h2>Mensajes por canal</h2>
    <table><thead><tr><th>Canal</th><th>Mensajes</th></tr></thead><tbody>${rows || '<tr><td colspan="2">Todavía no hay datos</td></tr>'}</tbody></table>
  </div>`;
  return layout({ title: 'Estadísticas', user, body });
}

function ticketsPage({ user, tickets }) {
  const rows = tickets
    .map(
      (t) => `<tr>
        <td>#${escapeHtml(t.channelId)}</td>
        <td><span class="pill ${t.status}">${t.status === 'open' ? 'Abierto' : 'Cerrado'}</span></td>
        <td>${new Date(t.createdAt).toLocaleString('es-AR')}</td>
      </tr>`,
    )
    .join('');

  const body = `
  <h1>Tickets</h1>
  <div class="card">
    <table><thead><tr><th>Canal</th><th>Estado</th><th>Creado</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">Todavía no hay tickets</td></tr>'}</tbody></table>
  </div>`;
  return layout({ title: 'Tickets', user, body });
}

module.exports = {
  layout,
  loginPage,
  generalPage,
  welcomePage,
  automodPage,
  messagesPage,
  announcePage,
  statsPage,
  ticketsPage,
};
