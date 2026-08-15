function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function layout({ title, user, body, flash, guildName }) {
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
  header .guild-badge { color: #949ba4; }
  header .guild-badge a { color: #b5bac1; }
  .server-list { display: flex; flex-direction: column; gap: 10px; }
  .server-row { display: flex; align-items: center; justify-content: space-between; background: #1e1f22;
    padding: 12px 16px; border-radius: 8px; }
  .server-row .name { font-weight: 600; }
  .server-row a.btn, a.btn { background: #5865f2; color: #fff; text-decoration: none; padding: 8px 16px;
    border-radius: 6px; font-size: 13px; font-weight: 600; }
  .server-row a.btn.invite { background: #3ba55d; }
  .row-grid { display: grid; grid-template-columns: 1.2fr 1.5fr 1fr auto; gap: 8px; align-items: center; margin-top: 8px; }
  .row-grid input, .row-grid select { margin: 0; }
  nav { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; padding: 12px 24px 14px; background: #111214; border-bottom: 1px solid #2b2d31; }
  nav .nav-group { display: flex; flex-direction: column; gap: 2px; }
  nav .nav-group-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #72767d;
    padding: 4px 10px 2px; font-weight: 700; }
  nav .nav-group-links { display: flex; flex-wrap: wrap; gap: 2px; }
  nav a { color: #b5bac1; text-decoration: none; padding: 6px 10px; border-radius: 6px; font-size: 13px; white-space: nowrap; }
  nav a:hover { background: #2b2d31; color: #fff; }
  nav a.active { background: #3a3d44; color: #fff; }
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
  input[type=color] { width: 60px; height: 38px; padding: 3px; border-radius: 6px; border: 1px solid #1e1f22; background: #1e1f22; cursor: pointer; }
  .color-row { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
  .color-row label { margin: 0; min-width: 90px; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .checkbox-row input { width: auto; }
  button { margin-top: 18px; background: #5865f2; color: #fff; border: none; padding: 10px 18px;
    border-radius: 6px; font-size: 14px; cursor: pointer; font-weight: 600; }
  button:hover { background: #4752c4; }
  .flash { background: #2f5d3a; color: #d7ffe0; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 14px; }
  .warning-banner { background: #4a3b1f; color: #f2d9a0; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 14px; }
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
  <div class="user">
    ${guildName ? `<span class="guild-badge">${escapeHtml(guildName)} · <a href="/servers">cambiar de server</a> ·</span>` : ''}
    ${escapeHtml(user.username)} · <a href="/logout">salir</a>
  </div>
</header>
<nav>
  <div class="nav-group">
    <div class="nav-group-label">General</div>
    <div class="nav-group-links">
      <a href="/dashboard">General</a>
      <a href="/dashboard/estadisticas">Estadísticas</a>
      <a href="/dashboard/debug">Estado / Debug</a>
    </div>
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Comunidad</div>
    <div class="nav-group-links">
      <a href="/dashboard/bienvenida">Bienvenida/Despedida</a>
      <a href="/dashboard/mensajes">Tips y ayuda</a>
      <a href="/dashboard/anuncio">Anuncios</a>
      <a href="/dashboard/houses">Houses</a>
      <a href="/dashboard/starboard">Starboard</a>
    </div>
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Moderación</div>
    <div class="nav-group-links">
      <a href="/dashboard/automoderacion">Automoderación</a>
      <a href="/dashboard/logs">Logs</a>
      <a href="/dashboard/moderacion">Roles protegidos</a>
    </div>
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Tickets</div>
    <div class="nav-group-links">
      <a href="/dashboard/tickets">Tickets</a>
      <a href="/dashboard/tickets/config">Configurar</a>
    </div>
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Progresión</div>
    <div class="nav-group-links">
      <a href="/dashboard/niveles">Niveles</a>
      <a href="/dashboard/roles-reaccion">Roles por reacción</a>
    </div>
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Economía y juegos</div>
    <div class="nav-group-links">
      <a href="/dashboard/economia">Economía</a>
      <a href="/dashboard/casino">Casino</a>
      <a href="/dashboard/mascotas">Mascotas</a>
      <a href="/dashboard/trivia">Trivia</a>
      <a href="/dashboard/eventos">Eventos</a>
    </div>
  </div>
  <div class="nav-group">
    <div class="nav-group-label">A medida</div>
    <div class="nav-group-links">
      <a href="/dashboard/comandos">Comandos</a>
      <a href="/dashboard/ia">IA</a>
      <a href="/dashboard/guia">Guía</a>
      <a href="/dashboard/apariencia">Apariencia</a>
    </div>
  </div>
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

function generalPage({ user, config, guildName, flash }) {
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
  return layout({ title: 'General', user, body, flash, guildName });
}

function welcomePage({ user, config, channels, roles, guildName, flash }) {
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
  const roleOptions = (selected) =>
    (roles || []).map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');

  const welcomeMismatch = config.welcome.enabled && !config.welcome.channelId;
  const goodbyeMismatch = config.goodbye.enabled && !config.goodbye.channelId;

  const body = `
  <h1>Bienvenida y despedida</h1>
  <p class="muted">Variables disponibles: <code>{user}</code> (menciona al usuario), <code>{username}</code>, <code>{server}</code>, <code>{membercount}</code>.</p>

  <form class="card" method="post" action="/dashboard/bienvenida/welcome">
    <h2>Mensaje de bienvenida</h2>
    ${welcomeMismatch ? '<div class="warning-banner">⚠️ Está activado pero no elegiste canal, así que no se manda nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="w-enabled" ${config.welcome.enabled ? 'checked' : ''}>
      <label for="w-enabled" style="margin:0;">Activado</label></div>
    <label>Canal</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions(config.welcome.channelId)}</select>
    <label>Mensaje</label>
    <textarea name="message">${escapeHtml(config.welcome.message)}</textarea>
    <div class="checkbox-row"><input type="checkbox" name="useEmbed" id="w-embed" ${config.welcome.useEmbed ? 'checked' : ''}>
      <label for="w-embed" style="margin:0;">Mandar como embed (con foto de perfil del usuario)</label></div>
    <label>Rol automático al unirse (opcional)</label>
    <select name="roleId"><option value="">-- ninguno --</option>${roleOptions(config.welcome.roleId)}</select>
    <button type="submit">Guardar bienvenida</button>
  </form>

  <form class="card" method="post" action="/dashboard/bienvenida/goodbye">
    <h2>Mensaje de despedida</h2>
    ${goodbyeMismatch ? '<div class="warning-banner">⚠️ Está activado pero no elegiste canal, así que no se manda nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="g-enabled" ${config.goodbye.enabled ? 'checked' : ''}>
      <label for="g-enabled" style="margin:0;">Activado</label></div>
    <label>Canal</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions(config.goodbye.channelId)}</select>
    <label>Mensaje</label>
    <textarea name="message">${escapeHtml(config.goodbye.message)}</textarea>
    <div class="checkbox-row"><input type="checkbox" name="useEmbed" id="g-embed" ${config.goodbye.useEmbed ? 'checked' : ''}>
      <label for="g-embed" style="margin:0;">Mandar como embed (con foto de perfil del usuario)</label></div>
    <button type="submit">Guardar despedida</button>
  </form>`;
  return layout({ title: 'Bienvenida / Despedida', user, body, flash, guildName });
}

function automodPage({ user, config, guildName, flash }) {
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
  return layout({ title: 'Automoderación', user, body, flash, guildName });
}

function messagesPage({ user, config, editingTopic, guildName, flash }) {
  const topicRows = (config.helpResponses.topics || [])
    .map(
      (t) => `<div class="server-row">
        <span class="name">${escapeHtml(t.name)} · ${t.keywords.length} palabra(s) clave</span>
        <span>
          <a class="btn" href="/dashboard/mensajes?editar=${encodeURIComponent(t.name)}">Editar</a>
          <form method="post" action="/dashboard/mensajes/ayuda/tema/eliminar" style="display:inline; margin:0;">
            <input type="hidden" name="name" value="${escapeHtml(t.name)}">
            <button type="submit" style="margin:0; background:#ed4245;">Eliminar</button>
          </form>
        </span>
      </div>`,
    )
    .join('');

  const topic = editingTopic || { name: '', keywords: [], examples: [], response: '' };

  const body = `
  <h1>Tips y respuestas de ayuda</h1>

  <form class="card" method="post" action="/dashboard/mensajes/tips">
    <h2>Tips automáticos</h2>
    <p class="muted">Uno por línea. Se elige uno al azar cada vez que se manda.</p>
    <textarea name="tips" style="min-height:180px;">${escapeHtml((config.tips || []).join('\n'))}</textarea>
    <button type="submit">Guardar tips</button>
  </form>

  <form class="card" method="post" action="/dashboard/mensajes/ayuda/general">
    <h2>Cuándo responde el bot</h2>
    <label>Palabras disparadoras (una por línea — alguna tiene que aparecer para que responda con parafraseo o el mensaje genérico)</label>
    <textarea name="generalTriggers">${escapeHtml((config.helpResponses.generalTriggers || []).join('\n'))}</textarea>
    <label>Mensaje genérico (cuando detecta un pedido de ayuda pero no un tema específico)</label>
    <textarea name="fallbackResponse">${escapeHtml(config.helpResponses.fallbackResponse)}</textarea>
    <button type="submit">Guardar</button>
  </form>

  <div class="card">
    <h2>Temas</h2>
    <p class="muted">Cada tema responde solo con que aparezca una de sus palabras clave (no hace falta decir "ayuda").</p>
    <div class="server-list">${topicRows || '<p class="muted">Todavía no hay temas.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/mensajes/ayuda/tema">
    <h2>${editingTopic ? `Editando: ${escapeHtml(editingTopic.name)}` : 'Nuevo tema'}</h2>
    <input type="hidden" name="originalName" value="${escapeHtml(topic.name)}">
    <label>Nombre (identificador simple, sin espacios)</label>
    <input type="text" name="name" value="${escapeHtml(topic.name)}" required>
    <label>Palabras clave (una por línea)</label>
    <textarea name="keywords">${escapeHtml(topic.keywords.join('\n'))}</textarea>
    <label>Frases de ejemplo (opcional, ayuda a reconocer paráfrasis sin la palabra exacta)</label>
    <textarea name="examples">${escapeHtml((topic.examples || []).join('\n'))}</textarea>
    <label>Respuesta</label>
    <textarea name="response" required>${escapeHtml(topic.response)}</textarea>
    <button type="submit">${editingTopic ? 'Guardar cambios' : 'Crear tema'}</button>
    ${editingTopic ? '<a class="btn" href="/dashboard/mensajes" style="margin-left:10px; background:#4a4d53;">Cancelar edición</a>' : ''}
  </form>`;
  return layout({ title: 'Tips y ayuda', user, body, flash, guildName });
}

function announcePage({ user, channels, guildName, flash }) {
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

function statsPage({ user, stats, channelNames, leaderboard, guildName }) {
  const rows = Object.entries(stats.channelMessageCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([channelId, count]) => `<tr><td>#${escapeHtml(channelNames[channelId] || channelId)}</td><td>${count}</td></tr>`)
    .join('');

  const leaderboardRows = (leaderboard || [])
    .map((entry, i) => `<tr><td>${i + 1}</td><td>ID ${escapeHtml(entry.userId)}</td><td>${entry.xp} XP</td></tr>`)
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
  </div>
  <div class="card">
    <h2>Top experiencia</h2>
    <table><thead><tr><th>#</th><th>Usuario</th><th>XP</th></tr></thead>
    <tbody>${leaderboardRows || '<tr><td colspan="3">Todavía no hay datos</td></tr>'}</tbody></table>
  </div>`;
  return layout({ title: 'Estadísticas', user, body, guildName });
}

function ticketsPage({ user, tickets, guildName }) {
  const rows = tickets
    .map(
      (t) => `<tr>
        <td>${t.number ? `#${String(t.number).padStart(4, '0')}` : escapeHtml(t.channelId)}</td>
        <td>${escapeHtml(t.categoryLabel || '—')}</td>
        <td><span class="pill ${t.status}">${t.status === 'open' ? 'Abierto' : 'Cerrado'}</span></td>
        <td>${t.claimedBy ? `ID ${escapeHtml(t.claimedBy)}` : '—'}</td>
        <td>${t.rating ? '⭐'.repeat(t.rating) : '—'}</td>
        <td>${new Date(t.createdAt).toLocaleString('es-AR')}</td>
      </tr>`,
    )
    .join('');

  const body = `
  <h1>Tickets</h1>
  <p class="muted">Para configurar categorías, panel, transcripciones y encuesta, andá a <a href="/dashboard/tickets/config">Config. Tickets</a>.</p>
  <div class="card">
    <table><thead><tr><th>Número</th><th>Categoría</th><th>Estado</th><th>Reclamado por</th><th>Calificación</th><th>Creado</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">Todavía no hay tickets</td></tr>'}</tbody></table>
  </div>`;
  return layout({ title: 'Tickets', user, body, guildName });
}

function serversPage({ user, managed, invitable }) {
  const managedRows = managed
    .map(
      (g) => `<div class="server-row"><span class="name">${escapeHtml(g.name)}</span><a class="btn" href="/servers/select/${g.id}">Gestionar</a></div>`,
    )
    .join('');

  const invitableRows = invitable
    .map(
      (g) => `<div class="server-row"><span class="name">${escapeHtml(g.name)}</span><a class="btn invite" href="${g.inviteUrl}">Invitar bot</a></div>`,
    )
    .join('');

  const body = `
  <h1>Tus servers</h1>
  <p class="muted">Solo se listan los servers donde tenés permiso de Gestionar servidor.</p>

  <div class="card">
    <h2>Ya gestionás</h2>
    <div class="server-list">${managedRows || '<p class="muted">Ninguno todavía.</p>'}</div>
  </div>

  <div class="card">
    <h2>Podés invitar el bot</h2>
    <div class="server-list">${invitableRows || '<p class="muted">Ninguno pendiente.</p>'}</div>
  </div>

  <p><a href="/servers/refresh">🔄 Actualizar lista</a></p>`;
  return layout({ title: 'Tus servers', user, body });
}

function levelsPage({ user, config, roles, channels, guildName, flash }) {
  const roleOptions = (selected) =>
    `<option value="">--</option>` +
    roles.map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
  const channelOptions = channels.map((c) => `<option value="${c.id}" ${c.id === config.leveling.levelUpChannelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const existingRoles = config.leveling.levelRoles || [];
  const rows = Array.from({ length: 5 }, (_, i) => existingRoles[i] || {});

  const roleRows = rows
    .map(
      (r, i) => `<div class="row-grid">
        <input type="number" name="level_${i + 1}" placeholder="Nivel" min="1" value="${r.level ?? ''}">
        <select name="role_${i + 1}">${roleOptions(r.roleId)}</select>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Niveles / XP</h1>
  <form class="card" method="post" action="/dashboard/niveles">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="l-enabled" ${config.leveling.enabled ? 'checked' : ''}>
      <label for="l-enabled" style="margin:0;">Activado</label></div>

    <label>XP mínima y máxima por mensaje</label>
    <div class="row-grid" style="grid-template-columns: 1fr 1fr;">
      <input type="number" name="xpMin" min="1" value="${escapeHtml(config.leveling.xpMin)}">
      <input type="number" name="xpMax" min="1" value="${escapeHtml(config.leveling.xpMax)}">
    </div>

    <label>Cooldown entre mensajes que dan XP (segundos)</label>
    <input type="number" name="cooldownSeconds" min="0" value="${escapeHtml(config.leveling.cooldownSeconds)}">

    <label>Canal para avisos de subida de nivel (vacío = el mismo canal donde escribió)</label>
    <select name="levelUpChannelId"><option value="">-- mismo canal --</option>${channelOptions}</select>

    <label>Roles por nivel (hasta 5)</label>
    <p class="muted">Cuando alguien llega a ese nivel, se le asigna el rol automáticamente.</p>
    ${roleRows}

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Niveles', user, body, flash, guildName });
}

function reactionRolesPage({ user, sets, channels, roles, guildName, flash }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  const roleOptions = `<option value="">--</option>` + roles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  const pairRows = Array.from(
    { length: 5 },
    (_, i) => `<div class="row-grid">
      <input type="text" name="emoji_${i + 1}" placeholder="Emoji (ej 🎨)">
      <select name="role_${i + 1}">${roleOptions}</select>
      <input type="text" name="label_${i + 1}" placeholder="Etiqueta (opcional)">
    </div>`,
  ).join('');

  const existingRows = sets
    .map(
      (s) => `<div class="server-row">
        <span class="name">#${escapeHtml(channels.find((c) => c.id === s.channelId)?.name || s.channelId)} — ${s.pairs.length} rol(es)</span>
        <form method="post" action="/dashboard/roles-reaccion/eliminar" style="margin:0;">
          <input type="hidden" name="messageId" value="${escapeHtml(s.messageId)}">
          <button type="submit" style="margin:0; background:#ed4245;">Eliminar</button>
        </form>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Roles por reacción</h1>

  <div class="card">
    <h2>Mensajes activos</h2>
    <div class="server-list">${existingRows || '<p class="muted">Todavía no creaste ninguno.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/roles-reaccion">
    <h2>Crear mensaje nuevo</h2>
    <label>Canal</label>
    <select name="channelId" required>${channelOptions}</select>
    <label>Título (opcional)</label>
    <input type="text" name="titulo">
    <label>Descripción (opcional)</label>
    <textarea name="descripcion" style="min-height:70px;"></textarea>
    <label>Pares emoji / rol (hasta 5, dejá vacío lo que no uses)</label>
    ${pairRows}
    <button type="submit">Crear</button>
  </form>`;
  return layout({ title: 'Roles por reacción', user, body, flash, guildName });
}

function logsPage({ user, config, channels, guildName, flash }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}" ${c.id === config.logging.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
  const mismatch = config.logging.enabled && !config.logging.channelId;

  const body = `
  <h1>Registro de actividad (logs)</h1>
  <form class="card" method="post" action="/dashboard/logs">
    ${mismatch ? '<div class="warning-banner">⚠️ Está activado pero no elegiste canal, así que no se registra nada. Elegí uno abajo.</div>' : ''}
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="log-enabled" ${config.logging.enabled ? 'checked' : ''}>
      <label for="log-enabled" style="margin:0;">Activado</label></div>

    <label>Canal de logs</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <div class="checkbox-row"><input type="checkbox" name="logDeletes" id="log-del" ${config.logging.logDeletes ? 'checked' : ''}>
      <label for="log-del" style="margin:0;">Mensajes borrados</label></div>
    <div class="checkbox-row"><input type="checkbox" name="logEdits" id="log-edit" ${config.logging.logEdits ? 'checked' : ''}>
      <label for="log-edit" style="margin:0;">Mensajes editados</label></div>
    <div class="checkbox-row"><input type="checkbox" name="logJoins" id="log-join" ${config.logging.logJoins ? 'checked' : ''}>
      <label for="log-join" style="margin:0;">Entradas / salidas de miembros</label></div>
    <div class="checkbox-row"><input type="checkbox" name="logModeration" id="log-mod" ${config.logging.logModeration ? 'checked' : ''}>
      <label for="log-mod" style="margin:0;">Acciones de moderación (ban/kick/mute/warn)</label></div>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Logs', user, body, flash, guildName });
}

function customCommandsPage({ user, config, guildName, flash }) {
  const rows = (config.customCommands || [])
    .map(
      (cmd) => `<div class="server-row">
        <span class="name">/${escapeHtml(cmd.name)} ${cmd.adminOnly ? '· solo admins' : `· cooldown ${cmd.cooldownSeconds}s`}</span>
        <form method="post" action="/dashboard/comandos/eliminar" style="margin:0;">
          <input type="hidden" name="name" value="${escapeHtml(cmd.name)}">
          <button type="submit" style="margin:0; background:#ed4245;">Eliminar</button>
        </form>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Comandos personalizados</h1>
  <p class="muted">Se registran como comandos de barra /nombre. Puede tardar un minuto en aparecer en Discord.</p>

  <div class="card">
    <h2>Comandos activos</h2>
    <div class="server-list">${rows || '<p class="muted">Todavía no creaste ninguno.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/comandos">
    <h2>Crear comando</h2>
    <label>Nombre (sin "/", minúsculas, sin espacios)</label>
    <input type="text" name="name" required maxlength="32" pattern="[a-z0-9_-]+">
    <label>Descripción (se ve en el autocompletado de Discord)</label>
    <input type="text" name="description" maxlength="100">
    <label>Respuesta (podés usar <code>{user}</code>)</label>
    <textarea name="response" required></textarea>
    <div class="checkbox-row"><input type="checkbox" name="adminOnly" id="cc-admin">
      <label for="cc-admin" style="margin:0;">Solo para administradores</label></div>
    <label>Cooldown para usuarios normales (segundos, ignorado si es solo-admin)</label>
    <input type="number" name="cooldownSeconds" min="0" value="10">
    <button type="submit">Crear</button>
  </form>`;
  return layout({ title: 'Comandos', user, body, flash, guildName });
}

function housesPage({ user, config, channels, guildName, flash }) {
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const showMismatchWarning = config.houses.requestMessageId && !config.houses.enabled;

  const body = `
  <h1>Solicitudes de House</h1>
  <p class="muted">Publicá un mensaje con botón en un canal — al apretarlo, el usuario completa el formulario. Las respuestas llegan al canal de revisión con botones de Aceptar/Rechazar (requieren permiso de Gestionar servidor). También funciona con <code>/casa</code>.</p>

  ${showMismatchWarning ? '<div class="warning-banner">⚠️ El mensaje sigue publicado en Discord, pero el sistema está desactivado — quien apriete el botón va a recibir un error. Activalo de nuevo o volvé a publicar para dar de baja el mensaje.</div>' : ''}

  <form class="card" method="post" action="/dashboard/houses">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="h-enabled" ${config.houses.enabled ? 'checked' : ''}>
      <label for="h-enabled" style="margin:0;">Activado</label></div>

    <label>Canal donde va el mensaje con el botón</label>
    <select name="requestChannelId"><option value="">-- elegir --</option>${channelOptions(config.houses.requestChannelId)}</select>

    <label>Título del mensaje</label>
    <input type="text" name="requestTitle" value="${escapeHtml(config.houses.requestTitle)}">

    <label>Descripción del mensaje</label>
    <textarea name="requestDescription">${escapeHtml(config.houses.requestDescription)}</textarea>

    <label>Canal de revisión (solo lo debería ver tu staff)</label>
    <select name="reviewChannelId"><option value="">-- elegir --</option>${channelOptions(config.houses.reviewChannelId)}</select>

    <label>Campos del formulario (uno por línea, hasta 5)</label>
    <textarea name="formFields">${escapeHtml((config.houses.formFields || []).join('\n'))}</textarea>

    <label>Mensaje por MD si se acepta</label>
    <textarea name="acceptMessage">${escapeHtml(config.houses.acceptMessage)}</textarea>

    <label>Mensaje por MD si se rechaza</label>
    <textarea name="rejectMessage">${escapeHtml(config.houses.rejectMessage)}</textarea>

    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/houses/publicar">
    <h2>Publicar / actualizar el mensaje con botón</h2>
    <p class="muted">Guardá los cambios de arriba primero. Esto borra el mensaje anterior (si había) y publica uno nuevo con la config actual.</p>
    <button type="submit">Publicar mensaje</button>
  </form>`;
  return layout({ title: 'Houses', user, body, flash, guildName });
}

function moderationSettingsPage({ user, config, roles, guildName, flash }) {
  const protectedIds = config.protectedRoleIds || [];
  const roleCheckboxes = roles
    .map(
      (r) => `<div class="checkbox-row">
        <input type="checkbox" name="protectedRoleIds" value="${r.id}" id="role-${r.id}" ${protectedIds.includes(r.id) ? 'checked' : ''}>
        <label for="role-${r.id}" style="margin:0;">${escapeHtml(r.name)}</label>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Moderación</h1>
  <form class="card" method="post" action="/dashboard/moderacion">
    <h2>Roles protegidos</h2>
    <p class="muted">/ban, /kick y /mute van a rechazar la acción si el usuario tiene alguno de estos roles.</p>
    ${roleCheckboxes || '<p class="muted">Este server no tiene roles asignables.</p>'}
    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Moderación', user, body, flash, guildName });
}

function economyPage({ user, config, guildName, flash }) {
  const shopItemsText = (config.economy.shopItems || [])
    .map((item) => `${item.name}|${item.price}|${item.description || ''}`)
    .join('\n');

  const body = `
  <h1>Economía</h1>
  <form class="card" method="post" action="/dashboard/economia">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="e-enabled" ${config.economy.enabled ? 'checked' : ''}>
      <label for="e-enabled" style="margin:0;">Activada</label></div>

    <label>Nombre de la moneda</label>
    <input type="text" name="currencyName" value="${escapeHtml(config.economy.currencyName)}">

    <label>Emoji/símbolo de la moneda</label>
    <input type="text" name="currencySymbol" value="${escapeHtml(config.economy.currencySymbol)}">

    <label>Monto de /economia daily</label>
    <input type="number" name="dailyAmount" min="0" value="${escapeHtml(config.economy.dailyAmount)}">

    <label>Rango de /economia work (mínimo y máximo)</label>
    <div class="row-grid" style="grid-template-columns: 1fr 1fr;">
      <input type="number" name="workMinAmount" min="0" value="${escapeHtml(config.economy.workMinAmount)}">
      <input type="number" name="workMaxAmount" min="0" value="${escapeHtml(config.economy.workMaxAmount)}">
    </div>

    <label>Cooldown de /economia work (minutos)</label>
    <input type="number" name="workCooldownMinutes" min="1" value="${escapeHtml(config.economy.workCooldownMinutes)}">

    <label>Tienda: un item por línea, formato <code>nombre|precio|descripción</code> (la descripción es opcional)</label>
    <textarea name="shopItemsText" style="min-height:140px; font-family: monospace;">${escapeHtml(shopItemsText)}</textarea>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Economía', user, body, flash, guildName });
}

function casinoSettingsPage({ user, config, guildName, flash }) {
  const body = `
  <h1>Casino</h1>
  <p class="muted">Usa la moneda configurada en Economía. Necesitás tener Economía activada para que funcione.</p>
  <form class="card" method="post" action="/dashboard/casino">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="c-enabled" ${config.casino.enabled ? 'checked' : ''}>
      <label for="c-enabled" style="margin:0;">Activado</label></div>

    <label>Apuesta mínima</label>
    <input type="number" name="minBet" min="1" value="${escapeHtml(config.casino.minBet)}">

    <label>Apuesta máxima</label>
    <input type="number" name="maxBet" min="1" value="${escapeHtml(config.casino.maxBet)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Casino', user, body, flash, guildName });
}

function petsSettingsPage({ user, config, guildName, flash }) {
  const body = `
  <h1>Mascotas</h1>
  <form class="card" method="post" action="/dashboard/mascotas">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="p-enabled" ${config.pets.enabled ? 'checked' : ''}>
      <label for="p-enabled" style="margin:0;">Activado</label></div>

    <label>Cooldown para alimentar (minutos)</label>
    <input type="number" name="feedCooldownMinutes" min="1" value="${escapeHtml(config.pets.feedCooldownMinutes)}">

    <label>Cooldown para jugar (minutos)</label>
    <input type="number" name="playCooldownMinutes" min="1" value="${escapeHtml(config.pets.playCooldownMinutes)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Mascotas', user, body, flash, guildName });
}

function starboardPage({ user, config, channels, guildName, flash }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.starboard.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');

  const body = `
  <h1>Starboard</h1>
  <p class="muted">Cuando un mensaje junta suficientes reacciones de un emoji, se republica en el canal que elijas (ideal para un canal tipo #destacados). La reacción del propio autor no cuenta.</p>
  <form class="card" method="post" action="/dashboard/starboard">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="sb-enabled" ${config.starboard.enabled ? 'checked' : ''}>
      <label for="sb-enabled" style="margin:0;">Activado</label></div>

    <label>Emoji a contar</label>
    <input type="text" name="emoji" value="${escapeHtml(config.starboard.emoji)}" maxlength="10">

    <label>Cantidad mínima de reacciones</label>
    <input type="number" name="threshold" min="1" value="${escapeHtml(config.starboard.threshold)}">

    <label>Canal de destacados</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Starboard', user, body, flash, guildName });
}

function triviaPage({ user, config, guildName, flash }) {
  const questionsText = (config.trivia.questions || [])
    .map((q) => `${q.question}|${q.options[0]}|${q.options[1]}|${q.options[2]}|${q.options[3]}|${q.correctIndex + 1}`)
    .join('\n');

  const body = `
  <h1>Trivia</h1>
  <p class="muted">Con <code>/trivia</code>, el bot tira una pregunta al azar con 4 opciones (A-D). El primero en apretar el botón correcto gana la recompensa.</p>
  <form class="card" method="post" action="/dashboard/trivia">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="tr-enabled" ${config.trivia.enabled ? 'checked' : ''}>
      <label for="tr-enabled" style="margin:0;">Activada</label></div>

    <label>Recompensa por acertar</label>
    <input type="number" name="rewardAmount" min="1" value="${escapeHtml(config.trivia.rewardAmount)}">

    <label>Preguntas: una por línea, formato <code>pregunta|opciónA|opciónB|opciónC|opciónD|correcta(1-4)</code></label>
    <textarea name="questionsText" style="min-height:200px; font-family: monospace;">${escapeHtml(questionsText)}</textarea>

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Trivia', user, body, flash, guildName });
}

function miniEventsPage({ user, config, channels, guildName, flash }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.miniEvents.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
  const mismatch = config.miniEvents.enabled && !config.miniEvents.channelId;

  const body = `
  <h1>Eventos automáticos</h1>
  <p class="muted">De vez en cuando el bot publica un mensaje sorpresa — el primero en reaccionar gana monedas.</p>
  ${mismatch ? '<div class="warning-banner">⚠️ Está activado pero no elegiste canal, así que no se publica nada. Elegí uno abajo.</div>' : ''}
  <form class="card" method="post" action="/dashboard/eventos">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="me-enabled" ${config.miniEvents.enabled ? 'checked' : ''}>
      <label for="me-enabled" style="margin:0;">Activado</label></div>

    <label>Canal donde se publican</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <label>Cada cuánto (minutos)</label>
    <input type="number" name="intervalMinutes" min="5" value="${escapeHtml(config.miniEvents.intervalMinutes)}">

    <label>Recompensa</label>
    <input type="number" name="reward" min="1" value="${escapeHtml(config.miniEvents.reward)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Eventos', user, body, flash, guildName });
}

function aiPage({ user, config, aiConfigured, guildName, flash }) {
  const hasOwnKey = Boolean(config.ai.apiKey);
  const setupWarning = !aiConfigured
    ? `<div class="warning-banner">⚠️ Todavía no configuraste una clave de Groq. Podés activar estas opciones, pero no van a hacer nada hasta que pongas una clave abajo.</div>`
    : '';

  const body = `
  <h1>IA (gratis, con Groq)</h1>
  <p class="muted">Usa un modelo de IA gratuito para dos cosas puntuales: responder mejor cuando el sistema normal no entiende, y ayudar a detectar mensajes tóxicos que el filtro de palabras no capta.</p>
  ${setupWarning}

  <div class="card">
    <h2>Cómo conseguir la clave (gratis, sin tarjeta)</h2>
    <ol style="margin:0; padding-left:20px; font-size:14px; color:#dbdee1; line-height:1.8;">
      <li>Andá a <a href="https://console.groq.com/keys" target="_blank" rel="noopener" style="color:#8ea1ff;">console.groq.com/keys</a> e iniciá sesión (podés usar Google).</li>
      <li>Click en <strong>"Create API Key"</strong>, ponele un nombre y creala.</li>
      <li>Copiala y pegala abajo, en el campo "Clave de Groq".</li>
    </ol>
  </div>

  <form class="card" method="post" action="/dashboard/ia">
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="ai-enabled" ${config.ai.enabled ? 'checked' : ''}>
      <label for="ai-enabled" style="margin:0;">Activada</label></div>

    <div class="checkbox-row"><input type="checkbox" name="helpFallback" id="ai-help" ${config.ai.helpFallback ? 'checked' : ''}>
      <label for="ai-help" style="margin:0;">Usar IA cuando no encuentra un tema específico de ayuda</label></div>

    <div class="checkbox-row"><input type="checkbox" name="moderation" id="ai-mod" ${config.ai.moderation ? 'checked' : ''}>
      <label for="ai-mod" style="margin:0;">Usar IA para detectar mensajes tóxicos (además del filtro de palabras)</label></div>

    <label>Clave de Groq ${hasOwnKey ? '(ya tenés una guardada — dejá esto vacío para no cambiarla)' : ''}</label>
    <input type="password" name="apiKey" placeholder="${hasOwnKey ? '••••••••••••••••' : 'gsk_...'}" autocomplete="off">

    ${hasOwnKey ? `<div class="checkbox-row"><input type="checkbox" name="removeApiKey" id="ai-remove-key">
      <label for="ai-remove-key" style="margin:0;">Quitar la clave guardada</label></div>` : ''}

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'IA', user, body, flash, guildName });
}

function serverGuidePage({ user, config, channels, guildName, flash, editingSection }) {
  const channelOptions = channels
    .map((c) => `<option value="${c.id}" ${c.id === config.serverGuide.channelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');

  const sectionRows = (config.serverGuide.sections || [])
    .map(
      (s) => `<div class="server-row">
        <span class="name">${s.emoji || ''} ${escapeHtml(s.label)}</span>
        <div style="display:flex; gap:8px;">
          <a class="btn" href="/dashboard/guia?edit=${encodeURIComponent(s.id)}" style="background:#4752c4;">Editar</a>
          <form method="post" action="/dashboard/guia/seccion/eliminar" style="margin:0;">
            <input type="hidden" name="id" value="${escapeHtml(s.id)}">
            <button type="submit" style="margin:0; background:#ed4245;">Eliminar</button>
          </form>
        </div>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Guía del servidor</h1>
  <p class="muted">Publicá un panel con botones — cada uno muestra el contenido de esa sección (visible solo para quien lo aprieta).</p>

  <div class="card">
    <h2>Secciones</h2>
    <div class="server-list">${sectionRows || '<p class="muted">Todavía no hay secciones.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/guia/seccion">
    <h2>${editingSection ? 'Editar sección' : 'Nueva sección'}</h2>
    ${editingSection ? `<input type="hidden" name="id" value="${escapeHtml(editingSection.id)}">` : ''}
    <label>Nombre</label>
    <input type="text" name="label" required maxlength="80" value="${escapeHtml(editingSection ? editingSection.label : '')}">
    <label>Emoji (opcional)</label>
    <input type="text" name="emoji" maxlength="10" value="${escapeHtml(editingSection ? editingSection.emoji || '' : '')}">
    <label>Contenido</label>
    <textarea name="content" required style="min-height:100px;">${escapeHtml(editingSection ? editingSection.content : '')}</textarea>
    <button type="submit">${editingSection ? 'Guardar cambios' : 'Crear sección'}</button>
    ${editingSection ? '<a href="/dashboard/guia" style="margin-left:12px; color:#b5bac1; font-size:13px;">Cancelar</a>' : ''}
  </form>

  <form class="card" method="post" action="/dashboard/guia">
    <h2>Panel</h2>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="guide-enabled" ${config.serverGuide.enabled ? 'checked' : ''}>
      <label for="guide-enabled" style="margin:0;">Activado</label></div>

    <label>Canal donde va el panel</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <label>Título</label>
    <input type="text" name="title" value="${escapeHtml(config.serverGuide.title)}">

    <label>Descripción</label>
    <textarea name="description">${escapeHtml(config.serverGuide.description)}</textarea>

    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/guia/publicar">
    <h2>Publicar / actualizar el panel</h2>
    <p class="muted">Guardá los cambios de arriba primero. Esto borra el panel anterior (si había) y publica uno nuevo con las secciones actuales.</p>
    <button type="submit">Publicar panel</button>
  </form>`;
  return layout({ title: 'Guía', user, body, flash, guildName });
}

function ticketConfigPage({ user, config, channels, roles, guildName, flash }) {
  const channelOptions = (selected) =>
    channels.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');

  const roleOptions = (selectedIds) =>
    roles.map((r) => `<option value="${r.id}" ${selectedIds.includes(r.id) ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');

  const categoryRows = (config.ticketCategories || [])
    .map(
      (cat) => `<div class="server-row">
        <span class="name">${cat.emoji || '🎫'} ${escapeHtml(cat.label)} ${cat.staffRoleIds?.length ? `· ${cat.staffRoleIds.length} rol(es)` : '· sin rol (usa Manage Server)'}</span>
        <form method="post" action="/dashboard/tickets/config/categoria/eliminar" style="margin:0;">
          <input type="hidden" name="id" value="${escapeHtml(cat.id)}">
          <button type="submit" style="margin:0; background:#ed4245;">Eliminar</button>
        </form>
      </div>`,
    )
    .join('');

  const body = `
  <h1>Configuración de tickets</h1>

  <div class="card">
    <h2>Categorías</h2>
    <p class="muted">Cada categoría aparece como opción en el menú del panel. Si no elegís roles de staff, se usa cualquier rol con "Gestionar servidor".</p>
    <div class="server-list">${categoryRows || '<p class="muted">Todavía no hay categorías.</p>'}</div>
  </div>

  <form class="card" method="post" action="/dashboard/tickets/config/categoria">
    <h2>Nueva categoría</h2>
    <label>Nombre</label>
    <input type="text" name="label" required maxlength="80">
    <label>Emoji</label>
    <input type="text" name="emoji" placeholder="🎫" maxlength="10">
    <label>Descripción (se muestra dentro del ticket)</label>
    <textarea name="description" style="min-height:70px;"></textarea>
    <label>Roles de staff con acceso (opcional, podés elegir varios)</label>
    <select name="staffRoleIds" multiple size="5">${roleOptions([])}</select>
    <button type="submit">Crear categoría</button>
  </form>

  <form class="card" method="post" action="/dashboard/tickets/config/panel">
    <h2>Panel</h2>
    <label>Canal donde va el panel</label>
    <select name="channelId"><option value="">-- elegir --</option>${channelOptions(config.ticketPanel.channelId)}</select>
    <label>Título</label>
    <input type="text" name="title" value="${escapeHtml(config.ticketPanel.title)}">
    <label>Descripción</label>
    <textarea name="description">${escapeHtml(config.ticketPanel.description)}</textarea>

    <h2>Transcripciones</h2>
    <div class="checkbox-row"><input type="checkbox" name="transcriptsEnabled" id="t-enabled" ${config.ticketTranscripts.enabled ? 'checked' : ''}>
      <label for="t-enabled" style="margin:0;">Activadas</label></div>
    <label>Canal de transcripciones</label>
    <select name="transcriptsChannelId"><option value="">-- elegir --</option>${channelOptions(config.ticketTranscripts.channelId)}</select>

    <h2>Encuesta de satisfacción</h2>
    <div class="checkbox-row"><input type="checkbox" name="feedbackEnabled" id="f-enabled" ${config.ticketFeedback.enabled ? 'checked' : ''}>
      <label for="f-enabled" style="margin:0;">Activada (se manda por MD al cerrar el ticket)</label></div>

    <button type="submit">Guardar</button>
  </form>

  <form class="card" method="post" action="/dashboard/tickets/config/panel/publicar">
    <h2>Publicar / actualizar el panel</h2>
    <p class="muted">Guardá los cambios de arriba primero. Esto borra el panel anterior (si había) y publica uno nuevo.</p>
    <button type="submit">Publicar panel</button>
  </form>`;
  return layout({ title: 'Config. Tickets', user, body, flash, guildName });
}

function debugPage({ user, config, channels, guildName, flash, stats }) {
  const channelOptions = channels.map((c) => `<option value="${c.id}" ${c.id === config.debug.errorChannelId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
  const mismatch = config.debug.enabled && !config.debug.errorChannelId;

  const body = `
  <h1>Estado / Debug</h1>

  <div class="card">
    <h2>Estado del bot</h2>
    <table>
      <tr><td>Versión</td><td>${escapeHtml(stats.version)}</td></tr>
      <tr><td>Node</td><td>${escapeHtml(stats.nodeVersion)}</td></tr>
      <tr><td>Ping</td><td>${stats.ping}ms</td></tr>
      <tr><td>Uptime</td><td>${escapeHtml(stats.uptime)}</td></tr>
      <tr><td>Servers conectados</td><td>${stats.guildCount}</td></tr>
      <tr><td>Memoria (heap)</td><td>${stats.memoryMb} MB</td></tr>
    </table>
  </div>

  <form class="card" method="post" action="/dashboard/debug">
    <h2>Canal de errores</h2>
    ${mismatch ? '<div class="warning-banner">⚠️ Está activado pero no elegiste canal, así que no se reportan errores. Elegí uno abajo.</div>' : ''}
    <p class="muted">Si algo falla internamente, el bot puede avisarte en un canal de Discord.</p>
    <div class="checkbox-row"><input type="checkbox" name="enabled" id="debug-enabled" ${config.debug.enabled ? 'checked' : ''}>
      <label for="debug-enabled" style="margin:0;">Activado</label></div>

    <label>Canal para reportar errores</label>
    <select name="errorChannelId"><option value="">-- elegir --</option>${channelOptions}</select>

    <button type="submit">Guardar</button>
  </form>

  <div class="card">
    <h2>Comando /debug</h2>
    <p class="muted">Cualquier miembro con permiso "Gestionar servidor" puede usar <code>/debug</code> en Discord para ver esta misma info técnica al instante.</p>
  </div>`;
  return layout({ title: 'Estado / Debug', user, body, flash, guildName });
}

function appearancePage({ user, config, guildName, flash }) {
  const colorLabels = { brand: 'Marca', success: 'Éxito', error: 'Error', warning: 'Advertencia', info: 'Info' };
  const colorRows = Object.keys(colorLabels)
    .map(
      (key) => `<div class="color-row">
        <label for="color-${key}">${colorLabels[key]}</label>
        <input type="color" id="color-${key}" name="color_${key}" value="${escapeHtml(config.branding.colors[key])}">
      </div>`,
    )
    .join('');

  const body = `
  <h1>Apariencia</h1>
  <p class="muted">Personalizá cómo se ve el bot en este server: los colores de sus embeds, el pie de página y su apodo.</p>

  <form class="card" method="post" action="/dashboard/apariencia">
    <h2>Colores de los embeds</h2>
    <p class="muted">Se usan en casi todos los mensajes con formato del bot (tickets, niveles, economía, moderación, etc).</p>
    ${colorRows}

    <h2 style="margin-top:24px;">Firma de los embeds</h2>
    <label>Texto del footer (opcional)</label>
    <input type="text" name="footerText" maxlength="100" placeholder="Ej: Powered by tu server" value="${escapeHtml(config.branding.footerText)}">
    <label>URL del ícono del footer (opcional)</label>
    <input type="text" name="footerIcon" maxlength="300" placeholder="https://..." value="${escapeHtml(config.branding.footerIcon)}">

    <h2 style="margin-top:24px;">Apodo del bot</h2>
    <label>Cómo se muestra el nombre del bot en este server (dejá vacío para usar el default)</label>
    <input type="text" name="nickname" maxlength="32" value="${escapeHtml(config.branding.nickname)}">

    <button type="submit">Guardar</button>
  </form>`;
  return layout({ title: 'Apariencia', user, body, flash, guildName });
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
  serversPage,
  levelsPage,
  reactionRolesPage,
  logsPage,
  customCommandsPage,
  housesPage,
  moderationSettingsPage,
  economyPage,
  casinoSettingsPage,
  petsSettingsPage,
  ticketConfigPage,
  starboardPage,
  triviaPage,
  miniEventsPage,
  aiPage,
  serverGuidePage,
  debugPage,
  appearancePage,
};
