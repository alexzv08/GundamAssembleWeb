# CLAUDE.md — Gundam Assemble Web

## Descripción del proyecto

Juego de táctica por turnos en tablero hexagonal, temática Gundam, multijugador en tiempo real. Implementa el **Core Rulebook v1.2** oficial de Gundam Assemble (06/11/2026). UI en español.

Fuentes oficiales: reglas en https://global.bandai-hobby.net/en-us/site/gundam-assemble/rules-qa/rules/ y unidades en https://global.bandai-hobby.net/en-us/site/gundam-assemble/unitlist/. El estado regla por regla está en `GAMEPLAN.md`.

---

## Cómo arrancar

```bash
# Servidor (puerto 3001)
cd server && npm run dev

# Cliente (puerto 5173)
cd client && npm run dev
```

---

## Verificación antes de entregar cambios

```bash
# 1. Copiar el código compartido al cliente (si se tocó server/src/types o los módulos compartidos)
node scripts/sync-shared.mjs

# 2. Servidor: tipos (código + tests + scripts) y tests del motor
cd server && npm run typecheck && npm test

# 3. Partidas completas bot contra bot (detecta bloqueos y estados inválidos)
cd server && npm run selfplay

# 4. Cliente: tipos y lint
cd client && npx tsc --noEmit -p tsconfig.app.json && npm run lint
```

### Reglas para no romper lo existente

- **Una sola fuente de verdad**: los tipos (`server/src/types/`) y los módulos `hexGrid.ts`, `timeline.ts`, `queries.ts` y `deckRules.ts` se editan SOLO en `server/src` y se copian al cliente con `node scripts/sync-shared.mjs`. Las copias llevan cabecera `AUTO-GENERADO`; un test falla si están desincronizadas.
- **Código compartido sin dependencias de Node**: los módulos compartidos solo importan tipos y otros módulos compartidos (nada de `fs`), y usan `import type`.
- **Engine autoritativo**: la validación vive en `server/src/game/`. El cliente usa `queries.ts` solo para resaltar hexes; nunca valida acciones.
- **Una copia por acción**: cada `apply*` de `actions.ts` hace `cloneState` una vez y luego muta esa copia; los helpers de `damage.ts`, `effects.ts`, `combat.ts`, `victory.ts` y `activation.ts` MUTAN el estado que reciben.
- **Derrotas siempre con `defeatUnit`** (damage.ts) y daño siempre con `damageUnit`/`damageAt`: así se aplican Shields, Fracture, VP, +2 TL y la vuelta a la Reserva de forma coherente.
- **Dados**: las funciones de ataque reciben un `rng: () => number` (d10). En producción es `Math.random`; en tests se pasa una secuencia fija con `dice(...)`.
- **Tests nuevos**: toda regla o efecto nuevo lleva al menos un test en `server/src/game/__tests__/engine.test.ts` (caso base y caso de rechazo).

### Registro de cambios

- Al terminar cualquier cambio, añadir una entrada al final de `## Changelog` con fecha, qué se hizo y archivos.
- Mantener `GAMEPLAN.md` al día (✅ / ⚠️ / ❌ por regla).

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| 3D | Three.js 0.183 + React Three Fiber + Drei |
| Backend | Express 5 + Socket.io 4.8 |
| Auth / BD | Supabase |
| Tests | Vitest (servidor) |
| Datos del juego | JSON en `server/data/` |

---

## Arquitectura

