# CLAUDE.md — Gundam Assemble Web

## Descripción del proyecto

Juego de táctica por turnos en tablero hexagonal, temática Gundam, multijugador en tiempo real. Dos jugadores se enfrentan controlando unidades con stats de cartas reales. UI en español.

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

Ejecutar siempre en este orden antes de dar una tarea por terminada:

```bash
# 1. Type check cliente (detecta errores de tipos sin arrancar)
cd client && npx tsc --noEmit

# 2. Type check servidor
cd server && npx tsc --noEmit

# 3. Tests unitarios (engine: hexGrid, timeline, actions, victory)
cd client && npm test

# 4. Lint cliente
cd client && npm run lint
```

### Reglas para no romper lo existente

- **Tipos duplicados**: `client/src/types/` y `server/src/types/` deben mantenerse en sync. Cambiar un tipo en un lado obliga a cambiarlo en el otro.
- **Engine autoritativo**: toda lógica de juego vive en `server/src/game/`. El cliente solo calcula highlights visuales. No añadir validaciones de juego en el cliente.
- **cloneState**: toda función en `actions.ts` debe trabajar sobre una copia (`cloneState`), nunca mutar el estado recibido.
- **Tests**: al modificar `hexGrid.ts`, `timeline.ts`, `actions.ts` o `victory.ts` en el cliente, verificar que los tests de `game.test.ts` siguen pasando.
- **Ambos lados**: funciones como `hexGrid.ts` existen en cliente y servidor. Cambios de lógica deben aplicarse en los dos archivos.
- **Tests nuevos**: al añadir una nueva acción, mecánica o función de engine, añadir al menos un test en `client/src/game/game.test.ts` que cubra el caso base y el caso de error/rechazo. No entregar funcionalidad nueva sin test.

### Registro de cambios y seguimiento del TODO

- **Changelog**: al terminar cualquier implementación o corrección, añadir una entrada al final de la sección `## Changelog` de este archivo con la fecha, qué se hizo y qué archivos se modificaron.
- **Marcar como hecho**: si el cambio implementado corresponde a un ítem del `## Pendiente / TODO`, cambiar su `[ ]` por `[x]` y moverlo a la sección `### Mecánicas funcionales` con una descripción actualizada.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| 3D | Three.js 0.183 + React Three Fiber + Drei |
| Backend | Express 5 + Socket.io 4.8 |
| Comunicación | WebSockets (Socket.io) |
| Datos del juego | JSON estáticos en `server/data/` |

---

## Arquitectura de carpetas

