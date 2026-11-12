// AUTO-GENERADO por scripts/sync-shared.mjs desde server/src — NO EDITAR AQUÍ.
// Consultas puras sobre el GameState que comparten servidor (validación) y
// cliente (resaltado de hexes). Así lo que la UI ofrece coincide siempre con lo
// que el servidor acepta.
import type { GameState, PlayerId, Unit, HexCoord, BoardMap } from '../types'
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

export function hasHover(unit: Unit): boolean {
  if (unit.traits.includes('Hover')) return true
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
    req.kind === 'advance' ? 3 + upgradeCount(unit, 'movement')
      : req.kind === 'dash' ? 2 + dashBonus(unit)
        : (req.base ?? 0)
  if (!req.ignoreEngagement && isEngaged(state, unitId)) budget -= 1
  const terrain = state.board[hexKey(unit.position)]?.terrain
  if ((terrain === 'water' || terrain === 'debris') && !hasHover(unit) && !req.ignoreTerrain) budget -= 1
  return Math.max(0, budget)
}

export function moveOptionsFor(state: GameState, unitId: string, req: MoveRequest): MoveOptions {
  const unit = state.units[unitId]
  return {
    budget: movementBudget(state, unitId, req),
    enemyHexes: enemyHexes(state, unit.playerId),
    occupiedHexes: occupiedHexes(state, unitId),
    hover: hasHover(unit),
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

// ¿Puede `unitId` atacar el hex `targetKey` con el arma `weaponIndex`?
// Comprueba alcance, línea de visión y la restricción de Engagement.
export function checkAttackTarget(state: GameState, unitId: string, weaponIndex: number, targetKey: string): TargetCheck {
  const unit = state.units[unitId]
  const weapon = unit?.weapons[weaponIndex]
  if (!unit?.position || !weapon) return { ok: false, reason: 'Arma o unidad no válida' }
  const target = targetAt(state, targetKey, unit.playerId)
  if (!target) return { ok: false, reason: 'No hay un enemigo en ese hex' }

  const from = unit.position
  const to = keyToHex(targetKey)
  if (gridDistance(from, to) > weapon.range) return { ok: false, reason: 'Objetivo fuera de alcance' }

  const ignoresLos = weapon.effectData?.type === 'ignore_los'
  if (!ignoresLos) {
    const blockers = enemyHexes(state, unit.playerId)
    blockers.delete(targetKey)
    const los = checkLineOfSight(from, to, state.board, blockers)
    if (!los.clear) return { ok: false, reason: `Sin línea de visión: ${los.reason}` }
  }

  const engaged = engagedEnemyKeys(state, unitId)
  if (engaged.length > 0) {
    const included = new Set([targetKey])
    if (weapon.effectData?.type === 'also_target_adjacent') {
      for (const t of enemiesAdjacentTo(state, targetKey, unit.playerId)) included.add(t.key)
    }
    if (!engaged.some(k => included.has(k))) {
      return { ok: false, reason: 'Engaged: debes atacar a un enemigo con el que estás trabado' }
    }
  }
  return { ok: true }
}

export function attackableHexes(state: GameState, unitId: string, weaponIndex: number): string[] {
  const unit = state.units[unitId]
  if (!unit?.position) return []
  const result: string[] = []
  for (const key of Object.keys(state.board)) {
    if (checkAttackTarget(state, unitId, weaponIndex, key).ok) result.push(key)
  }
  return result
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