```
scripts/sync-shared.mjs   — copia el código compartido de server/src a client/src

server/src/
  index.ts                — Express + Socket.io + middleware de auth (JWT de Supabase)
  types/                  — tipos (COMPARTIDOS → client/src/types)
  game/                   — MOTOR AUTORITATIVO
    hexGrid.ts            — (compartido) coordenadas, distancia, LoS oficial, movimiento (saltos, Impassable, Hover)
    timeline.ts           — (compartido) Timeline de 20 rondas, avance de fichas, desempates
    queries.ts            — (compartido) Engagement, presupuesto de movimiento, objetivos atacables, Accuracy por terreno
    deckRules.ts          — (compartido) validación de escuadra y mazo
    engine.ts             — processAction(): punto de entrada (turno → acción → fin de activación si la unidad cae)
    actions.ts            — apply* de cada acción + applyAction (dispatcher)
    activation.ts         — beginActivation (despliegue, Shields), endActivation, cambio de fase, fin de partida, startGame
    combat.ts             — resolveAttack: secuencia oficial de ataque (antes/después de la tirada, crits, daño)
    damage.ts             — cloneState, damageUnit, defeatUnit, Garrisons, Push/Pull con colisiones, Shields
    effects.ts            — modificadores Ongoing, habilidades Command, Response automáticas, cartas de Tactics
    victory.ts            — disputa de Objetivos, puntuación por fase, ganador
    catalog.ts            — carga unit_library.json / card_library.json y construye las unidades
    createServerGame.ts   — GameState inicial (tablero, unidades en Reserva, Timeline, iniciativa, mazos)
    bot.ts                — IA del rival automático (salas contra la máquina y self-play)
    maps.ts               — lista de mapas y validación de ids (sin rutas)
    __tests__/            — tests del motor
  rooms/roomManager.ts    — salas, cola, validación de escuadra, reconexión (solo el mismo userId)
  socket/gameEvents.ts    — eventos Socket.IO; GAME_ACTION llama a processAction
  routes/                 — /api/maps, /api/units, /api/cards, /api/auth
server/data/
  units/unit_library.json — 15 unidades oficiales + 6 de la demo (formato v2)
  cards/card_library.json — 45 cartas de Tactics oficiales + 17 de la demo
  maps/                   — mapas
server/scripts/
  self-play.ts            — partidas bot contra bot (npm run selfplay)
  socket-smoke.ts         — prueba de la capa Socket.IO sin Supabase (npm run smoke)
  seed-catalog.ts         — vuelca el catálogo a Supabase

client/src/
  App.tsx                 — pantallas + socket + handlers de UI
  game/                   — copias compartidas + loaders/useGameData (datos de la API)
  screens/                — lobby, espera, selección de escuadra (usa deckRules), setup
  components/ui/          — UnitPanel, TacticsHand, TimelineBar, ActionLog, ChoiceModal (elecciones), ChatPanel…
  game/sound.ts           — efectos de sonido sintetizados (Web Audio) y silencio
  three/                  — escena 3D; models.ts asocia cardId → modelo STL; RwsMesh.tsx dibuja las RWS
tools/map-editor.html     — editor de mapas
```

---

## Flujo de una acción

```
[Cliente] clic → App.tsx calcula resaltados con queries.ts (reachableFor / attackableHexes)
    ↓  socket.emit('GAME_ACTION', { action })
[Servidor] gameEvents → processAction(state, action, playerId)
    ↓  comprueba fase y turno (las Response las puede enviar el rival)
    ↓  applyAction → apply* valida, clona, aplica (dados con rng del servidor)
    ↓  si la unidad activa ha caído → endActivation
    ↓  endActivation → contestObjectives → siguiente ficha → cambio de fase / fin de partida
io.emit GAME_STATE_UPDATE | PHASE_TRANSITION | GAME_OVER  (con lastAttack.rolls para el popup de dados)
```

---

## Reglas clave implementadas (Core Rulebook v1.2)

- **Activación**: una acción primaria obligatoria (Attack, Dash 2 TL, Energize 2 TL, Rescue 2 TL); Advance (3 hexes + Speed) una vez; cada Command una vez y sin gastar la primaria; máx. 1 carta de Tactics; no se termina sobre la Base.
- **Estado de la activación** en `GameState.activation` (advanced, usedCommands, cardPlayed, freeDashes, freeAttacks, bonos temporales). El cliente lo lee de ahí.
- **Ataque**: dados = Strength + Strength Upgrades + modificadores. Accuracy suma al dado salvo 1 (fallo) y 9-10 (crit). Impacto con 4+. Crit una vez por ataque. Daño = impactos + bonus − Shields activos (que se ponen boca abajo); Fracture +3 si el daño es 3+; Disarm repite los impactos y anula crits.
- **Engagement**: adyacente a enemigo a la misma elevación → −1 movimiento y debe atacar a un trabado.
- **Objetivos**: se disputan al terminar la activación; mayoría captura (neutral) o neutraliza (rival). Puntúan al final de cada fase.
- **Fin**: tras la Fase 2; empate → gana el último que actuó.

---

## Datos de unidades (`server/data/units/unit_library.json`, v2)

Cada carta: `cardId, set, name, model, signature, traits[], hp, vp, tl, provisionalStats, weapons[{name, effect, crit, tlCost, range, strength, effectData, critData}], abilities[{name, effect, type: CMD|ONG|RSP|SETUP, energyCost, abilityData}]`.

