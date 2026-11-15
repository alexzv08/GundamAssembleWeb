# Despliegue: Supabase + Vercel + Railway

```
Navegador ──► Vercel (cliente React, estático)
   │  login OAuth                      │ Socket.IO / API (wss + https)
   ▼                                   ▼
Supabase (Auth + Postgres) ◄──── Railway (servidor Node: motor, salas, bot)
```

**Por qué tres sitios:** Vercel solo ejecuta funciones cortas y sin estado, y el servidor necesita conexiones
WebSocket abiertas, relojes de turno y las salas en memoria durante toda la partida. Por eso el cliente va
en Vercel y el servidor en Railway (también sirve Render o Fly.io con el mismo `server/Dockerfile`).
Supabase hace el login (Google / Discord) y guarda perfiles, partidas en curso y repeticiones.

Rellena las URLs en este orden: Supabase → Railway → Vercel → vuelta a Railway y Supabase con la URL de Vercel.

---

## 1. Supabase

1. Crea un proyecto en <https://supabase.com> (región cercana, p. ej. `eu-west`).
2. **SQL Editor** → ejecuta, en este orden:
   1. `server/scripts/schema.sql` — **solo si el proyecto está vacío** (crea `profiles` y el trigger que crea el perfil
      al registrarse). Si ya tienes la base de datos montada, **sáltalo**: si lo ejecutas dará
      `ERROR: 42710: type "match_type" already exists` (no rompe nada, pero no hace falta).
   2. `server/supabase/migrations/20261115_active_rooms.sql` (partidas en curso).
   3. `server/supabase/migrations/20261116_replays.sql` (repeticiones).
   Las dos migraciones se pueden repetir sin problema.
3. **Project Settings → API**: copia `Project URL`, la clave `anon` (va al cliente) y la `service_role`
   (solo al servidor; nunca en Vercel ni en el repositorio).
4. **Authentication → Sign In / Providers**: activa **Google** y **Discord** con el Client ID y Secret de cada uno.
   En Google Cloud y en el portal de Discord, la URL de redirección autorizada es
   `https://TU-PROYECTO.supabase.co/auth/v1/callback`.
5. **Authentication → URL Configuration** (cuando tengas la URL de Vercel, paso 3):
   - *Site URL*: `https://tu-app.vercel.app`
   - *Redirect URLs*: `https://tu-app.vercel.app/**`, `https://*-tu-usuario.vercel.app/**` (vistas previas) y
     `http://localhost:5173/**`.

## 2. Railway (servidor)

1. <https://railway.app> → **New Project → Deploy from GitHub repo** → este repositorio.
2. Deja el *Root Directory* vacío (la raíz): `railway.toml` construye con `server/Dockerfile` y solo
   redespliega cuando cambia `server/`. Elige la rama que quieras publicar (Settings → Source).
3. **Variables**:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL de Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | clave `service_role` |
   | `GAME_STORE` | `supabase` (el disco de Railway se borra en cada despliegue) |
   | `CLIENT_URL` | `https://tu-app.vercel.app` (cuando la tengas; varias separadas por comas) |
   | `CLIENT_URL_PATTERN` | opcional, para las vistas previas: `^https://tu-app-.*\.vercel\.app$` |

   `PORT` la pone Railway. Opcionales: `TURN_SECONDS`, `RESPONSE_SECONDS`, `BOT_DELAY_MS`.
4. **Settings → Networking → Generate Domain**. Comprueba `https://TU-SERVIDOR.up.railway.app/health` → `{"ok":true}`.
5. Mantén **una sola réplica**: las salas viven en la memoria del proceso (si se reinicia, se recuperan de Supabase
   y los jugadores tienen 5 minutos para reconectar).

## 3. Vercel (cliente)

1. <https://vercel.com> → **Add New → Project** → este repositorio.
2. **Root Directory: `client`**. El resto lo toma de `client/vercel.json` (Vite, `npm run build`, carpeta `dist`).
3. **Environment Variables** (Production y Preview):

   | Variable | Valor |
   |---|---|
   | `VITE_SERVER_URL` | `https://TU-SERVIDOR.up.railway.app` (sin barra final) |
   | `VITE_SUPABASE_URL` | Project URL de Supabase |
   | `VITE_SUPABASE_ANON_KEY` | clave `anon` |

   Las variables `VITE_*` se incrustan al compilar: si las cambias, vuelve a desplegar.
4. Despliega. Con la URL final (`https://tu-app.vercel.app`), vuelve a **Railway → `CLIENT_URL`** y a
   **Supabase → URL Configuration** (pasos 1.5 y 2.3).

## 4. Comprobación

- `https://TU-SERVIDOR.up.railway.app/health` responde `{"ok":true}`.
- En la web: entrar con Google o Discord → el lobby dice **● Conectado al servidor**.
- "Contra la máquina" → jugar unos turnos → recargar la página: vuelves a la partida.
- Al terminar, la partida aparece en **Repeticiones** (tabla `replays` en Supabase).

| Síntoma | Causa habitual |
|---|---|
| Tras el login vuelve a `localhost` | *Site URL* / *Redirect URLs* de Supabase sin la URL de Vercel |
| "Sin conexión con el servidor" | `VITE_SERVER_URL` mal, o la URL de Vercel no está en `CLIENT_URL` (CORS) |
| `AUTH_INVALID` al conectar | el servidor y el cliente apuntan a proyectos de Supabase distintos |
| Las partidas se pierden al redesplegar | falta `GAME_STORE=supabase` o las migraciones |

## Costes y límites

- **Vercel Hobby** y **Supabase Free**: gratis. Supabase pausa los proyectos gratuitos tras una semana sin uso
  (se reactivan desde el panel).
- **Railway**: de pago por uso tras la prueba (un servidor pequeño suele quedarse en ~5 $/mes).
  Alternativas con el mismo Dockerfile: Render (el plan gratis se duerme y corta las partidas) o Fly.io.
