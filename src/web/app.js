const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const crypto = require('crypto');
const { ChannelType, EmbedBuilder } = require('discord.js');
const {
  buildAuthorizeUrl,
  buildBotInviteUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  fetchUserGuilds,
  hasManagePermission,
} = require('./discordOAuth');
const views = require('./views');
const db = require('../db');
const reactionRoles = require('../reactionRoles');
const selectRoles = require('../selectRoles');
const customCommands = require('../customCommands');
const commandRegistry = require('../commandRegistry');
const housesCommand = require('../housesCommand');
const ticketCommand = require('../ticketCommand');
const aiHelper = require('../aiHelper');
const serverGuide = require('../serverGuide');
const debugCommand = require('../debugCommand');
const inviteTracker = require('../inviteTracker');
const { resolveColor } = require('../embedStyle');
const pkg = require('../../package.json');

// View/Send/History/ManageMessages/ManageChannels/EmbedLinks/AddReactions/Kick/Ban/ManageRoles/ModerateMembers/ManageGuild
const BOT_INVITE_PERMISSIONS = 1099780156534;

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function createApp({ client }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true, // cada visita renueva los 30 dias, no vence mientras se siga usando
      store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME || 'discordTipsBot',
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 30, // 30 dias, tiene que coincidir con el maxAge de la cookie
      }),
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  const oauthConfig = () => ({
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: `${process.env.DASHBOARD_URL}/auth/callback`,
  });

  function requireAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
  }

  function requireActiveGuild(req, res, next) {
    const guildId = req.session.activeGuildId;
    const manageable = req.session.manageableGuilds || [];
    const isManageable = manageable.some((g) => g.id === guildId);

    if (!guildId || !isManageable || !client.guilds.cache.has(guildId)) {
      return res.redirect('/servers');
    }
    next();
  }

  function getGuild(req) {
    return client.guilds.cache.get(req.session.activeGuildId);
  }

  function getTextChannels(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getVoiceChannels(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildVoice)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getAssignableRoles(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .map((r) => ({ id: r.id, name: r.name, emoji: r.unicodeEmoji || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function guildName(req) {
    return getGuild(req)?.name || null;
  }

  app.get('/', (req, res) => {
    res.type('text/plain').send('Bot activo');
  });

  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/servers');

    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const { clientId, redirectUri } = oauthConfig();
    res.send(views.loginPage({ authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state }) }));
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return res
        .status(400)
        .send(views.loginPage({ authorizeUrl: '/login', error: 'Sesión inválida, intentá loguearte de nuevo.' }));
    }

    try {
      const { clientId, clientSecret, redirectUri } = oauthConfig();
      const token = await exchangeCodeForToken({ clientId, clientSecret, redirectUri, code });
      const [discordUser, guilds] = await Promise.all([
        fetchDiscordUser(token.access_token),
        fetchUserGuilds(token.access_token),
      ]);

      const manageableGuilds = guilds
        .filter((g) => hasManagePermission(g.permissions))
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));

      if (!manageableGuilds.length) {
        // se guarda el nuevo state en sesion para que el link de "intentar de
        // nuevo" funcione (si no, el proximo callback siempre lo rechaza)
        const retryState = crypto.randomBytes(16).toString('hex');
        req.session.oauthState = retryState;
        return res.status(403).send(
          views.loginPage({
            authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state: retryState }),
            error: 'Tu cuenta no tiene permiso de administrador en ningún server.',
          }),
        );
      }

      // se regenera el id de sesion despues de autenticar (evita session fixation:
      // un id de sesion fijado antes del login no queda autenticado despues)
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error('No se pudo regenerar la sesión tras el login:', regenErr);
          return res
            .status(500)
            .send(views.loginPage({ authorizeUrl: '/login', error: 'Ocurrió un error al iniciar sesión, probá de nuevo.' }));
        }

        req.session.user = { id: discordUser.id, username: discordUser.username };
        req.session.accessToken = token.access_token;
        req.session.manageableGuilds = manageableGuilds;
        res.redirect('/servers');
      });
    } catch (err) {
      console.error('Error en OAuth callback:', err);
      res
        .status(500)
        .send(views.loginPage({ authorizeUrl: '/login', error: 'Ocurrió un error al iniciar sesión, probá de nuevo.' }));
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  app.get('/servers', requireAuth, (req, res) => {
    const manageable = req.session.manageableGuilds || [];
    const managed = [];
    const invitable = [];

    for (const g of manageable) {
      if (client.guilds.cache.has(g.id)) {
        managed.push(g);
      } else {
        invitable.push({
          ...g,
          inviteUrl: buildBotInviteUrl({ clientId: process.env.DISCORD_CLIENT_ID, permissions: BOT_INVITE_PERMISSIONS, guildId: g.id }),
        });
      }
    }

    res.send(views.serversPage({ user: req.session.user, managed, invitable }));
  });

  app.get('/servers/select/:guildId', requireAuth, (req, res) => {
    const { guildId } = req.params;
    const manageable = req.session.manageableGuilds || [];
    const allowed = manageable.some((g) => g.id === guildId) && client.guilds.cache.has(guildId);

    if (!allowed) return res.redirect('/servers');

    req.session.activeGuildId = guildId;
    res.redirect('/dashboard');
  });

  app.get('/servers/refresh', requireAuth, async (req, res) => {
    try {
      const guilds = await fetchUserGuilds(req.session.accessToken);
      req.session.manageableGuilds = guilds
        .filter((g) => hasManagePermission(g.permissions))
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
    } catch (err) {
      console.error('No se pudo refrescar la lista de servers:', err);
    }
    res.redirect('/servers');
  });

  app.get('/dashboard', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.generalPage({ user: req.session.user, config, guildName: guildName(req), flash: req.query.saved ? 'Guardado.' : null }),
    );
  });

  app.post('/dashboard/general', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      language: req.body.language === 'en' ? 'en' : 'es',
      tipsIntervalMinutes: Math.max(1, Number(req.body.tipsIntervalMinutes) || 20),
    });
    res.redirect('/dashboard?saved=1');
  });

  app.get('/dashboard/bienvenida', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.welcomePage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/bienvenida/welcome', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      welcome: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.welcome.message,
        useEmbed: req.body.useEmbed === 'on',
        roleId: req.body.roleId || null,
      },
    });
    res.redirect('/dashboard/bienvenida?saved=1');
  });

  app.post('/dashboard/bienvenida/goodbye', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      goodbye: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.goodbye.message,
        useEmbed: req.body.useEmbed === 'on',
      },
    });
    res.redirect('/dashboard/bienvenida?saved=1');
  });

  app.get('/dashboard/automoderacion', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.automodPage({ user: req.session.user, config, guildName: guildName(req), flash: req.query.saved ? 'Guardado.' : null }),
    );
  });

  app.post('/dashboard/automoderacion', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      automod: {
        enabled: req.body.enabled === 'on',
        bannedWords: (req.body.bannedWords || '')
          .split('\n')
          .map((w) => w.trim().toLowerCase())
          .filter(Boolean),
        blockInvites: req.body.blockInvites === 'on',
        mentionSpamLimit: Math.max(0, Number(req.body.mentionSpamLimit) || 0),
      },
    });
    res.redirect('/dashboard/automoderacion?saved=1');
  });

  app.get('/dashboard/mensajes', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const editingTopic = req.query.editar
      ? (config.helpResponses.topics || []).find((t) => t.name === req.query.editar) || null
      : null;
    res.send(
      views.messagesPage({
        user: req.session.user,
        config,
        editingTopic,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/mensajes/tips', requireAuth, requireActiveGuild, async (req, res) => {
    const tips = (req.body.tips || '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    await db.updateGuildConfig(req.session.activeGuildId, { tips });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.post('/dashboard/mensajes/ayuda/general', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const generalTriggers = (req.body.generalTriggers || '')
      .split('\n')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    await db.updateGuildConfig(req.session.activeGuildId, {
      helpResponses: {
        ...config.helpResponses,
        generalTriggers,
        fallbackResponse: req.body.fallbackResponse || config.helpResponses.fallbackResponse,
      },
    });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.post('/dashboard/mensajes/ayuda/tema', requireAuth, requireActiveGuild, async (req, res) => {
    const name = (req.body.name || '').trim().toLowerCase().replace(/\s+/g, '-');
    const response = (req.body.response || '').trim();

    if (!name || !response) {
      return res.redirect(`/dashboard/mensajes?error=${encodeURIComponent('El tema necesita un nombre y una respuesta.')}`);
    }

    const keywords = (req.body.keywords || '')
      .split('\n')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const examples = (req.body.examples || '')
      .split('\n')
      .map((e) => e.trim())
      .filter(Boolean);

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const originalName = (req.body.originalName || '').trim().toLowerCase();
    const topics = (config.helpResponses.topics || []).filter((t) => t.name !== name && t.name !== originalName);
    topics.push({ name, keywords, examples, response });

    await db.updateGuildConfig(req.session.activeGuildId, {
      helpResponses: { ...config.helpResponses, topics },
    });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.post('/dashboard/mensajes/ayuda/tema/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const topics = (config.helpResponses.topics || []).filter((t) => t.name !== req.body.name);
    await db.updateGuildConfig(req.session.activeGuildId, { helpResponses: { ...config.helpResponses, topics } });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.get('/dashboard/anuncio', requireAuth, requireActiveGuild, (req, res) => {
    res.send(
      views.announcePage({
        user: req.session.user,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.sent ? 'Anuncio enviado.' : null,
      }),
    );
  });

  app.post('/dashboard/anuncio', requireAuth, requireActiveGuild, async (req, res) => {
    const { channelId, mensaje, titulo, color, imagen } = req.body;
    const guild = getGuild(req);
    const channel = guild ? guild.channels.cache.get(channelId) : null;

    if (!channel || !channel.isTextBased()) {
      return res
        .status(400)
        .send(views.announcePage({ user: req.session.user, channels: getTextChannels(req), guildName: guildName(req), flash: 'Canal inválido.' }));
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const embed = new EmbedBuilder().setDescription(mensaje).setColor(resolveColor(config, 'brand')).setTimestamp();
    if (titulo) embed.setTitle(titulo);
    if (/^#?[0-9a-fA-F]{6}$/.test(color || '')) embed.setColor(parseInt(color.replace('#', ''), 16));
    if (imagen && /^https?:\/\//.test(imagen)) embed.setImage(imagen);

    try {
      await channel.send({ embeds: [embed] });
      res.redirect('/dashboard/anuncio?sent=1');
    } catch (err) {
      console.error('No se pudo mandar el anuncio desde el dashboard:', err);
      res.status(500).send(
        views.announcePage({
          user: req.session.user,
          channels: getTextChannels(req),
          guildName: guildName(req),
          flash: 'No se pudo enviar (revisá permisos del bot en ese canal).',
        }),
      );
    }
  });

  app.get('/dashboard/estadisticas', requireAuth, requireActiveGuild, async (req, res) => {
    const stats = await db.getStats(req.session.activeGuildId);
    const leaderboard = await db.getLeaderboard(req.session.activeGuildId, 5);
    const channelNames = {};
    for (const c of getTextChannels(req)) channelNames[c.id] = c.name;
    res.send(views.statsPage({ user: req.session.user, stats, channelNames, leaderboard, guildName: guildName(req) }));
  });

  app.get('/dashboard/tickets', requireAuth, requireActiveGuild, async (req, res) => {
    const tickets = await db.listTickets(req.session.activeGuildId);
    res.send(views.ticketsPage({ user: req.session.user, tickets, guildName: guildName(req) }));
  });

  app.get('/dashboard/tickets/config', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.ticketConfigPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.published ? 'Panel publicado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/tickets/config/categoria', requireAuth, requireActiveGuild, async (req, res) => {
    const label = (req.body.label || '').trim();
    if (!label) {
      return res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('Ponele un nombre a la categoría.')}`);
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const id = slugify(label) || `cat-${Date.now()}`;
    const staffRoleIds = [].concat(req.body.staffRoleIds || []);

    const category = {
      id,
      label,
      emoji: (req.body.emoji || '🎫').trim(),
      description: (req.body.description || '').trim(),
      staffRoleIds,
    };

    const existing = (config.ticketCategories || []).filter((c) => c.id !== id);
    await db.updateGuildConfig(req.session.activeGuildId, { ticketCategories: [...existing, category] });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/categoria/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      ticketCategories: (config.ticketCategories || []).filter((c) => c.id !== req.body.id),
    });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/panel', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      ticketPanel: {
        ...config.ticketPanel,
        channelId: req.body.channelId || null,
        title: req.body.title || config.ticketPanel.title,
        description: req.body.description || config.ticketPanel.description,
      },
      ticketTranscripts: {
        enabled: req.body.transcriptsEnabled === 'on',
        channelId: req.body.transcriptsChannelId || null,
      },
      ticketFeedback: {
        enabled: req.body.feedbackEnabled === 'on',
      },
    });
    res.redirect('/dashboard/tickets/config?saved=1');
  });

  app.post('/dashboard/tickets/config/panel/publicar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    const config = await db.getGuildConfig(req.session.activeGuildId);

    if (!config.ticketCategories.length) {
      return res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('Creá al menos una categoría primero.')}`);
    }

    try {
      const messageId = await ticketCommand.publishPanel(guild, config);
      await db.updateGuildConfig(req.session.activeGuildId, { ticketPanel: { ...config.ticketPanel, messageId } });
      res.redirect('/dashboard/tickets/config?published=1');
    } catch (err) {
      console.error('No se pudo publicar el panel de tickets:', err);
      res.redirect(`/dashboard/tickets/config?error=${encodeURIComponent('No se pudo publicar: ' + err.message)}`);
    }
  });

  app.get('/dashboard/niveles', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.levelsPage({
        user: req.session.user,
        config,
        roles: getAssignableRoles(req),
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/niveles', requireAuth, requireActiveGuild, async (req, res) => {
    const levelRoles = [];
    for (let i = 1; i <= 5; i++) {
      const level = req.body[`level_${i}`];
      const roleId = req.body[`role_${i}`];
      if (level && roleId) {
        levelRoles.push({ level: Number(level), roleId });
      }
    }

    await db.updateGuildConfig(req.session.activeGuildId, {
      leveling: {
        enabled: req.body.enabled === 'on',
        xpMin: Math.max(1, Number(req.body.xpMin) || 15),
        xpMax: Math.max(1, Number(req.body.xpMax) || 25),
        cooldownSeconds: Math.max(0, Number(req.body.cooldownSeconds) || 60),
        levelUpChannelId: req.body.levelUpChannelId || null,
        levelRoles,
      },
    });
    res.redirect('/dashboard/niveles?saved=1');
  });

  app.get('/dashboard/roles-reaccion', requireAuth, requireActiveGuild, async (req, res) => {
    const sets = await db.listReactionRoleSets(req.session.activeGuildId);
    res.send(
      views.reactionRolesPage({
        user: req.session.user,
        sets,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved
          ? 'Mensaje de roles creado.'
          : req.query.deleted
            ? 'Eliminado.'
            : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/roles-reaccion', requireAuth, requireActiveGuild, async (req, res) => {
    const pairs = [];
    for (let i = 1; i <= 5; i++) {
      const emoji = (req.body[`emoji_${i}`] || '').trim();
      const roleId = req.body[`role_${i}`];
      const label = (req.body[`label_${i}`] || '').trim();
      if (emoji && roleId) pairs.push({ emoji, roleId, label });
    }

    if (!req.body.channelId) {
      return res.redirect(`/dashboard/roles-reaccion?error=${encodeURIComponent('Elegí un canal.')}`);
    }
    if (!pairs.length) {
      return res.redirect(
        `/dashboard/roles-reaccion?error=${encodeURIComponent('Completá al menos un par de emoji + rol.')}`,
      );
    }

    const guild = getGuild(req);
    try {
      const config = await db.getGuildConfig(req.session.activeGuildId);
      await reactionRoles.postReactionRoleMessage(guild, {
        channelId: req.body.channelId,
        title: req.body.titulo,
        description: req.body.descripcion,
        pairs,
        config,
      });
      res.redirect('/dashboard/roles-reaccion?saved=1');
    } catch (err) {
      console.error('No se pudo crear el mensaje de roles por reacción:', err);
      res.redirect(
        `/dashboard/roles-reaccion?error=${encodeURIComponent('No se pudo crear el mensaje: ' + err.message)}`,
      );
    }
  });

  app.post('/dashboard/roles-reaccion/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    if (guild) {
      await reactionRoles.deleteReactionRoleSet(guild, req.body.messageId);
    }
    res.redirect('/dashboard/roles-reaccion?deleted=1');
  });

  app.get('/dashboard/roles-menu', requireAuth, requireActiveGuild, async (req, res) => {
    const sets = await db.listSelectRoleSets(req.session.activeGuildId);
    res.send(
      views.selectRolesPage({
        user: req.session.user,
        sets,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved
          ? 'Menú creado y publicado.'
          : req.query.deleted
            ? 'Eliminado.'
            : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/roles-menu', requireAuth, requireActiveGuild, async (req, res) => {
    const options = [];
    for (let i = 1; i <= 10; i++) {
      const label = (req.body[`label_${i}`] || '').trim();
      const roleId = req.body[`role_${i}`];
      const emoji = (req.body[`emoji_${i}`] || '').trim();
      const description = (req.body[`desc_${i}`] || '').trim();
      if (label && roleId) options.push({ id: slugify(label) || `opcion-${i}`, label, roleId, emoji, description });
    }

    if (!req.body.channelId) {
      return res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('Elegí un canal.')}`);
    }
    if (!options.length) {
      return res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('Completá al menos una opción con nombre y rol.')}`);
    }
    if (options.length > 25) {
      return res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('Un menú de Discord admite máximo 25 opciones.')}`);
    }

    const guild = getGuild(req);
    try {
      const config = await db.getGuildConfig(req.session.activeGuildId);
      await selectRoles.postSelectRoleMessage(guild, {
        channelId: req.body.channelId,
        title: req.body.titulo,
        description: req.body.descripcion,
        placeholder: req.body.placeholder,
        options,
        config,
      });
      res.redirect('/dashboard/roles-menu?saved=1');
    } catch (err) {
      console.error('No se pudo crear el menú de roles:', err);
      res.redirect(`/dashboard/roles-menu?error=${encodeURIComponent('No se pudo crear el menú: ' + err.message)}`);
    }
  });

  app.post('/dashboard/roles-menu/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    if (guild) {
      await selectRoles.deleteSelectRoleSet(guild, req.body.messageId);
    }
    res.redirect('/dashboard/roles-menu?deleted=1');
  });

  app.get('/dashboard/logs', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.logsPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/logs', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      logging: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        logDeletes: req.body.logDeletes === 'on',
        logEdits: req.body.logEdits === 'on',
        logJoins: req.body.logJoins === 'on',
        logModeration: req.body.logModeration === 'on',
      },
    });
    res.redirect('/dashboard/logs?saved=1');
  });

  app.get('/dashboard/debug', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const mem = process.memoryUsage();
    res.send(
      views.debugPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
        stats: {
          version: pkg.version,
          nodeVersion: process.version,
          ping: client.ws.ping,
          uptime: debugCommand.formatUptime(client.uptime),
          guildCount: client.guilds.cache.size,
          memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
        },
      }),
    );
  });

  app.post('/dashboard/debug', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      debug: {
        enabled: req.body.enabled === 'on',
        errorChannelId: req.body.errorChannelId || null,
      },
    });
    res.redirect('/dashboard/debug?saved=1');
  });

  app.get('/dashboard/apariencia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.appearancePage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/apariencia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const hexPattern = /^#?[0-9a-fA-F]{6}$/;

    const colors = { ...config.branding.colors };
    for (const key of Object.keys(colors)) {
      const value = req.body[`color_${key}`];
      if (hexPattern.test(value || '')) {
        colors[key] = value.startsWith('#') ? value : `#${value}`;
      }
    }

    const nickname = (req.body.nickname || '').trim().slice(0, 32);

    await db.updateGuildConfig(req.session.activeGuildId, {
      branding: {
        colors,
        footerText: (req.body.footerText || '').trim(),
        footerIcon: (req.body.footerIcon || '').trim(),
        nickname,
      },
    });

    const guild = getGuild(req);
    if (guild) {
      try {
        const me = guild.members.me || (await guild.members.fetchMe());
        if (nickname && me.nickname !== nickname) {
          await me.setNickname(nickname);
        } else if (!nickname && me.nickname) {
          await me.setNickname(null);
        }
      } catch (err) {
        console.error('No se pudo cambiar el apodo del bot desde el dashboard:', err);
      }
    }

    res.redirect('/dashboard/apariencia?saved=1');
  });

  app.get('/dashboard/contador', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.memberCounterPage({
        user: req.session.user,
        config,
        voiceChannels: getVoiceChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/contador', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);

    await db.updateGuildConfig(req.session.activeGuildId, {
      memberCounter: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        template: req.body.template || config.memberCounter.template,
      },
    });

    res.redirect('/dashboard/contador?saved=1');
  });

  app.get('/dashboard/invitaciones', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const guild = getGuild(req);
    res.send(
      views.inviteTrackerPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        missingPermission: guild ? !inviteTracker.hasManageGuild(guild) : false,
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/invitaciones', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      inviteTracker: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
      },
    });
    res.redirect('/dashboard/invitaciones?saved=1');
  });

  app.get('/dashboard/cumpleanos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.birthdaysPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/cumpleanos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);

    await db.updateGuildConfig(req.session.activeGuildId, {
      birthdays: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.birthdays.message,
      },
    });

    res.redirect('/dashboard/cumpleanos?saved=1');
  });

  app.get('/dashboard/sugerencias', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.suggestionsPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/sugerencias', requireAuth, requireActiveGuild, async (req, res) => {
    const approvalRoleIds = Array.isArray(req.body.approvalRoleIds)
      ? req.body.approvalRoleIds
      : req.body.approvalRoleIds
        ? [req.body.approvalRoleIds]
        : [];

    await db.updateGuildConfig(req.session.activeGuildId, {
      suggestions: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        approvalRoleIds,
        anonymous: req.body.anonymous === 'on',
      },
    });
    res.redirect('/dashboard/sugerencias?saved=1');
  });

  app.get('/dashboard/comandos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.customCommandsPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/comandos', requireAuth, requireActiveGuild, async (req, res) => {
    const name = (req.body.name || '').trim().toLowerCase();
    const description = (req.body.description || '').trim() || 'Comando personalizado';
    const response = (req.body.response || '').trim();
    const adminOnly = req.body.adminOnly === 'on';
    const cooldownSeconds = Math.max(0, Number(req.body.cooldownSeconds) || 0);

    const validationError = customCommands.validateCommandName(name);
    if (validationError || !response) {
      return res.redirect(`/dashboard/comandos?error=${encodeURIComponent(validationError || 'La respuesta no puede estar vacía.')}`);
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const existing = (config.customCommands || []).filter((cmd) => cmd.name !== name);
    const updatedConfig = await db.updateGuildConfig(req.session.activeGuildId, {
      customCommands: [...existing, { name, description, response, adminOnly, cooldownSeconds }],
    });

    const guild = getGuild(req);
    if (guild) await commandRegistry.registerGuildCommands(guild, updatedConfig);

    res.redirect('/dashboard/comandos?saved=1');
  });

  app.post('/dashboard/comandos/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const updatedConfig = await db.updateGuildConfig(req.session.activeGuildId, {
      customCommands: (config.customCommands || []).filter((cmd) => cmd.name !== req.body.name),
    });

    const guild = getGuild(req);
    if (guild) await commandRegistry.registerGuildCommands(guild, updatedConfig);

    res.redirect('/dashboard/comandos?saved=1');
  });

  app.get('/dashboard/houses', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.housesPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.published ? 'Mensaje publicado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/houses', requireAuth, requireActiveGuild, async (req, res) => {
    const formFields = (req.body.formFields || '')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .slice(0, 5);

    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      houses: {
        ...config.houses,
        enabled: req.body.enabled === 'on',
        requestChannelId: req.body.requestChannelId || null,
        requestTitle: req.body.requestTitle || config.houses.requestTitle,
        requestDescription: req.body.requestDescription || config.houses.requestDescription,
        reviewChannelId: req.body.reviewChannelId || null,
        formFields,
        acceptMessage: req.body.acceptMessage || '',
        rejectMessage: req.body.rejectMessage || '',
      },
    });
    res.redirect('/dashboard/houses?saved=1');
  });

  app.post('/dashboard/houses/publicar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    const config = await db.getGuildConfig(req.session.activeGuildId);

    try {
      const messageId = await housesCommand.publishRequestMessage(guild, config);
      // publicar el boton implica que el sistema queda activo, para que no quede
      // un mensaje funcional pero "desactivado" sin que se note
      await db.updateGuildConfig(req.session.activeGuildId, {
        houses: { ...config.houses, enabled: true, requestMessageId: messageId },
      });
      res.redirect('/dashboard/houses?published=1');
    } catch (err) {
      console.error('No se pudo publicar el mensaje de House:', err);
      res.redirect(`/dashboard/houses?error=${encodeURIComponent('No se pudo publicar: ' + err.message)}`);
    }
  });

  app.get('/dashboard/moderacion', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.moderationSettingsPage({
        user: req.session.user,
        config,
        roles: getAssignableRoles(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/moderacion', requireAuth, requireActiveGuild, async (req, res) => {
    const protectedRoleIds = [].concat(req.body.protectedRoleIds || []);
    await db.updateGuildConfig(req.session.activeGuildId, { protectedRoleIds });
    res.redirect('/dashboard/moderacion?saved=1');
  });

  app.get('/dashboard/economia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.economyPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/economia', requireAuth, requireActiveGuild, async (req, res) => {
    const shopItems = (req.body.shopItemsText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, price, ...descParts] = line.split('|').map((p) => p.trim());
        return {
          id: slugify(name),
          name,
          price: Math.max(0, Number(price) || 0),
          description: descParts.join('|') || '',
        };
      })
      .filter((item) => item.name);

    await db.updateGuildConfig(req.session.activeGuildId, {
      economy: {
        enabled: req.body.enabled === 'on',
        currencyName: req.body.currencyName || 'monedas',
        currencySymbol: req.body.currencySymbol || '🪙',
        dailyAmount: Math.max(0, Number(req.body.dailyAmount) || 0),
        workMinAmount: Math.max(0, Number(req.body.workMinAmount) || 0),
        workMaxAmount: Math.max(0, Number(req.body.workMaxAmount) || 0),
        workCooldownMinutes: Math.max(1, Number(req.body.workCooldownMinutes) || 60),
        shopItems,
      },
    });
    res.redirect('/dashboard/economia?saved=1');
  });

  app.get('/dashboard/casino', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.casinoSettingsPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/casino', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      casino: {
        enabled: req.body.enabled === 'on',
        minBet: Math.max(1, Number(req.body.minBet) || 1),
        maxBet: Math.max(1, Number(req.body.maxBet) || 1000),
      },
    });
    res.redirect('/dashboard/casino?saved=1');
  });

  app.get('/dashboard/mascotas', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.petsSettingsPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/mascotas', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      pets: {
        enabled: req.body.enabled === 'on',
        feedCooldownMinutes: Math.max(1, Number(req.body.feedCooldownMinutes) || 120),
        playCooldownMinutes: Math.max(1, Number(req.body.playCooldownMinutes) || 60),
      },
    });
    res.redirect('/dashboard/mascotas?saved=1');
  });

  app.get('/dashboard/starboard', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.starboardPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/starboard', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      starboard: {
        enabled: req.body.enabled === 'on',
        emoji: (req.body.emoji || '⭐').trim(),
        threshold: Math.max(1, Number(req.body.threshold) || 3),
        channelId: req.body.channelId || null,
      },
    });
    res.redirect('/dashboard/starboard?saved=1');
  });

  app.get('/dashboard/trivia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.triviaPage({
        user: req.session.user,
        config,
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/trivia', requireAuth, requireActiveGuild, async (req, res) => {
    const lines = (req.body.questionsText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const questions = [];
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 6) continue;
      const [question, optA, optB, optC, optD, correct] = parts;
      const correctIndex = Number(correct) - 1;
      if (!question || correctIndex < 0 || correctIndex > 3) continue;
      questions.push({ question, options: [optA, optB, optC, optD], correctIndex });
    }

    if (!questions.length) {
      return res.redirect(
        `/dashboard/trivia?error=${encodeURIComponent('Ninguna pregunta tiene el formato correcto (pregunta|A|B|C|D|correcta).')}`,
      );
    }

    await db.updateGuildConfig(req.session.activeGuildId, {
      trivia: {
        enabled: req.body.enabled === 'on',
        rewardAmount: Math.max(1, Number(req.body.rewardAmount) || 50),
        questions,
      },
    });
    res.redirect('/dashboard/trivia?saved=1');
  });

  app.get('/dashboard/eventos', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.miniEventsPage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/eventos', requireAuth, requireActiveGuild, async (req, res) => {
    await db.updateGuildConfig(req.session.activeGuildId, {
      miniEvents: {
        enabled: req.body.enabled === 'on',
        intervalMinutes: Math.max(5, Number(req.body.intervalMinutes) || 120),
        reward: Math.max(1, Number(req.body.reward) || 30),
        channelId: req.body.channelId || null,
      },
    });
    res.redirect('/dashboard/eventos?saved=1');
  });

  app.get('/dashboard/ia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    res.send(
      views.aiPage({
        user: req.session.user,
        config,
        aiConfigured: aiHelper.isConfigured(config),
        guildName: guildName(req),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/ia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    // las claves de Groq son ASCII imprimible; se limpia cualquier caracter pegado
    // por error (emojis, comillas raras, etc.) que rompería el header HTTP al usarla
    const cleanedInput = (req.body.apiKey || '').replace(/[^\x21-\x7e]/g, '').trim();
    await db.updateGuildConfig(req.session.activeGuildId, {
      ai: {
        enabled: req.body.enabled === 'on',
        helpFallback: req.body.helpFallback === 'on',
        moderation: req.body.moderation === 'on',
        // si el campo llega vacio, mantenemos la clave que ya estaba guardada (no la borramos por error),
        // salvo que se tilde explicitamente "quitar clave"
        apiKey: req.body.removeApiKey === 'on' ? '' : cleanedInput || config.ai.apiKey,
      },
    });
    res.redirect('/dashboard/ia?saved=1');
  });

  app.get('/dashboard/guia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const editingSection = req.query.edit
      ? (config.serverGuide.sections || []).find((s) => s.id === req.query.edit) || null
      : null;
    res.send(
      views.serverGuidePage({
        user: req.session.user,
        config,
        channels: getTextChannels(req),
        guildName: guildName(req),
        editingSection,
        flash: req.query.saved ? 'Guardado.' : req.query.published ? 'Panel publicado.' : req.query.error || null,
      }),
    );
  });

  app.post('/dashboard/guia', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    await db.updateGuildConfig(req.session.activeGuildId, {
      serverGuide: {
        ...config.serverGuide,
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        title: req.body.title || config.serverGuide.title,
        description: req.body.description || config.serverGuide.description,
      },
    });
    res.redirect('/dashboard/guia?saved=1');
  });

  app.post('/dashboard/guia/seccion', requireAuth, requireActiveGuild, async (req, res) => {
    const label = (req.body.label || '').trim();
    const content = (req.body.content || '').trim();

    if (!label || !content) {
      return res.redirect(`/dashboard/guia?error=${encodeURIComponent('La sección necesita un nombre y un contenido.')}`);
    }

    const config = await db.getGuildConfig(req.session.activeGuildId);
    const sections = config.serverGuide.sections || [];
    const existingId = (req.body.id || '').trim();
    const isEditing = existingId && sections.some((s) => s.id === existingId);
    const id = isEditing ? existingId : slugify(label) || `seccion-${Date.now()}`;
    const section = { id, label, emoji: (req.body.emoji || '').trim(), content };

    const updatedSections = isEditing
      ? sections.map((s) => (s.id === id ? section : s))
      : [...sections.filter((s) => s.id !== id), section];

    await db.updateGuildConfig(req.session.activeGuildId, {
      serverGuide: { ...config.serverGuide, sections: updatedSections },
    });
    res.redirect('/dashboard/guia?saved=1');
  });

  app.post('/dashboard/guia/seccion/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const config = await db.getGuildConfig(req.session.activeGuildId);
    const sections = (config.serverGuide.sections || []).filter((s) => s.id !== req.body.id);
    await db.updateGuildConfig(req.session.activeGuildId, { serverGuide: { ...config.serverGuide, sections } });
    res.redirect('/dashboard/guia?saved=1');
  });

  app.post('/dashboard/guia/publicar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    const config = await db.getGuildConfig(req.session.activeGuildId);

    try {
      const messageId = await serverGuide.publishGuide(guild, config);
      await db.updateGuildConfig(req.session.activeGuildId, {
        serverGuide: { ...config.serverGuide, enabled: true, messageId },
      });
      res.redirect('/dashboard/guia?published=1');
    } catch (err) {
      console.error('No se pudo publicar la guía del servidor:', err);
      res.redirect(`/dashboard/guia?error=${encodeURIComponent('No se pudo publicar: ' + err.message)}`);
    }
  });

  return app;
}

module.exports = { createApp };