- Los textos son los oficiales. `effectData` / `critData` / `abilityData` son la versión ejecutable (ver tipos en `types/units.ts`). Si `abilityData` falta, la habilidad se muestra pero no está implementada.
- Los valores numéricos de las armas, el tipo de cada habilidad y los costes de Energy vienen de la wiki comunitaria (`statsSource`), porque la web oficial solo los muestra en la imagen de la carta.
- `area: 'cone' | 'flower'` marca las armas con plantilla de área ("Range: SP"); la forma es una aproximación.

## Cartas de Tactics (`server/data/cards/card_library.json`, v2)

`cardId, name, type: command|attack|response, faction (rasgo requerido), signature (título de firma), effect, effectData, weapon (cartas Attack), source`.

- `source: 'oficial'` = las 45 cartas de la lista oficial (ID, set, firma, rasgos y texto de Bandai; los números de las cartas Attack son de la wiki); `source: 'demo'` = cartas de la demo previa.
- Las Response con `trigger: before_attack_roll | after_attack_roll` y `side: attacker | defender` se juegan durante un ataque: `combat.ts` pausa el ataque (`GameState.pendingAttack`) y abre una ventana por jugador (atacante primero). `canPlayResponseCard` (queries.ts, compartido) decide si una carta es jugable.

---

## Remote Weapon Systems

`GameState.rws: Record<id, RemoteWeapon>` (BIT Stave, Corax, Iśvara B Type). `position: null` = en la reserva de su unidad. Se crean en `createServerGame` para cada unidad con habilidad `deploy_rws`. Consultas en `queries.ts` (`rwsAt`, `alliedRws`, `rwsAdjacentTo`, `rwsDeployHexes`, `isEmptyHex`); destrucción con `destroyRws` (damage.ts); se atacan con la acción `ATTACK_RWS`.

---

## Sistema de coordenadas

Offset **odd-r** (pointy-top): `q` = columna, `r` = fila; las filas impares se desplazan media celda a la derecha. La distancia se calcula en cúbico. Conversión a 3D en `client/src/three/hexUtils.ts`.

---

## Changelog

<!-- Formato: ### YYYY-MM-DD — Título breve -->
<!-- Incluir: qué se hizo, archivos modificados -->

### 2026-06-08 — Deploy phase eliminada del TODO
- El spawn ya funciona como se diseñó: automático en el primer turno de la unidad y al respawnear tras morir, siempre en `deployHex` o vecino libre. No hay deploy manual.
- Actualizada descripción en mecánicas funcionales y eliminado el ítem del TODO.

### 2026-06-08 — Selección de escuadra y mazo de tácticas
- Paso 1: el jugador elige 3 unidades de su facción
- Paso 2: elige qué cartas de táctica incluir en su mazo (mín. 5, todas preseleccionadas por defecto)
- Archivos modificados: `client/src/game/useGameData.ts`, `client/src/App.tsx`, `server/src/rooms/roomManager.ts`, `server/src/game/createServerGame.ts`, `server/src/socket/gameEvents.ts`

### 2026-06-14 — Cartas RSP — ventana de respuesta
- Añadido `effectData` a las 6 cartas RSP implementables (T03, T05, T06, T15, T16, T18)
- Nuevo tipo `PendingResponse` en `tactics.ts` (ambos lados) con contexto de trigger
- Campo `pendingResponse: PendingResponse | null` en `GameState` (ambos lados)
- `applyResponseCardEffect()` en effects.ts: reduce_incoming_damage, counter_attack, gain_upgrade_after_rescue, retaliate_damage, damage_on_adjacent_enemy
- `applyPlayResponse()` y `applyPassResponse()` en actions.ts
- Ventana se abre tras ATTACK (para defensor), RESCUE (para rescatador activo) y ADVANCE (para oponente si T16)
- GAME_ACTION bypassa el check de turno para PLAY_RESPONSE/PASS_RESPONSE
- TacticsHand: modo RSP con cartas del trigger activo resaltadas + botón "Pasar respuesta"
- T11 (Exploited Chaos) sin implementar aún — necesita segunda ventana para el atacante
- Archivos: `card_library.json`, `tactics.ts`×2, `gameState.ts`×2, `effects.ts`, `actions.ts`, `gameEvents.ts`, `TacticsHand.tsx`, `App.tsx`, `createServerGame.ts`

