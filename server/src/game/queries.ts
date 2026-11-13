// Consultas puras sobre el GameState que comparten servidor (validación) y
// cliente (resaltado de hexes). Así lo que la UI ofrece coincide siempre con lo
// que el servidor acepta.
import type { GameState, PlayerId, Unit, HexCoord, BoardMap, Weapon, TacticsCard, ResponseTrigger } from '../types'
import {
  hexKey, keyToHex, getNeighbors, gridDistance, checkLineOfSight, getReachableHexes,
  type MoveOptions,
} from './hexGrid'

export function otherPlayer(p: PlayerId): PlayerId {
  return p === 'player1' ? 'player2' : 'player1'
}

// ─── UPGRADES ─────────────────────────────────────────────────────────────────

export function upgradeCount(unit: Unit, type: 'attack' | 'movement' | 'shield' | 'energy' | 'any', onlyActive = false): number {
  if (type === 'energy') return unit.energy
  return unit.upgrades
    .filter(u => type === 'any' || u.type === type)
    .filter(u => !onlyActive || u.type !== 'shield' || u.active !== false)
    .reduce((n, u) => n + (u.value || 1), 0)
}

// ─── OCUPACIÓN ────────────────────────────────────────────────────────────────

// Bases de cada jugador (hex de despliegue). Cuentan como estructura.
export function baseOwnerAt(state: GameState, key: string): PlayerId | null {
  for (const p of ['player1', 'player2'] as const) {
    const base = state.players[p].deployHex
    if (base && hexKey(base) === key) return p
  }
  return null
}

// Hexes con enemigos de `playerId`: unidades desplegadas, Garrisons y Bases.
export function enemyHexes(state: GameState, playerId: PlayerId): Set<string> {
  const keys = new Set<string>()
  for (const u of Object.values(state.units)) {
    if (u.playerId !== playerId && u.position) keys.add(hexKey(u.position))
  }
  for (const [key, hex] of Object.entries(state.board)) {
    if (hex.garrisonToken && hex.garrisonToken.owner !== playerId) keys.add(key)
  }
  const enemyBase = state.players[otherPlayer(playerId)].deployHex
  if (enemyBase) keys.add(hexKey(enemyBase))
  return keys
}

// Hexes donde no se puede terminar un movimiento (cualquier unidad, Garrison o Base).
export function occupiedHexes(state: GameState, exceptUnitId?: string): Set<string> {
  const keys = new Set<string>()
  for (const u of Object.values(state.units)) {
    if (u.id !== exceptUnitId && u.position) keys.add(hexKey(u.position))
  }
  for (const [key, hex] of Object.entries(state.board)) {
    if (hex.garrisonToken) keys.add(key)
  }
  for (const p of ['player1', 'player2'] as const) {
    const base = state.players[p].deployHex
    if (base) keys.add(hexKey(base))
  }
  return keys
}

// ─── ENGAGEMENT ───────────────────────────────────────────────────────────────
// Una unidad está Engaged si está adyacente a una unidad o Garrison enemiga a
// la misma elevación (las Bases no causan Engagement).

export function engagedEnemyKeys(state: GameState, unitId: string): string[] {
  const unit = state.units[unitId]
  if (!unit?.position) return []
  const myHex = state.board[hexKey(unit.position)]
  if (!myHex) return []
  const result: string[] = []
  for (const n of getNeighbors(unit.position)) {
    const key = hexKey(n)
    const hex = state.board[key]
    if (!hex || hex.elevation !== myHex.elevation) continue
    const occupant = hex.occupiedBy ? state.units[hex.occupiedBy] : null
    const enemyUnit = occupant && occupant.playerId !== unit.playerId && occupant.position
    const enemyGarrison = hex.garrisonToken && hex.garrisonToken.owner !== unit.playerId
    if (enemyUnit || enemyGarrison) result.push(key)
  }
  return result
}

export function isEngaged(state: GameState, unitId: string): boolean {
  return engagedEnemyKeys(state, unitId).length > 0
}

// ─── HABILIDADES PASIVAS QUE AFECTAN AL MOVIMIENTO ───────────────────────────

