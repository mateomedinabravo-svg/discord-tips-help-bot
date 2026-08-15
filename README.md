# Discord Tips Bot

Bot de Discord con:
1. Tips automáticos cada 20 min (configurable) al canal donde más se habló.
2. Respuestas de ayuda automáticas (por palabra clave + clasificador local) cuando alguien pide ayuda, sin meterse en conversaciones entre usuarios.
3. Comando `/anuncio` para mandar embeds a cualquier canal.
4. Comando `/ticket` que abre un canal privado de soporte 1 a 1.
5. Bienvenida / despedida de miembros, y automoderación (palabras prohibidas, invitaciones, spam de menciones).
6. **Dashboard web** (login con Discord) para configurar todo lo de arriba sin tocar código.

## 1. Crear la aplicación en Discord

1. Andá a https://discord.com/developers/applications y creá una nueva aplicación.
2. En **Bot**, copiá el **Token**.
3. En **Privileged Gateway Intents**, activá **MESSAGE CONTENT INTENT** y **SERVER MEMBERS INTENT** (esta última hace falta para bienvenida/despedida).
4. En **OAuth2 → General**, copiá el **Client Secret** (botón "Reset Secret" si no lo ves).
5. En **OAuth2 → General → Redirects**, agregá: `https://tu-servicio.onrender.com/auth/callback` (con la URL real de tu dashboard).
6. En **OAuth2 → URL Generator**: scope `bot` + `applications.commands`, permisos: `View Channels`, `Send Messages`, `Read Message History`, `Manage Messages`, `Manage Channels`, `Embed Links`. Abrí el link generado para invitar (o re-invitar) el bot.

## 2. Configurar el proyecto

```bash
npm install
```

Copiá `.env.example` a `.env` y completá todas las variables (ver comentarios en el archivo): token del bot, `GUILD_ID`, credenciales OAuth, `SESSION_SECRET`, y el connection string de MongoDB.

## 3. Base de datos (MongoDB Atlas)

Toda la configuración (tips, respuestas de ayuda, bienvenida, automoderación, estadísticas, tickets) vive en MongoDB, no en archivos — así el dashboard puede editarla y sobrevive a los redeploys. Necesitás un cluster gratis en https://www.mongodb.com/cloud/atlas y pegar el connection string en `MONGODB_URI`.

La primera vez que el bot arranca, si no hay configuración guardada, se crea automáticamente a partir de `data/tips.json` y `data/helpResponses.json` (quedan como semilla inicial, después todo se edita desde el dashboard).

## 4. Correr el bot

```bash
npm start
```

El dashboard queda disponible en la misma URL del bot (`/login` para entrar). Solo puede entrar gente con permiso "Gestionar servidor" o "Administrador" en tu Discord.

## 5. Desplegar (Render, gratis)

Mismo proceso que ya tenías: repo en GitHub → Web Service en Render → variables de entorno (todas las de `.env`, incluida `DASHBOARD_URL` apuntando a la URL real que te da Render) → UptimeRobot pegándole cada 5 min para que no se duerma.

Recordá que si cambiás la URL de Render, hay que actualizar tanto `DASHBOARD_URL` en las variables de entorno como el redirect en el Developer Portal (paso 1.5).