```
client/src/
  App.tsx              — pantalla lobby/waiting/playing + toda la lógica de UI y socket
  three/               — render 3D con React Three Fiber
    GameScene.tsx      — Canvas de Three.js, luz, cámara, OrbitControls
    GameBoard.tsx      — itera board y renderiza HexTile + tokens + unidades
    HexTile.tsx        — mesh de un hex con color según estado (reachable, attackable)
    UnitMesh.tsx       — modelo 3D de una unidad (STL si existe, cilindro por defecto)
    useSTLModel.ts     — hook para cargar .stl desde /public/models/
    hexUtils.ts        — conversión coordenadas hex → posición 3D (pixel coords)
  game/                — lógica de cliente (solo UI: highlights, rangos)
    hexGrid.ts         — pathfinding A*, LoS, distancia, vecinos (mismo algoritmo que servidor)
    actions.ts         — validaciones locales (pre-envío), NO son autoritativas
    timeline.ts        — helpers de consulta para la TimelineBar
    units.ts           — helpers de stats de unidades
    useGameData.ts     — hook que carga mapas/unidades/cartas desde la REST API al inicio
    createTestGame.ts  — utilidad de desarrollo para partidas locales sin servidor
  components/ui/
    TimelineBar.tsx    — barra horizontal con fichas de turno (slots 1–10)
    UnitPanel.tsx      — panel lateral con HP, armas, habilidades y botones de acción
  types/               — interfaces TypeScript (duplicadas en server/src/types/)
    units.ts           — Unit, Weapon, Ability, StatusEffect, Upgrade
    gameState.ts       — GameState, PlayerState, GameAction, GamePhase
    board.ts           — BoardMap, HexTile, tokens
    timeline.ts        — Timeline, TimelineSlot, TimelineToken
    tactics.ts         — TacticsState
    index.ts           — re-exports

server/src/
  index.ts             — entry point: Express + Socket.io, monta rutas y eventos
  game/                — ENGINE AUTORITATIVO (única fuente de verdad)
    actions.ts         — dispatcher applyAction() + funciones apply* para cada acción
    hexGrid.ts         — idéntico al cliente: pathfinding, LoS, distancia
    timeline.ts        — gestión del timeline: advanceToken, getNextActivation, resetForPhase2
    effects.ts         — modificadores ONGOING, efectos de armas, habilidades BURST, efectos de cartas
    units.ts           — helpers de stats
    victory.ts         — checkGameOver(), resolveObjectiveControl(), transitionToPhase2()
    createServerGame.ts — construye el GameState inicial desde los JSON de datos
  rooms/roomManager.ts — Map<roomId, Room>, Map<socketId, roomId>, crea/une/destruye salas
  socket/gameEvents.ts — registra handlers: CREATE_ROOM, JOIN_ROOM, GAME_ACTION, disconnect
  routes/
    maps.ts            — GET /api/maps → lee server/data/maps/*.json
    units.ts           — GET /api/units → lee server/data/units/unit_library.json
    cards.ts           — GET /api/cards → lee server/data/cards/card_library.json
  data/
    units/unit_library.json   — stats de 6+ cartas (Gundam, Zaku II, Tallgeese, etc.)
    maps/DemoMap.json          — mapa principal con hexes, tokens y spawn points
    maps/MyMap.json            — mapa alternativo
    cards/card_library.json    — cartas de tácticas
```

---

## Flujo completo de una acción de juego

```
[Cliente] Usuario hace click en botón (UnitPanel) o en hex (GameBoard)
    ↓
[App.tsx] handleXxx() calcula highlights visuales localmente (calcReachable, calcAttackable)
    ↓
[App.tsx] socket.emit('GAME_ACTION', { action: { type, unitId, ... } })
    ↓
[Servidor] gameEvents.ts → socket.on('GAME_ACTION')
    ↓
[Servidor] Validación de turno: room.gameState.activePlayerId === playerId
    ↓  (si ATTACK: servidor genera dados aquí → anti-cheat)
[Servidor] applyAction(gameState, action, playerId, rolls)
    ↓
[Servidor] Dispatcher llama la función específica: applyAdvance / applyAttack / etc.
    ↓
[Servidor] Función valida + clona estado + aplica cambio + advanceToken en timeline
    ↓
[Servidor] checkGameOver() — ¿alguien llegó a 20 VP?
    ↓ (no)                        ↓ (sí)
io.emit('GAME_STATE_UPDATE')   io.emit('GAME_OVER')
    ↓
[Cliente] socket.on('GAME_STATE_UPDATE') → setGameState(newState)
    ↓
React re-renderiza: GameBoard, UnitPanel, TimelineBar con el nuevo estado
```

---

## Funciones clave por archivo

### `server/src/game/actions.ts`