export function hasHover(unit: Unit, state?: GameState): boolean {
  if (unit.traits.includes('Hover')) return true
  if (state?.activation?.unitId === unit.id && state.activation.hover) return true
  return unit.abilities.some(a => {
    const d = a.abilityData
    if (a.type !== 'ONG' || d?.type !== 'hover') return false
    if (!d.requiredUpgrades) return true
    return upgradeCount(unit, d.upgradeType ?? 'any') >= d.requiredUpgrades
  })
}

export function dashBonus(unit: Unit): number {
  return unit.abilities
    .filter(a => a.type === 'ONG' && a.abilityData?.type === 'dash_range_bonus')
    .reduce((n, a) => n + (a.abilityData?.amount ?? 0), 0)
}

// ─── MOVIMIENTO ───────────────────────────────────────────────────────────────

export type MoveKind = 'advance' | 'dash' | 'move'

export interface MoveRequest {
  kind: MoveKind
  base?: number              // para 'move' (habilidades "Move N")
  ignoreEngagement?: boolean
  ignoreTerrain?: boolean
}

// Distancia máxima de un movimiento, aplicando las penalizaciones al iniciar:
// Engaged −1; empezar en agua o Debris Field −1 (Hover las ignora).
export function movementBudget(state: GameState, unitId: string, req: MoveRequest): number {
  const unit = state.units[unitId]
  if (!unit?.position) return 0
  let budget =
    req.kind === 'advance' ? 3 + upgradeCount(unit, 'movement') + (state.activation?.unitId === unitId ? state.activation.speedBonus : 0)
      : req.kind === 'dash' ? 2 + dashBonus(unit)
        : (req.base ?? 0)
  if (!req.ignoreEngagement && isEngaged(state, unitId)) budget -= 1
  const terrain = state.board[hexKey(unit.position)]?.terrain
  if ((terrain === 'water' || terrain === 'debris') && !hasHover(unit, state) && !req.ignoreTerrain) budget -= 1
  return Math.max(0, budget)
}

export function moveOptionsFor(state: GameState, unitId: string, req: MoveRequest): MoveOptions {
  const unit = state.units[unitId]
  return {
    budget: movementBudget(state, unitId, req),
    enemyHexes: enemyHexes(state, unit.playerId),
    occupiedHexes: occupiedHexes(state, unitId),
    hover: hasHover(unit, state),
    ignoreTerrain: req.ignoreTerrain,
  }
}

export function reachableFor(state: GameState, unitId: string, req: MoveRequest): Map<string, number> {
  const unit = state.units[unitId]
  if (!unit?.position) return new Map()
  return getReachableHexes(unit.position, state.board, moveOptionsFor(state, unitId, req))
}

// ─── ATAQUE ───────────────────────────────────────────────────────────────────

export interface TargetRef {
  kind: 'unit' | 'garrison'
  id: string
  key: string
}

export function targetAt(state: GameState, key: string, attackerPlayer: PlayerId): TargetRef | null {
  const hex = state.board[key]
  if (!hex) return null
  if (hex.occupiedBy) {
    const u = state.units[hex.occupiedBy]
    if (u && u.position && u.playerId !== attackerPlayer) return { kind: 'unit', id: u.id, key }
  }
  if (hex.garrisonToken && hex.garrisonToken.owner !== attackerPlayer) {
    return { kind: 'garrison', id: hex.garrisonToken.id, key }
  }
  return null
}

// Enemigos adyacentes a `key` (para armas que "also target each enemy adjacent to the target")
export function enemiesAdjacentTo(state: GameState, key: string, attackerPlayer: PlayerId): TargetRef[] {
  return getNeighbors(keyToHex(key))
    .map(n => targetAt(state, hexKey(n), attackerPlayer))
    .filter((t): t is TargetRef => t !== null)
}

export interface TargetCheck { ok: boolean; reason?: string }

// Posición en el plano (pointy-top, odd-r) para calcular ángulos del cono.
function planePos(c: HexCoord): [number, number] {
  return [c.q + (c.r & 1) * 0.5, c.r * Math.sqrt(3) / 2]
}

