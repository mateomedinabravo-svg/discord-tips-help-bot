const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const crypto = require('crypto');
const { ChannelType, EmbedBuilder } = require('discord.js');
const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  fetchUserGuilds,
  hasManagePermission,
} = require('./discordOAuth');
const views = require('./views');
const db = require('../db');

function createApp({ client, guildId }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'change-me',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME || 'discordTipsBot',
        collectionName: 'sessions',
      }),
      cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12 },
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

  function getGuild() {
    return client.guilds.cache.get(guildId);
  }

  function getTextChannels() {
    const guild = getGuild();
    if (!guild) return [];
    return guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
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

      const targetGuild = guilds.find((g) => g.id === guildId);
      if (!targetGuild || !hasManagePermission(targetGuild.permissions)) {
        return res.status(403).send(
          views.loginPage({
            authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state: crypto.randomBytes(16).toString('hex') }),
            error: 'Tu cuenta no tiene permiso de administrador en este server.',
          }),
        );
      }

      req.session.user = { id: discordUser.id, username: discordUser.username };
      res.redirect('/dashboard');
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

  app.get('/dashboard', requireAuth, async (req, res) => {
    const config = await db.getGuildConfig(guildId);
    res.send(views.generalPage({ user: req.session.user, config, flash: req.query.saved ? 'Guardado.' : null }));
  });

  app.post('/dashboard/general', requireAuth, async (req, res) => {
    await db.updateGuildConfig(guildId, {
      language: req.body.language === 'en' ? 'en' : 'es',
      tipsIntervalMinutes: Math.max(1, Number(req.body.tipsIntervalMinutes) || 20),
    });
    res.redirect('/dashboard?saved=1');
  });

  app.get('/dashboard/bienvenida', requireAuth, async (req, res) => {
    const config = await db.getGuildConfig(guildId);
    res.send(
      views.welcomePage({
        user: req.session.user,
        config,
        channels: getTextChannels(),
        flash: req.query.saved ? 'Guardado.' : null,
      }),
    );
  });

  app.post('/dashboard/bienvenida/welcome', requireAuth, async (req, res) => {
    const config = await db.getGuildConfig(guildId);
    await db.updateGuildConfig(guildId, {
      welcome: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.welcome.message,
      },
    });
    res.redirect('/dashboard/bienvenida?saved=1');
  });

  app.post('/dashboard/bienvenida/goodbye', requireAuth, async (req, res) => {
    const config = await db.getGuildConfig(guildId);
    await db.updateGuildConfig(guildId, {
      goodbye: {
        enabled: req.body.enabled === 'on',
        channelId: req.body.channelId || null,
        message: req.body.message || config.goodbye.message,
      },
    });
    res.redirect('/dashboard/bienvenida?saved=1');
  });

  app.get('/dashboard/automoderacion', requireAuth, async (req, res) => {
    const config = await db.getGuildConfig(guildId);
    res.send(
      views.automodPage({ user: req.session.user, config, flash: req.query.saved ? 'Guardado.' : null }),
    );
  });

  app.post('/dashboard/automoderacion', requireAuth, async (req, res) => {
    await db.updateGuildConfig(guildId, {
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

  app.get('/dashboard/mensajes', requireAuth, async (req, res) => {
    const config = await db.getGuildConfig(guildId);
    res.send(views.messagesPage({ user: req.session.user, config, flash: req.query.saved ? 'Guardado.' : null }));
  });

  app.post('/dashboard/mensajes/tips', requireAuth, async (req, res) => {
    const tips = (req.body.tips || '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    await db.updateGuildConfig(guildId, { tips });
    res.redirect('/dashboard/mensajes?saved=1');
  });

  app.post('/dashboard/mensajes/ayuda', requireAuth, async (req, res) => {
    try {
      const helpResponses = JSON.parse(req.body.helpResponsesJson);
      await db.updateGuildConfig(guildId, { helpResponses });
      res.redirect('/dashboard/mensajes?saved=1');
    } catch (err) {
      const config = await db.getGuildConfig(guildId);
      res
        .status(400)
        .send(
          views.messagesPage({
            user: req.session.user,
            config,
            flash: 'El JSON de respuestas de ayuda no es válido, no se guardó.',
          }),
        );
    }
  });

  app.get('/dashboard/anuncio', requireAuth, (req, res) => {
    res.send(
      views.announcePage({
        user: req.session.user,
        channels: getTextChannels(),
        flash: req.query.sent ? 'Anuncio enviado.' : null,
      }),
    );
  });

  app.post('/dashboard/anuncio', requireAuth, async (req, res) => {
    const { channelId, mensaje, titulo, color, imagen } = req.body;
    const guild = getGuild();
    const channel = guild ? guild.channels.cache.get(channelId) : null;

    if (!channel || !channel.isTextBased()) {
      return res
        .status(400)
        .send(views.announcePage({ user: req.session.user, channels: getTextChannels(), flash: 'Canal inválido.' }));
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
          channels: getTextChannels(),
          flash: 'No se pudo enviar (revisá permisos del bot en ese canal).',
        }),
      );
    }
  });

  app.get('/dashboard/estadisticas', requireAuth, async (req, res) => {
    const stats = await db.getStats(guildId);
    const channelNames = {};
    for (const c of getTextChannels()) channelNames[c.id] = c.name;
    res.send(views.statsPage({ user: req.session.user, stats, channelNames }));
  });

  app.get('/dashboard/tickets', requireAuth, async (req, res) => {
    const tickets = await db.listTickets(guildId);
    res.send(views.ticketsPage({ user: req.session.user, tickets }));
  });

  return app;
}

module.exports = { createApp };
