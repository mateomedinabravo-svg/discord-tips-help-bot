# Discord Tips Bot

Bot de Discord que:
1. Cada 20 minutos (configurable) manda un tip preguardado al canal donde más se habló en esa ventana de tiempo.
2. Cuando un usuario escribe algo relacionado a "ayuda" (o palabras similares), responde automáticamente con un mensaje preguardado según el tema detectado.

Todos los mensajes están en archivos JSON, así que se editan sin tocar código.

## 1. Crear la aplicación en Discord

1. Andá a https://discord.com/developers/applications y creá una nueva aplicación.
2. En la pestaña **Bot**, creá el bot y copiá el **Token**.
3. En **Privileged Gateway Intents**, activá **MESSAGE CONTENT INTENT** (lo necesita para leer el texto de los mensajes).
4. En **OAuth2 > URL Generator**, marcá el scope `bot` y los permisos `Send Messages`, `Read Message History`, `View Channels`. Abrí el link generado para invitar el bot a tu server.

## 2. Configurar el proyecto

```bash
npm install
```

Copiá `.env.example` a `.env` y completá el token:

```
DISCORD_TOKEN=tu_token_aca
```

## 3. Editar los mensajes preguardados

- `data/tips.json`: lista de tips que se mandan cada 20 min. Agregá o sacá los que quieras.
- `data/helpResponses.json`:
  - `generalTriggers`: palabras que activan al bot (ej. "ayuda", "help").
  - `topics`: cada tema tiene `keywords` (palabras que lo activan) y `response` (lo que responde el bot).
  - `fallbackResponse`: lo que responde si detecta un trigger general pero ningún tema específico.

## 4. Correr el bot

```bash
npm start
```

## Que quede siempre activo (24/7)

Corriendo desde tu PC el bot se apaga si apagás la máquina o cerrás la terminal. Para que esté siempre online tenés estas opciones:

**Opción recomendada: un VPS chico (ej. DigitalOcean, Hetzner, Contabo, ~$4-5 USD/mes)**
- Subís el proyecto al VPS, instalás Node.js, y corrés el bot con [PM2](https://pm2.keymetrics.io/) para que se reinicie solo si crashea o si el server reinicia:
  ```bash
  npm install -g pm2
  pm2 start src/index.js --name tips-bot
  pm2 save
  pm2 startup
  ```

**Opción sin pagar: Railway.app o Render.com (plan free/hobby)**
- Subís el repo a GitHub y conectás el proyecto, configurás la variable de entorno `DISCORD_TOKEN` en su panel. Ellos lo mantienen corriendo.

Si querés, te ayudo a preparar el proyecto para deployar en alguna de estas opciones (Dockerfile, `Procfile`, etc.) — decime cuál preferís.
