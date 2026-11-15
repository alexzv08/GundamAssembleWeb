// Explicaciones para el jugador: por qué no puede atacar a un enemigo y de dónde
// sale su movimiento. Solo leen las consultas compartidas (el servidor valida).
import type { GameState, Weapon } from '../types'
import { checkAttackTargetWith, isEngaged, movementBudget, engagedEnemyKeys } from './queries'
import { gridDistance, hexKey } from './hexGrid'

// Enemigos que no se pueden atacar con `weapon`, del más cercano al más lejano, con el motivo
export function attackBlockers(state: GameState, unitId: string, weapon: Weapon, max = 3): string[] {
  const unit = state.units[unitId]
  if (!unit?.position) return []
  return Object.values(state.units)
    .filter(u => u.playerId !== unit.playerId && u.position)
    .map(u => ({ u, d: gridDistance(unit.position!, u.position!) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map(({ u, d }) => {
      const check = checkAttackTargetWith(state, unitId, weapon, hexKey(u.position!))
      const reason = check.ok ? 'se puede atacar' : (check.reason ?? 'no válido').replace('Objetivo fuera de alcance', `fuera de alcance (alcance ${weapon.range})`)
      return `${u.shortName ?? u.name} a ${d}: ${reason}`
    })
}

// "Avanzar: 2 de movimiento (3 −1 por estar trabada)"
export function movementSummary(state: GameState, unitId: string, kind: 'advance' | 'dash'): string {
  const unit = state.units[unitId]
  const budget = movementBudget(state, unitId, { kind })
  const parts: string[] = []
  if (unit?.position && isEngaged(state, unitId)) parts.push('−1 por estar trabada: hay una unidad o Garrison enemiga al lado a la misma altura')
  const terrain = unit?.position ? state.board[hexKey(unit.position)]?.terrain : null
  if ((terrain === 'water' || terrain === 'debris') && budget < movementBudget(state, unitId, { kind, ignoreTerrain: true })) {
    parts.push(`−1 por empezar en ${terrain === 'water' ? 'agua' : 'Debris'}`)
  }
  return `${budget} de movimiento${parts.length ? ` (${parts.join(', ')})` : ''} · subir cuesta +1 por nivel`
}

// "Trabada con Garrison y Zaku: debes atacar a uno de ellos" (Engagement)
export function engagementNote(state: GameState, unitId: string): string | null {
  const keys = engagedEnemyKeys(state, unitId)
  if (!keys.length) return null
  const names = keys.map(k => {
    const id = state.board[k]?.occupiedBy
    return id ? (state.units[id].shortName ?? state.units[id].name) : 'una Garrison enemiga'
  })
  return `trabada con ${names.join(' y ')} (misma altura y adyacente): debes atacar a ${keys.length > 1 ? 'uno de ellos' : 'ese objetivo'}`
}