### 2026-06-13 — Reconexión de jugadores
- Sala persiste en servidor hasta 5 min tras desconexión (timer en RoomManager con cleanup automático)
- Cliente guarda `{roomId, playerId}` en sessionStorage al entrar a sala/squad_selection
- Al reconectar el socket, se emite `RECONNECT` automáticamente; servidor devuelve `RECONNECT_SUCCESS` con el estado completo
- Evento `OPPONENT_ABANDONED` si el timer expira antes de reconectar
- Limpieza de sessionStorage al volver al lobby voluntariamente o al terminar la partida
- Archivos modificados: `server/src/rooms/roomManager.ts`, `server/src/socket/gameEvents.ts`, `client/src/App.tsx`

### 2026-06-08 — Revisión y corrección del CLAUDE.md
- Corregidos errores en la documentación: USE_ABILITY, PLAY_CARD y efectos de arma ya estaban implementados (se marcaron como [x])
- Añadida sección de `effects.ts` al árbol de carpetas y tabla de funciones
- Completadas las tablas de `timeline.ts`, `hexGrid.ts` y `victory.ts` con funciones faltantes
- Corregido código de sala: 6 caracteres (no 4)
- Corregida descripción del spawn: ocurre al inicio de `applyAction` y tras cada acción
- Eliminado falso bug "return result duplicado en actions.ts:431"
- Añadidas reglas de changelog y marcado de TODO

### 2026-06-16 — Bug fix: control de objetivos (resolveObjectiveControl)
- **Causa raíz**: `getAdjacentKeys` en `victory.ts` usaba direcciones axiales puras `{q:±1,r:0}…` sobre un tablero en coordenadas offset. Los vecinos calculados eran incorrectos; las unidades adyacentes a un objetivo no lo capturaban.
- **Fix**: eliminada `getAdjacentKeys`; sustituida por `getNeighbors` importada de `hexGrid.ts`, que respeta la paridad de fila (odd-r offset).
- Archivos: `server/src/game/victory.ts`

### 2026-06-16 — Bug fix: hasMoved/hasUsedPrimary se reseteaban al atacar o usar habilidad
- **Causa raíz**: `clearSelection()` reseteaba ambas flags a `false`, y se llamaba justo antes de `setHasUsedPrimary(true)` en los handlers de ataque/habilidad. React batching ejecuta ambas en el mismo ciclo y el setter más reciente (el de `clearSelection`) ganaba, dejando la flag en `false` y permitiendo volver a actuar.
- **Fix**: eliminados los resets de `hasMoved`/`hasUsedPrimary` de `clearSelection()` y del callback de `setSelectedUnitId`. Los resets se mueven exclusivamente al bloque de `GAME_STATE_UPDATE` que detecta cambio real de unidad activa (`prevState.activeUnitId !== newState.activeUnitId`). También se añadió reset en `PHASE_TRANSITION`.
- Archivos: `client/src/App.tsx`

### 2026-06-16 — Colores de garrison y tooltip contextual
- Garrison del jugador 1: rojo `#ef5350`; del jugador 2: azul `#4fc3f7`.
- Tooltip contextual: "🏠 Garrison aliada — Rescátala para +2 VP" si es propia, "🏠 Garrison enemiga — Destrúyela para +2 VP" si es del rival.
- Para ello se propagó la prop `myPlayerId` por la cadena `App.tsx → GameScene → GameBoard → HexTile`.
- Archivos: `client/src/three/HexTile.tsx`, `client/src/three/GameBoard.tsx`, `client/src/three/GameScene.tsx`, `client/src/App.tsx`

### 2026-06-16 — Eliminación de referencias de facción de la UI
- Las facciones (Earth Federation / Zeon) ya no se muestran en ningún sitio de la interfaz, porque las unidades son intercambiables entre facciones.
- En la pantalla de selección de escuadra el header muestra el nombre del jugador en vez de la facción.
- En UnitPanel se filtraron los traits `'Earth Federation'` y `'Zeon'` de la lista de rasgos mostrados.
- En la leyenda de tokens se usan los nombres de los jugadores (`gameState.players.player1.name` / `player2.name`).
- Archivos: `client/src/App.tsx`, `client/src/components/ui/UnitPanel.tsx`

