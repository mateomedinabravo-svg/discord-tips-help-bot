# Discord Tips Bot

Bot de Discord multi-servidor con:
1. Tips automáticos (intervalo configurable) al canal donde más se habló.
2. Respuestas de ayuda automáticas (por palabra clave + clasificador local) cuando alguien pide ayuda, sin meterse en conversaciones entre usuarios.
3. Comando `/anuncio` para mandar embeds a cualquier canal.
4. Comando `/ticket` que abre un canal privado de soporte 1 a 1.
5. Bienvenida / despedida de miembros, y automoderación (palabras prohibidas, invitaciones, spam de menciones).
6. Sistema de niveles/XP con roles automáticos y `/nivel`, `/ranking`.
7. Roles por reacción.
8. Moderación: `/ban`, `/kick`, `/mute`, `/warn`, `/warnings`.
9. Registro de actividad (logs de mensajes borrados/editados, entradas/salidas, moderación).
10. **Dashboard web** (login con Discord) para configurar todo lo de arriba sin tocar código — cualquiera con permiso de Gestionar servidor puede invitar el bot a su propio server y administrarlo desde ahí, como MEE6/Dyno.

## 1. Crear la aplicación en Discord

1. Andá a https://discord.com/developers/applications y creá una nueva aplicación.
2. En **Bot**, copiá el **Token**.
3. En **Privileged Gateway Intents**, activá **MESSAGE CONTENT INTENT** y **SERVER MEMBERS INTENT**.
4. En **OAuth2 → General**, copiá el **Client Secret** (botón "Reset Secret" si no lo ves).
5. En **OAuth2 → General → Redirects**, agregá: `https://tu-servicio.onrender.com/auth/callback`.

No hace falta invitar el bot manualmente a ningún server puntual — eso ahora se hace desde el dashboard (ver paso 4).

## 2. Configurar el proyecto

```bash
npm install
```

Copiá `.env.example` a `.env` y completá todas las variables (ver comentarios en el archivo): token del bot, credenciales OAuth, `SESSION_SECRET`, y el connection string de MongoDB.

## 3. Base de datos (MongoDB Atlas)

Toda la configuración (por servidor: tips, respuestas de ayuda, bienvenida, automoderación, niveles, roles por reacción, logs, estadísticas, tickets) vive en MongoDB — así el dashboard puede editarla y sobrevive a los redeploys. Necesitás un cluster gratis en https://www.mongodb.com/cloud/atlas y pegar el connection string en `MONGODB_URI`.

La primera vez que el bot entra a un server nuevo, si no hay configuración guardada para ese server, se crea automáticamente a partir de `data/tips.json` y `data/helpResponses.json` como semilla inicial.

## 4. Correr el bot y usar el dashboard

```bash
npm start
```

1. Andá a `/login` en la URL de tu dashboard e iniciá sesión con Discord.
2. Vas a ver la lista de tus servers: los que ya tienen el bot (botón **Gestionar**) y los que no (botón **Invitar bot**, con los permisos correctos ya incluidos en el link).
3. Solo aparecen servers donde tenés permiso de **Gestionar servidor** o **Administrador** — mismo criterio que usan los bots grandes.

## 5. Desplegar (Render, gratis)

Repo en GitHub → Web Service en Render → variables de entorno (todas las de `.env`, incluida `DASHBOARD_URL` apuntando a la URL real que te da Render) → UptimeRobot pegándole cada 5 min para que no se duerma.

Recordá que si cambiás la URL de Render, hay que actualizar tanto `DASHBOARD_URL` en las variables de entorno como el redirect en el Developer Portal (paso 1.5).
