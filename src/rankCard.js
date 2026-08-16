const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// se registran como fuentes embebidas (no depende de que el hosting tenga
// fuentes del sistema instaladas, algo que no se puede garantizar en Render)
GlobalFonts.registerFromPath(path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Regular.ttf'), 'RankCardSans');
GlobalFonts.registerFromPath(path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Bold.ttf'), 'RankCardSansBold');

const WIDTH = 900;
const HEIGHT = 260;
const AVATAR_SIZE = 160;

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

async function fetchAvatarImage(avatarURL) {
  const res = await fetch(avatarURL);
  if (!res.ok) throw new Error(`avatar respondió ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return loadImage(buffer);
}

async function generateRankCard({ username, avatarURL, level, xpIntoLevel, xpForNextLevel, rank, brandColor }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const color = brandColor || '#5865f2';

  ctx.fillStyle = '#23272a';
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 24);
  ctx.fill();

  ctx.fillStyle = color;
  roundRect(ctx, 0, 0, 10, HEIGHT, 5);
  ctx.fill();

  const avatarX = 50;
  const avatarY = (HEIGHT - AVATAR_SIZE) / 2;
  const avatarCenterX = avatarX + AVATAR_SIZE / 2;
  const avatarCenterY = avatarY + AVATAR_SIZE / 2;

  try {
    const avatarImg = await fetchAvatarImage(avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } catch (err) {
    console.error('No se pudo cargar el avatar para la tarjeta de rango:', err.message);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, AVATAR_SIZE / 2 + 3, 0, Math.PI * 2);
  ctx.stroke();

  const textX = avatarX + AVATAR_SIZE + 40;
  const maxTextWidth = WIDTH - textX - 50;

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px RankCardSansBold';
  ctx.fillText(truncate(ctx, username, maxTextWidth), textX, 92);

  ctx.fillStyle = '#b5bac1';
  ctx.font = '26px RankCardSans';
  const rankLine = rank ? `Rank #${rank} · Nivel ${level}` : `Nivel ${level}`;
  ctx.fillText(rankLine, textX, 132);

  const barX = textX;
  const barY = 168;
  const barW = maxTextWidth;
  const barH = 30;
  const ratio = xpForNextLevel > 0 ? Math.min(1, xpIntoLevel / xpForNextLevel) : 0;

  ctx.fillStyle = '#1e1f22';
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();

  if (ratio > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, barH / 2);
    ctx.fill();
  }

  ctx.fillStyle = '#dbdee1';
  ctx.font = '20px RankCardSans';
  ctx.fillText(`${xpIntoLevel} / ${xpForNextLevel} XP`, barX, barY + barH + 32);

  return canvas.toBuffer('image/png');
}

module.exports = { generateRankCard };
