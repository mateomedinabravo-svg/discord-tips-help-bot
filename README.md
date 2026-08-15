# Discord Tips Bot

Bot de Discord multi-servidor con dashboard web propio. Cualquiera con permiso de **Gestionar servidor** puede invitar el bot a su server y administrar todo desde el dashboard, sin tocar código — igual que MEE6, Dyno o Nekotina.

## Funciones

### Comunidad
- **Tips automáticos**: cada tanto (intervalo configurable) manda un tip al canal donde más se habló.
- **Respuestas de ayuda**: sistema local (gratis, sin API paga) que combina palabras clave con tolerancia a errores de tipeo + un clasificador bayesiano para reconocer paráfrasis. Nunca responde si el mensaje es una respuesta o mención dirigida a otro usuario. Editable con un formulario visual desde el dashboard (temas, palabras clave, ejemplos, respuestas).
- **`/anuncio`**: manda un embed a cualquier canal (solo staff).
- **Houses**: sistema de solicitud con formulario (Modal de Discord), botón "Solicitar aquí" publicable en un canal, revisión con botones Aceptar/Rechazar, y MD automático al usuario con el resultado.
- **Starboard**: mensajes que juntan suficientes reacciones de un emoji (⭐ por defecto) se republican en un canal de destacados, con conteo que se actualiza en vivo.

### Moderación
- `/ban`, `/kick`, `/mute` (timeout), `/warn`, `/warnings`.
- **Roles protegidos**: estos comandos rechazan la acción si el objetivo tiene un rol marcado como protegido.
- **Automoderación**: palabras prohibidas, bloqueo de invitaciones a otros servers, límite de spam de menciones.
- **Logs**: canal configurable para mensajes borrados/editados, entradas/salidas de miembros y acciones de moderación.
- **Moderación con IA** (opcional, gratis con Groq): detecta mensajes tóxicos/acoso que el filtro de palabras no capta.

### Tickets (sistema completo estilo Ticket Tool/Ticket King)
- Panel con menú desplegable de categorías (cada una con su propio rol de staff, emoji y descripción), publicable en cualquier canal.
- Numeración secuencial de tickets, botón "Reclamar" para que un staff se asigne el ticket.
- Transcripción `.txt` generada al cerrar y mandada a un canal de logs.
- Encuesta de satisfacción opcional (1 a 5 estrellas) por MD al cerrar.

### Progresión
- **Niveles/XP**: XP por mensaje con cooldown, roles automáticos por nivel, `/nivel`, `/ranking`.
- **Roles por reacción**: mensajes con emoji → rol, publicables desde el dashboard.

### Economía y juegos (estilo Nekotina)
- **`/economia`**: `balance`, `daily`, `work`, `pay`, `shop`, `comprar`, `inventario`, `perfil`. Moneda, tienda y montos configurables desde el dashboard.
- **`/casino`**: `apostar` (cara/cruz), `slots`, `ruleta`, `blackjack` (interactivo con botones), `dados`, `ppt`. Límites de apuesta configurables.
- **Matrimonios**: `/casar` (con botón de aceptar/rechazar), `/divorciar`, `/pareja`.
- **Mascotas**: `/mascota adoptar/ver/alimentar/jugar`, con nivel, hambre y felicidad.
- **`/trivia`**: pregunta con 4 opciones, el primero en acertar gana monedas. Banco de preguntas configurable.
- **`/meme`**: trae un meme random de Reddit (vía meme-api.com, gratis).
- **Eventos automáticos**: el bot larga sorpresas cada tanto — el primero en reaccionar gana monedas.

### A medida
- **Comandos personalizados**: `/nombre` configurables desde el dashboard (solo-admin o para todos, con cooldown anti-spam).
- **IA (opcional, gratis con Groq)**: fallback inteligente para preguntas de ayuda que el sistema normal no entiende, usando solo los temas configurados del server como contexto (no inventa datos). Clave de Groq configurable desde el dashboard mismo, con instrucciones incluidas.

## Dashboard