// Hexes de una plantilla de área apuntada a `targetKey`.
//  flower: el hex elegido y sus 6 vecinos.
//  cone:   hexes a distancia ≤ alcance dentro de un ángulo de 60° hacia el objetivo.
// Aproximación: la forma exacta sale del diagrama impreso en la carta.
export function areaHexes(state: GameState, from: HexCoord, weapon: Weapon, targetKey: string): string[] {
  const center = keyToHex(targetKey)
  if (weapon.area === 'flower') return [targetKey, ...getNeighbors(center).map(hexKey)].filter(k => state.board[k])
  if (weapon.area === 'cone') {
    const [ox, oy] = planePos(from)
    const [tx, ty] = planePos(center)
    const dir = Math.atan2(ty - oy, tx - ox)
    return Object.keys(state.board).filter(k => {
      const h = keyToHex(k)
      const d = gridDistance(from, h)
      if (d === 0 || d > weapon.range) return false
      const [hx, hy] = planePos(h)
      let diff = Math.abs(Math.atan2(hy - oy, hx - ox) - dir)
      if (diff > Math.PI) diff = 2 * Math.PI - diff
      return diff <= Math.PI / 6 + 1e-6
    })
  }
  return [targetKey]
}

// Objetivos reales de un ataque apuntado a `targetKey`: el principal más los
// adicionales de la plantilla o del efecto "also targets each enemy adjacent".
export function attackTargets(state: GameState, unitId: string, weapon: Weapon, targetKey: string): TargetRef[] {
  const unit = state.units[unitId]
  if (!unit?.position) return []
  const primary = targetAt(state, targetKey, unit.playerId)
  const keys = weapon.area ? areaHexes(state, unit.position, weapon, targetKey) : [targetKey]
  const result: TargetRef[] = []
  for (const k of keys) {
    const t = targetAt(state, k, unit.playerId)
    if (!t) continue
    // Las áreas de efecto ignoran unidades y Garrisons para la línea de visión
    if (weapon.area && k !== targetKey && weapon.effectData?.type !== 'ignore_los' &&
        !checkLineOfSight(unit.position, keyToHex(k), state.board).clear) continue
    result.push(t)
  }
  if (primary && !result.some(t => t.key === targetKey)) result.unshift(primary)
  if (weapon.effectData?.type === 'also_target_adjacent' && primary) {
    for (const t of enemiesAdjacentTo(state, targetKey, unit.playerId)) if (!result.some(r => r.key === t.key)) result.push(t)
  }
  return result
}

// ¿Puede `unitId` atacar el hex `targetKey` con `weapon`?
// Comprueba alcance, línea de visión y la restricción de Engagement.
export function checkAttackTargetWith(state: GameState, unitId: string, weapon: Weapon, targetKey: string): TargetCheck {
  const unit = state.units[unitId]
  if (!unit?.position) return { ok: false, reason: 'Unidad no válida' }
  const target = targetAt(state, targetKey, unit.playerId)
  if (!target) return { ok: false, reason: 'No hay un enemigo en ese hex' }

  const from = unit.position
  const to = keyToHex(targetKey)
  if (gridDistance(from, to) > weapon.range) return { ok: false, reason: 'Objetivo fuera de alcance' }

  if (weapon.effectData?.type !== 'ignore_los') {
    // Las áreas de efecto ignoran unidades y Garrisons para la línea de visión
    const blockers = weapon.area ? new Set<string>() : enemyHexes(state, unit.playerId)
    blockers.delete(targetKey)
    const los = checkLineOfSight(from, to, state.board, blockers)
    if (!los.clear) return { ok: false, reason: `Sin línea de visión: ${los.reason}` }
  }

  const engaged = engagedEnemyKeys(state, unitId)
  if (engaged.length > 0) {
    const included = new Set(attackTargets(state, unitId, weapon, targetKey).map(t => t.key))
    if (!engaged.some(k => included.has(k))) {
      return { ok: false, reason: 'Engaged: debes atacar a un enemigo con el que estás trabado' }
    }
  }
  return { ok: true }
}

export function checkAttackTarget(state: GameState, unitId: string, weaponIndex: number, targetKey: string): TargetCheck {
  const weapon = state.units[unitId]?.weapons[weaponIndex]
  if (!weapon) return { ok: false, reason: 'Arma no válida' }
  return checkAttackTargetWith(state, unitId, weapon, targetKey)
}

export function attackableHexesWith(state: GameState, unitId: string, weapon: Weapon): string[] {
  if (!state.units[unitId]?.position) return []
  return Object.keys(state.board).filter(key => checkAttackTargetWith(state, unitId, weapon, key).ok)
}