### 2026-06-16 — Log de acciones en UI
- Nuevo campo `LogEntry { message, playerId, round }` y `log: LogEntry[]` en `GameState` (ambos lados)
- El servidor genera mensajes legibles en cada `apply*` de `actions.ts` y `applyBurstAbility` de `effects.ts`
- ATTACK incluye impactos, daño, crits y avisa de KO (+VP); ATTACK_GARRISON diferencia destruida/sin impactos
- PLAY_CARD / PLAY_RESPONSE / USE_ABILITY muestran el nombre de la carta o habilidad
- Nuevo componente `ActionLog.tsx`: panel desplegable (bottom-right), auto-scroll al último mensaje, ● de color por jugador (rojo P1, azul P2), número de ronda en cada entrada, contador de entradas cuando está cerrado
- Archivos: `server/src/types/gameState.ts`, `client/src/types/gameState.ts`, `server/src/game/actions.ts`, `server/src/game/effects.ts`, `server/src/game/createServerGame.ts`, `client/src/game/game.test.ts`, `client/src/components/ui/ActionLog.tsx`, `client/src/App.tsx`

### 2026-06-16 — Sistema de emparejamiento aleatorio (matchmaking)
- Nueva cola en servidor: `matchmakingQueue` en `RoomManager`. Métodos `joinQueue` y `leaveQueue`.
- Al desconectarse, el jugador sale automáticamente de la cola (`handleDisconnect` llama `leaveQueue`).
- Nuevos eventos socket: `FIND_MATCH` (entra en cola o crea sala inmediatamente si hay otro esperando) y `CANCEL_MATCH` (sale de la cola).
- Lobby rediseñado con 3 estados: **main** (Buscar partida · Sala privada), **private** (crear/unirse con código) y **searching** (buscando — botón Cancelar).
- Archivos: `server/src/rooms/roomManager.ts`, `server/src/socket/gameEvents.ts`, `client/src/App.tsx`

### 2026-06-19 — Sistema de autenticación con Supabase (Google + Discord OAuth)
- Proveedor: Supabase (`@supabase/supabase-js` en cliente y servidor)
- Pantalla `AuthScreen.tsx`: login con Google y Discord usando `signInWithOAuth`; redirige de vuelta al origen tras OAuth
- Socket.io con `autoConnect: false`; el JWT de Supabase se envía en `socket.handshake.auth.token` en cada (re)conexión via callback de `auth`
- Middleware `io.use()` en servidor valida el JWT con `supabaseAdmin.auth.getUser(token)` antes de permitir conexión; errores `AUTH_REQUIRED` / `AUTH_INVALID` / `AUTH_ERROR`
- `onAuthStateChange`: SIGNED_IN conecta el socket y va al lobby, SIGNED_OUT desconecta y vuelve a auth, TOKEN_REFRESHED reconecta el socket
- Nombre del jugador auto-rellenado desde `user_metadata.full_name` / `name` / email
- Botón "Salir" en lobby llama `supabase.auth.signOut()`
- Variables de entorno: `client/.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) y `server/.env` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
- Archivos: `client/src/lib/supabase.ts` (nuevo), `server/src/lib/supabase.ts` (nuevo), `client/src/components/ui/AuthScreen.tsx` (nuevo), `client/src/App.tsx`, `server/src/index.ts`

### 2026-06-23 — Refactor de arquitectura del Timeline (20 slots continuos)
- **Diseño corregido**: el Timeline tiene 20 slots (rounds 1–20) continuos. Fase 1 = rounds 1–10, Fase 2 = rounds 11–20. Los tokens fluyen sin reset; un token en round 9 con coste 3 va al round 12.
- **Transición de fase**: antes se detectaba al agotar todos los tokens (`!getNextActivation`); ahora se detecta cuando el token más bajo supera round 10 (`getCurrentRound > 10 && phase === 'phase1'`). Al transicionar: otorgar VP de objetivos + robar 3 cartas por jugador + cambiar `phase = 'phase2'`. El timeline NO se resetea.
- **Fin de partida**: cuando todos los tokens superan round 20 (se descartan), `getNextActivation()` devuelve null en fase 2 → resolución por VP.
- **Fix**: bot de self-play entraba en bucle infinito cuando no podía hacer acción primaria (75% intentaba END_ACTIVATION que fallaba, 25% ENERGIZE). Corregido forzando siempre ENERGIZE cuando `!hasUsedPrimaryAction`.
- **Resultados**: 100/100 partidas completan sin errores ni timeouts (avg 127 acciones), todas las 18 cartas ejercitadas.
- Archivos: `server/src/game/timeline.ts`, `client/src/game/timeline.ts`, `server/src/game/victory.ts`, `client/src/game/victory.ts`, `server/src/socket/gameEvents.ts`, `client/src/game/game.test.ts`, `client/src/game/actions.ts`, `server/scripts/self-play.ts`, `client/src/types/timeline.ts`, `server/src/types/timeline.ts`

### 2026-07-01 — Experimental: TimelineBar rediseñada (3 carriles + fase única)
- `experimental/TimelineBar.tsx`: ahora muestra solo la fase activa (Fase 1 o Fase 2), no ambas a la vez. El cambio ocurre cuando `gameState.phase` pasa a `'phase2'`.
- Layout cambiado de columnas verticales a **3 filas horizontales**: carril J1 (arriba) · números de turno T1–T10 (centro) · carril J2 (abajo). Mismo esquema visual que el diseño dc.html pero con los colores del tema (cyan J1, rojo J2, fondo oscuro, IBM Plex Mono).
- Tokens apilables con hover: cuando varios tokens coinciden en un slot se superponen con `margin-left` negativo; al pasar el ratón se separan suavemente (transición CSS de 200 ms).
- Columna activa resaltada con fondo sutil cyan en las 3 filas y número en blanco con glow.
- Tablero 3D añadido al `GameScreenPreview`: carga el board real vía `useGameData()` + `GameScene` (requiere servidor en :3001). Mientras carga muestra mensaje de espera.
- Archivos: `client/src/components/experimental/TimelineBar.tsx`, `client/src/components/experimental/GameScreenPreview.tsx`

### 2026-06-30 — Carpeta experimental de rediseño UI (sin efecto en producción)
- Creada carpeta `client/src/components/experimental/` con versiones rediseñadas de los 5 componentes principales de la pantalla de partida. Ninguno se importa en producción todavía.
- Fuentes añadidas a `client/index.html`: Chakra Petch, IBM Plex Sans, IBM Plex Mono (Google Fonts).
- Tema visual basado en diseño dc.html: fondo oscuro azul marino, tokens cyan (J1) / rojo (J2), tipografía Chakra Petch para cabeceras, IBM Plex Mono para datos numéricos.
- Componentes creados (mismas props que los originales de `ui/`, son drop-in replacements):
  - `UnitPanel.tsx` — panel de unidad activa rediseñado
  - `TimelineBar.tsx` — barra con Fase 1 y Fase 2 separadas + tarjetas VP integradas
  - `ObjectivesPanel.tsx` — panel de objetivos
  - `LegendPanel.tsx` — leyenda de tokens
  - `ActionLog.tsx` — log + chat togglable (bottom-left)
- `GameScreenPreview.tsx` — pantalla de preview con mock data; acceso via `localhost:5173?preview`
- El preview se activa en `App.tsx` con un bloque `if (DEV && ?preview)` fácil de localizar y borrar.

**Para quitar el preview por completo:**
1. En `App.tsx`: borrar el `import { GameScreenPreview }` (línea ~26) y el bloque `// PREVIEW MODE` (línea ~654).
2. Borrar `client/src/components/experimental/` si ya no se necesita.
3. Las fuentes en `index.html` pueden quedarse (no afectan nada).