Login con Discord OAuth2. Tras loguearse, se ve la lista de servers donde el usuario tiene permiso de Gestionar servidor: los que ya tienen el bot (botón **Gestionar**) y los que no (botón **Invitar bot**, con permisos correctos ya incluidos). La navegación está agrupada por categoría: General, Comunidad, Moderación, Tickets, Progresión, Economía y juegos, A medida.

## Arquitectura

- **`src/index.js`**: cliente de Discord, maneja todos los eventos (mensajes, reacciones, comandos, botones) y mantiene config/estado en memoria por servidor (multi-guild).
- **`src/db.js`**: capa de acceso a MongoDB — configuración por servidor, estadísticas, tickets, niveles, economía, etc.
- **`src/web/`**: dashboard (Express + sesiones guardadas en MongoDB).
- **`src/commandRegistry.js`**: junta los comandos fijos + los personalizados de cada servidor y los registra en Discord.
- Cada función vive en su propio módulo (`ticketCommand.js`, `economyCommands.js`, `casinoCommands.js`, etc.) con sus handlers y, cuando aplica, su config por defecto en `db.js`.

## 1. Crear la aplicación en Discord

1. Andá a https://discord.com/developers/applications y creá una nueva aplicación.
2. En **Bot**, copiá el **Token**.
3. En **Privileged Gateway Intents**, activá **MESSAGE CONTENT INTENT** y **SERVER MEMBERS INTENT**.
4. En **OAuth2 → General**, copiá el **Client Secret** (botón "Reset Secret" si no lo ves).
5. En **OAuth2 → General → Redirects**, agregá: `https://tu-servicio.onrender.com/auth/callback`.

No hace falta invitar el bot manualmente a ningún server puntual — eso se hace desde el dashboard.

## 2. Configurar el proyecto

```bash
npm install
```

Copiá `.env.example` a `.env` y completá las variables (ver comentarios en el archivo): token del bot, credenciales OAuth, `SESSION_SECRET`, connection string de MongoDB. `GROQ_API_KEY` es opcional (también se puede cargar por servidor desde el dashboard, pestaña IA).

## 3. Base de datos (MongoDB Atlas)

Toda la configuración de cada servidor vive en MongoDB — así el dashboard puede editarla y sobrevive a los redeploys. Cluster gratis en https://www.mongodb.com/cloud/atlas, connection string en `MONGODB_URI`.

Si tu red no resuelve bien el DNS de `mongodb+srv://` (común en algunos routers), el bot ya fuerza un DNS público (8.8.8.8 / 1.1.1.1) automáticamente en `src/db.js`.

La primera vez que el bot entra a un server nuevo, se crea configuración por defecto a partir de `data/tips.json` y `data/helpResponses.json` como semilla inicial.

## 4. Correr el bot y usar el dashboard

```bash
npm start
```

1. Andá a `/login` en la URL de tu dashboard e iniciá sesión con Discord.
2. Elegí tu server en la lista (o invitá el bot si todavía no está).
3. Configurá lo que quieras desde las distintas pestañas.

## 5. Desplegar (Render, gratis)

Repo en GitHub → Web Service en Render → variables de entorno (todas las de `.env`, incluida `DASHBOARD_URL` apuntando a la URL real que te da Render) → UptimeRobot pegándole cada 5 min para que no se duerma (el plan gratis de Render duerme el servicio a los 15 min sin tráfico).

Si cambiás la URL de Render, actualizá `DASHBOARD_URL` en las variables de entorno y el redirect en el Developer Portal (paso 1.5).

## Notas

- **Música**: evaluado y descartado por ahora — necesita más recursos (CPU/ancho de banda) de los que da el plan gratis de Render, y las librerías para sacar audio de YouTube se rompen seguido.
- **IA**: usa Groq (gratis, sin tarjeta) en vez de OpenAI/Claude para mantener el proyecto sin costo. Se puede activar por separado para ayuda y para moderación, y queda completamente desactivada si no hay clave configurada — no rompe nada del resto del bot.