| Función | Qué hace |
|---------|----------|
| `applyAction(state, action, playerId, rolls?)` | Dispatcher principal. Al entrar, spawnea la unidad activa si aún no tiene posición. Despacha según `action.type`. Al salir, spawnea la siguiente unidad activa si tampoco tiene posición. |
| `validateTurn(state, unitId, playerId)` | Verifica que es el turno del jugador y de esa unidad específica. Devuelve string de error o null. |
| `applyAdvance(state, unitId, to, playerId)` | Mueve unidad: valida slow, calcula A* con obstáculos (enemigos + garrisons enemigas). Al llegar, recoge upgradeToken si existe. Limpia slow. |
| `applyAttack(state, unitId, weaponIndex, targetId, playerId, diceRolls)` | Valida rango + LoS. Calcula modificadores por elevación. Itera dados: hit si ≥ hitThreshold (base 4), crit si ≥ critThreshold (default 9). Aplica efectos de arma. Si HP ≤ 0: da VP al atacante, resetea HP, avanza token con `advanceTokenOnDefeat`. |
| `applyAttackGarrison(state, unitId, weaponIndex, garrisonId, playerId, diceRolls)` | Ataca una garrison enemiga. Valida rango + LoS. Si hay hits: destruye el token de garrison y da +2 VP al atacante. |
| `applyDash(state, unitId, to, playerId)` | Movimiento rápido: máx 2 hexes (+ bonus ONGOING), cuesta el `tlCost` del dash. No puede usarse si ya se usó la acción primaria. Dispara `triggerAfterDash`. |
| `applyEnergize(state, unitId, playerId)` | Da +1 energy, avanza token según `tlCost`. |
| `applyRescue(state, unitId, garrisonId, playerId)` | Verifica que garrison aliada está adyacente. Remueve token del tablero, +2 VP al jugador. Dispara `triggerAfterRescue`. |
| `applyUseAbility(state, unitId, abilityIndex, playerId, targetId?)` | Valida turno y acción primaria no usada. Delega a `applyBurstAbility` de effects.ts. |
| `applyPlayCard(state, unitId, cardId, playerId, targetId?)` | Valida que la carta esté en la mano y sea de tipo `command`. Delega a `applyCardEffect`. Mueve carta a descartadas. |
| `applyEndActivation(state, unitId, playerId)` | Avanza token +1 TL, llama `advanceToNextActivation` para pasar al siguiente token activo. |
| `spawnUnitIfNeeded(state, unitId)` | Si `unit.position === null`: intenta colocar en `deployHex` del jugador; si está ocupado, busca el primer vecino libre. Si no hay espacio disponible, no hace nada. |
| `cloneState(state)` | `JSON.parse(JSON.stringify(state))` — deep clone para inmutabilidad. |

### `server/src/game/timeline.ts`

| Función | Qué hace |
|---------|----------|
| `createEmptyTimeline()` | Crea 10 slots (rounds 1–10) vacíos. |
| `placeInitialToken(timeline, token, round)` | Coloca un token en el slot indicado (al final si hay más). |
| `getNextActivation(timeline)` | Devuelve el token en la cima del slot con round más bajo que tenga tokens. |
| `getCurrentRound(timeline)` | Devuelve el round más bajo que aún tenga tokens, o null si el timeline está vacío. |
| `advanceToken(timeline, unitId, tlCost)` | Mueve el token del unitId `tlCost` posiciones hacia adelante. Si pasa de round 10, se descarta. |
| `advanceTokenOnDefeat(timeline, unitId, respawnTl)` | Al ser derrotada una unidad, mueve su token a `respawnTl` posiciones adelante del slot actual. |
| `resetForPhase2(timeline, units)` | Crea timeline limpio y recoloca todos los tokens según sus `startingTl` originales. |
| `reorderSlotForTie(slot, lastActivePlayer)` | Si hay empate en un slot, mueve al frente el token del jugador que NO actuó último. |
| `reorderSlotTokens(slot)` | Ordena los tokens de un slot: primero los que no son del jugador con prioridad, para desempates generales. |
| `getUnitRound(timeline, unitId)` | Devuelve el round en que se activará `unitId`, o null si no tiene token activo. |
| `unitHasToken(timeline, unitId)` | Devuelve true si la unidad tiene token en el timeline. |
| `getPlayerTokens(timeline, playerId)` | Devuelve todos los tokens del timeline que pertenecen a `playerId`. |

### `client/src/game/hexGrid.ts` (y espejo en servidor)