### 2026-06-19 — Mazo de 9 cartas y visor 3D en selección de escuadra
- `DECK_SIZE` cambiado de 10 a 9 en `client/src/App.tsx`
- Nuevo componente `UnitCardPreview.tsx`: cada unidad se muestra con un Canvas 3D independiente (React Three Fiber) con el modelo STL rotando lentamente; fallback a esfera coloreada si no hay STL. El borde y glow usan el color del jugador (`#ef5350` P1, `#4fc3f7` P2).
- El `maxWidth` del contenedor de selección ampliado de 760 a 1100px para acomodar las cards más anchas.
- Archivos: `client/src/components/ui/UnitCardPreview.tsx` (nuevo), `client/src/App.tsx`


### 2026-11-12 — Motor reescrito según el Core Rulebook v1.2 y unidades oficiales
- **Bugs corregidos**: los dados extra (Strength Upgrades y bonos) se perdían porque el servidor tiraba solo `weapon.strength`; `RECONNECT` permitía ocupar la plaza de otro jugador sin comprobar el usuario; `SELECT_SQUAD` no validaba nada; Advance se podía repetir; Command y cartas gastaban la acción primaria; Slow bloqueaba el movimiento para siempre; terminar la activación costaba +1 TL; los VP de Objetivos de la Fase 2 no se otorgaban; derrotas tratadas de 8 formas distintas.
- **Reglas nuevas**: Engagement, saltos, Impassable/Debris/Minovsky, LoS oficial, Shields boca abajo, Disarm oficial, Accuracy sobre el dado, despliegue desde la Reserva, no terminar en la Base, Objetivos por disputa, empate para el último en actuar, iniciativa con dado, construcción de escuadra/mazo oficial (Mass Produced, rasgos, firmas).
- **Arquitectura**: motor dividido en engine/actions/activation/combat/damage/effects/victory/catalog; `processAction` es el único punto de entrada (gameEvents y self-play ya no duplican la lógica de fases). Código compartido copiado al cliente con `scripts/sync-shared.mjs`; borradas las copias muertas del cliente (actions, victory, units, createTestGame).
- **Datos**: `unit_library.json` v2 con las 15 unidades oficiales (stats de armas provisionales) + 6 de la demo.
- **Tests**: 58 tests del motor en el servidor (los antiguos probaban la copia del cliente, no el motor real); `npm run selfplay` (200/200 partidas) y `npm run smoke` (Socket.IO).
- **Cliente**: resaltados con `queries.ts`; estado de activación leído del servidor; selección de escuadra con copias Mass Produced y mazo validado; visor 3D de las tarjetas solo bajo el ratón (evita agotar contextos WebGL); `three/models.ts` por cardId; lint sin errores.
- Archivos: casi todo `server/src/game/*`, `server/src/rooms/roomManager.ts`, `server/src/socket/gameEvents.ts`, `server/src/types/*`, `server/data/units/unit_library.json`, `server/scripts/*`, `client/src/App.tsx`, `client/src/screens/SquadSelectionScreen.tsx`, `client/src/components/ui/*`, `client/src/three/*`, `scripts/sync-shared.mjs`, `GAMEPLAN.md`, `README.md`.