export function attackableHexes(state: GameState, unitId: string, weaponIndex: number): string[] {
  const weapon = state.units[unitId]?.weapons[weaponIndex]
  return weapon ? attackableHexesWith(state, unitId, weapon) : []
}

// ─── ACCURACY POR TERRENO Y ELEVACIÓN ────────────────────────────────────────
// +1 si el objetivo está más bajo, −1 si está más alto.
// Agua / Debris: −1 si el objetivo está dentro, −1 si el atacante está dentro.
// Minovsky: −2 en ataques a no adyacentes si atacante u objetivo están dentro (no acumulable).
export function terrainAccuracy(board: BoardMap, from: HexCoord, to: HexCoord): number {
  const a = board[hexKey(from)]
  const t = board[hexKey(to)]
  if (!a || !t) return 0
  let acc = 0
  if (t.elevation < a.elevation) acc += 1
  if (t.elevation > a.elevation) acc -= 1
  for (const terrain of ['water', 'debris'] as const) {
    if (t.terrain === terrain) acc -= 1
    if (a.terrain === terrain) acc -= 1
  }
  if (gridDistance(from, to) > 1 && (a.terrain === 'minovsky' || t.terrain === 'minovsky')) acc -= 2
  return acc
}

// ─── RESPONSE DURANTE UN ATAQUE ───────────────────────────────────────────────

// Unidades atacadas de `player` en el ataque en curso.
export function attackDefenders(state: GameState, player: PlayerId): string[] {
  const pa = state.pendingAttack
  if (!pa) return []
  if (pa.stage === 'after_damage') {
    return pa.targetIds.filter(id => state.units[id]?.playerId === player && state.units[id].position)
  }
  const attacker = state.units[pa.attackerId]
  return pa.targetKeys
    .map(k => targetAt(state, k, attacker.playerId))
    .filter((t): t is TargetRef => t !== null && t.kind === 'unit' && state.units[t.id].playerId === player)
    .map(t => t.id)
}

// Newtype Destroyer: los enemigos no pueden usar Response mientras esa unidad ataca o es atacada.
function responsesBlocked(state: GameState, player: PlayerId): boolean {
  const pa = state.pendingAttack
  if (!pa) return false
  const attacker = state.units[pa.attackerId]
  const involved = [pa.attackerId, ...attackDefenders(state, otherPlayer(attacker.playerId))]
  return involved.some(id => state.units[id].playerId !== player &&
    state.units[id].abilities.some(a => a.abilityData?.type === 'block_enemy_responses'))
}

// ¿Puede `player` jugar `card` en la ventana de Response abierta (o en `trigger`)?
export function canPlayResponseCard(state: GameState, player: PlayerId, card: TacticsCard, trigger?: ResponseTrigger): boolean {
  const e = card.effectData
  const t = trigger ?? state.pendingResponse?.trigger
  if (!e || card.type !== 'response' || !t || e.trigger !== t) return false
  const duringAttack = t === 'before_attack_roll' || t === 'after_attack_roll' || t === 'after_combat_damage'
  const pa = state.pendingAttack
  if (!duringAttack || (!pa && t === 'after_combat_damage')) return true
  if (!pa || responsesBlocked(state, player)) return false
  if (player === state.activePlayerId && state.activation?.cardPlayed) return false
  const attacker = state.units[pa.attackerId]
  const side = attacker.playerId === player ? 'attacker' : 'defender'
  if (e.side && e.side !== side) return false
  const actors = side === 'attacker' ? [attacker.id] : attackDefenders(state, player)
  if (actors.length === 0) return false
  if (e.requiresActiveTrait && !actors.some(id => state.units[id].traits.includes(e.requiresActiveTrait!))) return false
  if (card.signature && !actors.some(id => state.units[id].signature === card.signature)) return false
  if (e.ifLowerVp && !actors.some(id => state.units[id].vp < attacker.vp)) return false
  if (e.requiresAllyWithin && attacker.position && !Object.values(state.units).some(u => u.id !== attacker.id &&
      u.playerId === attacker.playerId && u.position && gridDistance(u.position, attacker.position!) <= e.requiresAllyWithin!)) return false
  if (e.type === 'gain_energy' && !pa.damagedIds.some(id => state.units[id]?.playerId === player && state.units[id].position)) return false
  return true
}