| Función | Qué hace |
|---------|----------|
| `hexKey(coord)` | `"q,r"` — clave de string para un hex. |
| `keyToHex(key)` | Inverso de `hexKey`: parsea `"q,r"` a `{q, r}`. |
| `offsetToAxial(col, row)` | Convierte coordenadas offset odd-r a axial (q, r). |
| `axialToOffset(q, r)` | Inverso: axial a offset `{col, row}`. |
| `hexDistance(a, b)` | Distancia en coordenadas axiales (Chebyshev cúbico). |
| `gridDistance(a, b)` | Convierte offset odd-r a cúbico y calcula distancia. |
| `getNeighbors(coord)` | 6 vecinos en sistema offset odd-r (filas impares desplazadas a la derecha). |
| `hexesInRange(origin, range)` | Devuelve todos los hexes dentro de `range` pasos del origen. |
| `hexLineDraw(a, b)` | Traza la línea recta de hexes entre dos coordenadas. |
| `findPath(start, goal, board, obstacles, maxDistance)` | A* con coste: +1 por hex, +elevación si sube, +1 si el hex actual es agua. Devuelve path o null si no alcanza. |
| `getReachableHexes(start, board, obstacles, maxDistance)` | Dijkstra para encontrar todos los hexes alcanzables. Usado para highlights de movimiento. |
| `checkLineOfSight(attacker, target, board, playerId, enemyPositions)` | Traza línea hex a hex. Bloqueada por: hex con elevation > atacante, token objetivo, unidad enemiga intermedia. Devuelve `LOSResult {clear, reason}`. |

### `server/src/game/effects.ts`

| Función | Qué hace |
|---------|----------|
| `getOngoingModifiers(state, unitId, targetId)` | Lee las habilidades ONG activas del atacante y devuelve `AttackModifiers` (bonos de fuerza, precisión, umbral de crit, rerrolls). |
| `getDashBonus(state, unitId)` | Suma el rango extra de dash otorgado por habilidades ONG. |
| `applyWeaponEffect(effect, state, ctx)` | Aplica el efecto de un arma tras el combate: `slow`, `fracture`, `destroy_upgrade`, `gain_upgrade`, `splash_damage`, `push`. |
| `isNearObjective(state, position)` | Devuelve true si la posición está adyacente a un objectiveToken en el tablero. |
| `triggerAfterDash(state, unitId)` | Dispara habilidades RSP con trigger `after_dash` de la unidad. |
| `triggerAfterRescue(state, unitId)` | Dispara habilidades RSP con trigger `after_rescue` de la unidad. |
| `applyBurstAbility(state, unitId, abilityIndex, playerId, targetId?)` | Ejecuta una habilidad de tipo BURST: valida cooldown/energía, aplica su `AbilityEffect`, marca cooldown. |
| `applyCardEffect(state, playerId, unitId, effectData, targetId?)` | Ejecuta el efecto de una carta de táctica según su `CardEffect.type`. |
| `drawCards(state, playerId, count)` | Roba `count` cartas del mazo del jugador a su mano. |

### `server/src/rooms/roomManager.ts`

| Función | Qué hace |
|---------|----------|
| `createRoom(socketId, playerName)` | Genera roomId aleatorio de 6 caracteres (A-Z0-9), crea Room con status 'waiting', registra socketId→roomId. |
| `joinRoom(roomId, socketId, playerName)` | Añade jugador 2, llama `createServerGame(p1name, p2name)` para generar el GameState inicial, status → 'playing'. |
| `handleDisconnect(socketId, io)` | Saca al socket de la cola de emparejamiento, marca el socketId como vacío, inicia timer de 5 min. Si el jugador reconecta antes, cancela el timer. Si expira, borra la sala y emite `OPPONENT_ABANDONED`. |
| `reconnect(roomId, playerId, newSocketId)` | Cancela el timer de limpieza, actualiza socketId del jugador y socketToRoom. Devuelve la sala o null si no existe. |
| `joinQueue(socketId, playerName)` | Añade al jugador a la cola de emparejamiento. Si ya hay otro esperando: crea sala, une a ambos y devuelve `{matched: true, room, p1SocketId}`. Si no: devuelve `{matched: false}`. |
| `leaveQueue(socketId)` | Elimina al jugador de la cola de emparejamiento. Devuelve true si estaba en cola. |