### 2026-11-12 — Q&A oficial y limpieza de CLAUDE.md
- Línea de visión: cuando la línea pasa justo entre dos hexes, el atacante elige en cada punto por separado (Q&A 3); antes solo se probaban las dos variantes completas. Test nuevo.
- Revisada la página 1 del Q&A oficial y la guía de juego organizado (formato 3 unidades + 9 cartas confirmado); estado en `GAMEPLAN.md`.
- CLAUDE.md: eliminada la documentación antigua que se había quedado duplicada tras la reescritura.
- Archivos: `server/src/game/hexGrid.ts`, `client/src/game/hexGrid.ts` (copia), `server/src/game/__tests__/engine.test.ts`, `GAMEPLAN.md`, `CLAUDE.md`.

### 2026-11-13 — Datos de armas reales, cartas de Tactics oficiales y Response durante el ataque
- **Datos**: coste de TL, alcance y Strength de las armas, tipo de habilidad y coste de Energy de las 15 unidades oficiales tomados de la wiki comunitaria (gundamassemble.wiki.gg) — ya no son provisionales. Armas con alcance "SP" modeladas como plantilla de cono o de flor.
- **Cartas**: `card_library.json` v2 con 46 cartas oficiales (29 jugables: 3 Attack, 16 Command y 10 Response) + las 18 de la demo.
- **Motor**: ataque pausable con ventanas de Response antes y después de la tirada (`startAttack` / `continueAttack` / `closeResponseWindow`, `GameState.pendingAttack`); cartas Attack con su propia arma; Response con coste de Energy (pagan si pueden); Hover y Speed temporales de la activación.
- **Compartido**: `canPlayResponseCard`, `attackTargets`, `checkAttackTargetWith` y `attackableHexesWith` en `queries.ts`.
- **Cliente**: cartas que piden un enemigo o un hex de destino, Attack con resaltado según su arma, la mano resalta solo las Response jugables, aviso cuando el rival está respondiendo, plantilla de área en el panel de unidad y etiquetas demo / sin implementar en la selección de mazo.
- **Tests**: 72 (13 nuevos); self-play 200/200 con el bot jugando cartas.
- Archivos: `server/data/units/unit_library.json`, `server/data/cards/card_library.json`, `server/src/types/{units,tactics,gameState}.ts`, `server/src/game/{combat,actions,effects,queries,catalog,activation,createServerGame}.ts`, `server/src/game/__tests__/engine.test.ts`, `server/scripts/self-play.ts`, `client/src/App.tsx`, `client/src/components/ui/{TacticsHand,UnitPanel}.tsx`, `client/src/screens/SquadSelectionScreen.tsx`, `client/src/api/gameData.ts`, copias compartidas del cliente, `GAMEPLAN.md`, `README.md`.

