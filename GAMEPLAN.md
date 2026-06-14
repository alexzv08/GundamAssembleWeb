# GAMEPLAN — Gundam Assemble Web
# Comparativa: Reglas Oficiales vs Implementación

`✅ hecho` | `⚠️ parcial/bug` | `❌ falta`

---

## 1. Preparación de la Partida

- ❌ **Selección de escuadra** — cada jugador elige su squad antes de la partida (ahora hardcodeado: Fed=3 primeras cartas Fed, Zeon=3 primeras cartas Zeon)
- ❌ **Límite de escuadra** — una copia por unidad excepto rasgo "Mass Produced"
- ⚠️ **Mazo de tácticas** — 9 cartas por mazo, 3 robadas al inicio ✅ pero el filtro de facción es incorrecto (todas las cartas federación tienen `faction: "Earth Federation"`, ninguna tiene `faction: "Guntank"` etc.)
- ✅ **Robo inicial** — 3 cartas al inicio de Fase 1, 3 adicionales al pasar a Fase 2
- ✅ **Inicio del Timeline** — tokens colocados en su TL inicial impreso en carta

---

## 2. Sistema de Línea Temporal (Timeline)

- ✅ Track compartido 1–10, 2 Fases (20 rondas totales)
- ✅ Activación de tokens: se salta casillas vacías, activa el round más bajo
- ✅ **Empate durante partida** — activa primero quien NO actuó antes
- ✅ **Nuevas unidades** — se colocan debajo de las ya existentes en el slot
- ❌ **Orden inicial de tokens propios** — al colocar tokens en el mismo slot al inicio, cada jugador elige el orden de apilado de sus propias unidades (quién activa primero entre sus unidades); ahora el orden lo determina el orden de creación, no hay selección
- ✅ **Empate entre jugadores** — activa primero el oponente del jugador que actuó último (sin d10, misma regla todo el juego)

---

## 3. Turno de Activación

- ✅ **ADVANCE** — movimiento básico hasta 3 hexes, coste 0 TL
- ✅ **ATTACK** — usa un arma, paga su TL cost, requiere rango y LoS
- ✅ **DASH** — 2 hexes adicionales, 2 TL, acción primaria; puede hacerse antes o después de ADVANCE
- ✅ **ENERGIZE** — +1 energía, 2 TL, acción primaria
- ✅ **RESCUE** — garrison aliada adyacente, +2 VP, 2 TL, acción primaria
- ⚠️ **USE_ABILITY (CMD)** — implementado; algunas habilidades tienen lógica, otras devuelven "no implementada"
- ⚠️ **PLAY_CARD** — implementado; cartas con `effectData` funcionan, las demás muestran "no implementada"
- ❌ **Acción primaria OBLIGATORIA** — las reglas exigen exactamente una acción primaria por activación; actualmente se puede terminar sin hacer ninguna (END_ACTIVATION sin primary)
- ⚠️ **Movimiento no reanudable** — ADVANCE solo se puede hacer una vez por activación ✅; pero no se bloquea si el jugador hizo otra acción antes del ADVANCE (regla: el movimiento no se retoma tras otra acción)

---

## 4. Movimiento y Terreno

- ✅ Una unidad por hex
- ✅ Se puede atravesar aliados; enemigos bloquean el paso
- ✅ **Penalización agua** — +1 coste de movimiento al entrar en hex de agua
- ✅ **Penalización elevación** — +1 coste al subir a hex de mayor elevación
- ❌ **Rasgo Hover** — ignora todos los costes de terreno y elevación; no implementado

---

## 5. Sistema de Combate

