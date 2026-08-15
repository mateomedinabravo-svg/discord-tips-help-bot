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

// View/Send/History/ManageMessages/ManageChannels/EmbedLinks/AddReactions/Kick/Ban/ManageRoles/ModerateMembers
const BOT_INVITE_PERMISSIONS = 1099780156502;

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

  function getAssignableRoles(req) {
    const guild = getGuild(req);
    if (!guild) return [];
    return guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function guildName(req) {
    return getGuild(req)?.name || null;
  }

  app.get('/', (req, res) => {
    res.type('text/plain').send('Bot activo');
  });

  app.get('/login', (req, res) => {
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
        return res.status(403).send(
          views.loginPage({
            authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state: crypto.randomBytes(16).toString('hex') }),
            error: 'Tu cuenta no tiene permiso de administrador en ningún server.',
          }),
        );
      }

      req.session.user = { id: discordUser.id, username: discordUser.username };
      req.session.accessToken = token.access_token;
      req.session.manageableGuilds = manageableGuilds;
      res.redirect('/servers');
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
    res.send(
      views.messagesPage({ user: req.session.user, config, guildName: guildName(req), flash: req.query.saved ? 'Guardado.' : null }),
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

  app.post('/dashboard/mensajes/ayuda', requireAuth, requireActiveGuild, async (req, res) => {
    try {
      const helpResponses = JSON.parse(req.body.helpResponsesJson);
      await db.updateGuildConfig(req.session.activeGuildId, { helpResponses });
      res.redirect('/dashboard/mensajes?saved=1');
    } catch (err) {
      const config = await db.getGuildConfig(req.session.activeGuildId);
      res.status(400).send(
        views.messagesPage({
          user: req.session.user,
          config,
          guildName: guildName(req),
          flash: 'El JSON de respuestas de ayuda no es válido, no se guardó.',
        }),
      );
    }
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

    const embed = new EmbedBuilder().setDescription(mensaje).setTimestamp();
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
        flash: req.query.saved ? 'Mensaje de roles creado.' : req.query.deleted ? 'Eliminado.' : null,
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

    const guild = getGuild(req);
    if (!pairs.length || !guild) {
      return res.redirect('/dashboard/roles-reaccion');
    }

    try {
      await reactionRoles.postReactionRoleMessage(guild, {
        channelId: req.body.channelId,
        title: req.body.titulo,
        description: req.body.descripcion,
        pairs,
      });
      res.redirect('/dashboard/roles-reaccion?saved=1');
    } catch (err) {
      console.error('No se pudo crear el mensaje de roles por reacción:', err);
      res.redirect('/dashboard/roles-reaccion');
    }
  });

  app.post('/dashboard/roles-reaccion/eliminar', requireAuth, requireActiveGuild, async (req, res) => {
    const guild = getGuild(req);
    if (guild) {
      await reactionRoles.deleteReactionRoleSet(guild, req.body.messageId);
    }
    res.redirect('/dashboard/roles-reaccion?deleted=1');
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

  return app;
}

module.exports = { createApp };