### 2026-11-13 — Lista oficial de cartas, Q&A completo y Remote Weapon Systems
- **Datos** (hoja `gundam_assemble_datos.xlsx` aportada por el autor, volcada de la web oficial): `card_library.json` v3 con las 45 cartas oficiales (ID, set, firma, rasgos, texto); quitadas las 10 cartas de la wiki que no están en la lista oficial; 39 jugables.
- **Ventanas de Response**: la de tras el daño sigue el mismo flujo que las otras (atacante y luego defensor). Nuevas cartas: Interference, Formative Strength, Counter Attack (ataque real a TL −1), Sacrificial Overload, Sayla's Encouragement, Breaker Sweep, Systematic Elimination, Bulwark Siege, Crimson Execution.
- **Q&A**: revisadas las 130 preguntas; corregidos Q16 (empujar contra el borde no hace daño) y Q43/Q44 (Newtype Destroyer bloquea también las Response tras el daño).
- **RWS**: BIT Stave, Corax e Iśvara B Type con las reglas de la Q&A 110, sus habilidades Direct, efectos pasivos, ataque a RWS, Beam Rifle de Aerial, crítico de Darilbalde, Lockdown, Permet Burst, Psycho-Frame Synchrony, Inspiring Presence y las cartas Linked Strike, BIT Shield, Drone Assault, Dismantle, Iśvara Assault y Cold Silence. En el cliente, `RwsMesh` y modos de selección para desplegarlas y atacarlas.
- **Tests**: 90; self-play 200/200 desplegando y atacando RWS, ahora determinista (`createServerGame` acepta `random` para barajar) y cortando solo ante 50 rechazos seguidos. `npm run smoke` construye mazos legales con `eligibleCards` (estaba roto desde el cambio de cartas: usaba la carta demo `T-10`, ya retirada) y tiene un timeout de 60 s.
- Archivos: `server/data/{units,cards}/*.json`, `server/src/types/*`, `server/src/game/{combat,actions,effects,queries,damage,createServerGame}.ts`, `server/src/socket/gameEvents.ts`, tests, `server/scripts/self-play.ts`, `client/src/App.tsx`, `client/src/three/{GameScene,RwsMesh}.tsx`, copias compartidas, `GAMEPLAN.md`, `README.md`.

### 2026-11-13 — Elecciones del jugador, las 45 cartas jugables, bot, mapas, chat y sonidos
- **Elecciones**: `PLAY_CARD` / `USE_ABILITY` aceptan `choice` / `choices`; `ChoiceModal` en el cliente. On-Site Integration y Special OPs (Upgrade a elegir), Material Transfer (reparto de Upgrades) y Bit Assault (recolocar varias RWS).
- **Response**: Challenge e Interception (`USE_RESPONSE_ABILITY`), Protective Shot (ataque fuera de turno), Iron-Blooded Tenacity (`preventDefeat`, queda a 1 HP; sin el movimiento ni el ataque posteriores); `SET_AUTO_RESPONSES` permite desactivar las Response automáticas de una unidad. Las 45 cartas oficiales son jugables.
- **Salas**: selector de mapa y escuadras de 3 o 5; partida contra la máquina (`PLAY_BOT`, `bot.ts`, `driveBot` en `gameEvents.ts`, `BOT_DELAY_MS`). El self-play usa la misma IA.
- **Seguridad**: GET `/api/maps/:id` solo acepta ids simples (antes permitía rutas); la subida de mapas exige sesión de Supabase y como mucho 200 KB.
- **UI**: animación de movimiento (`MovingGroup` en `UnitMesh.tsx`), chat de partida (evento `CHAT`, 200 caracteres, 1 mensaje/s) y sonidos con botón de silencio, arriba a la izquierda.
- **Tests**: 101; self-play 200/200; `npm run smoke` incluye una partida contra el bot.
- Archivos: `server/src/game/{bot,maps,effects,combat,queries,actions,damage}.ts`, `server/src/rooms/roomManager.ts`, `server/src/socket/gameEvents.ts`, `server/src/routes/maps.ts`, `server/src/types/*`, `server/scripts/{self-play,socket-smoke}.ts`, tests, `client/src/App.tsx`, `client/src/screens/{LobbyScreen,SquadSelectionScreen}.tsx`, `client/src/components/ui/{ChoiceModal,ChatPanel,TacticsHand,UnitPanel}.tsx`, `client/src/components/ui/choiceOptions.ts`, `client/src/game/sound.ts`, `client/src/three/UnitMesh.tsx`, copias compartidas, `GAMEPLAN.md`, `README.md`, `CLAUDE.md`.