### `server/src/socket/gameEvents.ts`

| Evento recibido | Handler |
|-----------------|---------|
| `CREATE_ROOM` | Crea sala, emite `ROOM_CREATED` al creador |
| `JOIN_ROOM` | Une al jugador 2, emite `SQUAD_SELECTION_STARTED` (con roomId) a ambos jugadores |
| `FIND_MATCH` | Intenta emparejar al jugador con otro en cola. Si hay match: crea sala y emite `SQUAD_SELECTION_STARTED` a ambos. Si no: emite `MATCH_SEARCHING`. |
| `CANCEL_MATCH` | Saca al jugador de la cola, emite `MATCH_CANCELLED`. |
| `RECONNECT` | Restaura sesión: cancela timer, re-une socket a la sala, emite `RECONNECT_SUCCESS` con roomStatus/gameState/faction/squadSubmitted |
| `GAME_ACTION` | Valida turno → genera dados si ATTACK o ATTACK_GARRISON → `applyAction` → `resolveObjectiveControl` → `transitionToPhase2` si procede → `checkGameOver` → emite `GAME_STATE_UPDATE` o `GAME_OVER` |

### `client/src/App.tsx` — handlers de UI

| Función | Qué hace |
|---------|----------|
| `handleUnitClick(unitId)` | Si está en modo 'attacking': envía ATTACK. Si es mi unidad activa: selecciona y calcula hexes alcanzables. |
| `handleHexClick(key)` | Si el hex está en `reachableHexes`: emite ADVANCE o DASH según `selectionMode`. |
| `handleAttackMode(weaponIndex)` | Calcula `attackableHexes` para ese arma y activa `selectionMode = 'attacking'`. |
| `handleEndTurn()` | Emite `END_ACTIVATION`. |
| `handleRescue()` | Busca garrison aliada adyacente y emite RESCUE con su ID. |
| `calcReachable(unitId, state)` | Llama `getReachableHexes` con obstáculos = enemigos vivos. Excluye hexes aliados. |
| `calcAttackable(unitId, state, weaponIndex)` | Itera enemigos: filtra por rango y LoS. |
| `calcCanRescue(unitId, state, playerId)` | Busca garrison aliada a distancia ≤ 1. |

---

## Sistema de coordenadas hexagonales

Sistema **offset odd-r** (pointy-top):
- `q` = columna, `r` = fila
- Filas impares (`r & 1 === 1`) desplazadas media celda a la derecha
- Para distancia correcta se convierte internamente a **cúbico** (x, y, z)
- La conversión a píxeles 3D está en `client/src/three/hexUtils.ts`

---

## Mecánica de combate (dados)

1. El **servidor** genera los dados (anti-cheat) cuando recibe ATTACK o ATTACK_GARRISON
2. `weapon.strength` + bonos ONGOING = número de d10s efectivos
3. **Hit** si el dado ≥ `hitThreshold` (base 4, ajustado por diferencia de elevación y modificadores ONGOING)
4. **Crit** si el dado ≥ `critThreshold` (default 9, puede bajar por habilidades ONGOING) — y el atacante no tiene `disarm`
5. Hits totales − `shield_upgrade` del defensor = daño final
6. Si defensor tiene `fracture` y daño > 3: daño += 3
7. Si `weapon.effectData` existe: se aplica `applyWeaponEffect` según su trigger (`after_attack_roll` o `after_combat_damage`)
8. Si HP ≤ 0: atacante gana `target.vp` VP, objetivo respawnea (HP reset, token reposicionado con `advanceTokenOnDefeat`)

---

## Estado actual implementado