- ✅ **Dados d10** — el servidor genera d10 (1–10); críticos en 9 y 10
- ✅ **Precisión base** — impacta con 4 o más
- ✅ **High Ground** — atacante en elevación superior: impacta con 3 o más (threshold −1)
- ✅ **Low Ground** — atacante en elevación inferior: impacta con 5 o más (threshold +1)
- ✅ **Impactos críticos** — 9 o 10 en el dado; `roll >= 9` sobre d10
- ✅ **Shield** — absorbe hits equivalentes a su valor; se elimina al usarse
- ✅ **Fracture** — activa con `damage >= 3` (3 o más daño)
- ✅ **Slow** — cancela ADVANCE; DASH y cartas siguen disponibles
- ✅ **Disarm** — los 9 y 10 cuentan como hit normal, sin efecto crítico
- ✅ Efectos de arma on-hit y on-crit (slow, fracture, push, splash, etc.)

---

## 6. Habilidades y Cartas de Táctica

- ✅ **CMD (Command)** — activadas durante el turno de la unidad
- ✅ **ONG (Ongoing)** — pasivas siempre activas (accuracy bonus, crit threshold, dash range, strength vs damaged, reroll miss)
- ⚠️ **RSP (Response)** — algunos triggers automáticos implementados (Char Kick tras Dash, Rescue the Mechanics tras Rescue); triggers en turno enemigo no implementados
- ❌ **Cartas React (RSP)** — cartas de respuesta jugadas durante el turno del oponente; no hay interfaz ni engine para jugarlas fuera del propio turno

---

## 7. Puntuación y Mecánicas de VP

- ✅ **Derrotar unidades** — atacante gana los VP de la carta del enemigo
- ✅ **Reaparición** — HP reset, token avanza +2 TL, respawn en deployHex
- ✅ **Garrison enemiga destruida** — da 2 VP al atacante
- ✅ **Garrison aliada rescatada** — +2 VP correcto
- ✅ **Objetivos en tablero** — `resolveObjectiveControl` se llama tras cada acción; `controlledBy` se actualiza en tiempo real
- ✅ **VP de objetivo** — 5 VP por objetivo (según reglas)
- ✅ **Victoria al final de Fase 2** — gana quien tiene más VP
- ✅ **Victoria por eliminar todas las unidades enemigas**
- ❌ **Victoria por 20 VP instantánea** — mencionada en el CLAUDE.md pero NO existe en las reglas oficiales ni en el código; eliminar referencia

---

## 8. Multijugador / Red

- ✅ Salas con código 6 chars
- ✅ WebSocket tiempo real (Socket.io)
- ✅ Anti-cheat: dados y validación en servidor
- ❌ Reconexión — sala se destruye al desconectarse

---

## 9. UI

- ✅ Lobby + waiting room
- ✅ TimelineBar (slots 1–10 con fichas)
- ✅ UnitPanel (HP, armas, habilidades, botones de acción)
- ✅ TacticsHand (panel de cartas en fase 2, arriba-derecha)
- ✅ Highlights de hexes (reachable azul, attackable rojo — unidades y garrisons enemigas)
- ✅ Leyenda de tokens en tablero
- ⚠️ actionLog — existe en state, no se muestra en UI
- ❌ Selector de mapa en lobby
- ❌ Chat en partida

---

## 10. 3D / Visual

- ✅ Tablero hexagonal 3D (Three.js + React Three Fiber)
- ✅ OrbitControls (cámara libre)
- ✅ STL loader — solo Tallgeese tiene modelo
- ❌ Animaciones de movimiento (ahora teletransporte instantáneo)
- ❌ Modelos STL para otras unidades
- ❌ Sonidos

---

## Bugs Prioritarios a Corregir

| Prioridad | Bug | Estado |
|-----------|-----|--------|
| ✅ Corregido | Dados d8 → d10 | `gameEvents.ts`, `effects.ts`, `actions.ts` |
| ✅ Corregido | Objetivos nunca otorgaban VP | `resolveObjectiveControl` llamado tras cada acción |
| ✅ Corregido | Garrison destruida daba 1 VP en vez de 2 | `actions.ts`, `effects.ts` |
| ✅ Corregido | Fracture activaba con `> 3` en vez de `>= 3` | `server/actions.ts`, `client/actions.ts` |
| ✅ Corregido | VP de objetivo 3 → 5 | `DemoMap.json` |
| 🟡 Pendiente | Acción primaria no obligatoria | `server/src/game/actions.ts` |
