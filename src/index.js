require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { ActivityTracker } = require('./activityTracker');
const { buildResponder } = require('./helpResponder');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

const TIPS_INTERVAL_MS = (Number(process.env.TIPS_INTERVAL_MINUTES) || 20) * 60 * 1000;
const WHITELIST = (process.env.TIPS_CHANNEL_WHITELIST || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const tips = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tips.json'), 'utf8'));
const helpData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'helpResponses.json'), 'utf8'));
const findHelpResponse = buildResponder(helpData);

const tracker = new ActivityTracker();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  setInterval(sendTipToMostActiveChannel, TIPS_INTERVAL_MS);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  if (WHITELIST.length === 0 || WHITELIST.includes(message.channel.id)) {
    tracker.registerMessage(message.channel.id);
  }

  const response = findHelpResponse(message.content);
  if (response) {
    await message.reply(response);
  }
});

async function sendTipToMostActiveChannel() {
  const channelId = tracker.getMostActiveChannelId();
  tracker.reset();

  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const tip = tips[Math.floor(Math.random() * tips.length)];
    await channel.send(tip);
  } catch (err) {
    console.error('No se pudo mandar el tip:', err);
  }
}

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot activo');
  })
  .listen(process.env.PORT || 3000);

client.login(TOKEN);