### Mecánicas funcionales
- [x] ADVANCE (mover) con A* y upgrades de movimiento
- [x] ATTACK con dados, LoS, rangos 1–4, modificadores elevación/agua, efectos de arma
- [x] ATTACK_GARRISON: atacar garrison enemiga con armas, da +2 VP si hay hits
- [x] DASH (movimiento rápido, con bonus ONGOING, dispara trigger after_dash)
- [x] ENERGIZE (+1 energía)
- [x] RESCUE de garrison tokens aliados (+2 VP, dispara trigger after_rescue)
- [x] USE_ABILITY: habilidades BURST con cooldown, energía y efectos
- [x] PLAY_CARD: cartas de táctica tipo command con efectos (command only en turno activo)
- [x] Efectos de arma: slow, fracture, destroy_upgrade, gain_upgrade, splash_damage, push
- [x] Habilidades ONGOING: bonos a fuerza, precisión, umbral crit, dash range
- [x] Upgrades en tablero: attack, shield, movement, energy
- [x] Status effects: disarm, fracture, slow
- [x] Timeline: slots 1–10, advanceToken, fases 1 y 2, desempate por iniciativa
- [x] Spawn automático: la unidad aparece en `deployHex` (o primer vecino libre) la primera vez que le toca en el timeline y al respawnear tras ser derrotada. No hay deploy manual.
- [x] Victoria: 20 VP, sin unidades activas, o control de objetivos
- [x] resolveObjectiveControl: evalúa control de objectiveTokens tras cada acción
- [x] transitionToPhase2: resetea el timeline cuando todos los tokens se agotan
- [x] Multijugador WebSocket con salas (código 6 caracteres) y emparejamiento aleatorio (cola en servidor)
- [x] REST API carga JSON de mapas/unidades/cartas
- [x] 3D con Three.js/R3F, STL loader (solo Tallgeese)
- [x] UI: TimelineBar, UnitPanel, leyenda de tokens, lobby
- [x] Selección de escuadra (3 unidades por facción) y mazo de tácticas (mín. 5 cartas) antes de cada partida — flujo de 2 pasos en `screen === 'squad_selection'`

### Unidades disponibles (6 cartas en unit_library.json)
Gundam (Amuro), Zaku II (Char), Tallgeese + 3 más

---

## Pendiente / TODO

### Alta prioridad
- [x] **Selección de escuadra y mazo**: implementado — ver sección de mecánicas

### Media prioridad
- [ ] **Terreno elevado/agua**: parcialmente en LoS y pathfinding, falta que agua bloquee spawn
- [x] **Reconexión**: sala persiste 5 min tras desconexión, sessionStorage guarda roomId+playerId, auto-reconexión al volver
- [ ] **Múltiples mapas**: selector en lobby (DemoMap.json y MyMap.json existen)
- [x] **Cartas RSP en hand**: ventana de respuesta post-ATTACK (T03, T05, T18), post-RESCUE (T06, T15) y post-ADVANCE (T16); acción PLAY_RESPONSE / PASS_RESPONSE. T11 (after own attack) pendiente de segunda ventana para atacante.

### Baja prioridad / Polish
- [ ] Animaciones 3D de movimiento (ahora teletransporte)
- [ ] Modelos STL para todas las unidades (solo Tallgeese)
- [ ] Chat en partida
- [x] Log de acciones en UI: panel desplegable bottom-right con mensajes legibles, colores por jugador y número de ronda
- [ ] Sonidos

---

## Patrones de código

- El **engine autoritativo** vive en `server/src/game/` — cliente nunca valida acciones finales, solo calcula highlights visuales
- Los **tipos están duplicados** entre `client/src/types/` y `server/src/types/` — cambiar en ambos lados
- `cloneState` = `JSON.parse(JSON.stringify(...))` — deep clone para inmutabilidad en cada acción
- El socket está instanciado **a nivel de módulo** en `App.tsx:10`: `const socket = io('http://localhost:3001')`
- `App.tsx` es monolítico intencionalmente para simplificar el flujo de estado
- `showActions` en `UnitPanel` = `isActive && isMyUnit && isMyTurn && isSelected` — controla visibilidad de botones de acción

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
