// Movimiento y ataque pendientes de Iron-Blooded Tenacity, vistos desde el
// cliente: qué hexes resaltar en cada paso (el servidor valida igualmente).
import type { GameState, PendingFollowUp, HexCoord, PlayerId } from '../types'
import { reachableFor, attackableHexesWith, targetAt } from './queries'
import { hexKey } from './hexGrid'

export function myFollowUp(s: GameState, me: PlayerId | null): PendingFollowUp | null {
  const fu = s.pendingFollowUp
  if (!fu || fu.playerId !== me || s.pendingAttack || s.pendingResponse || s.pendingForcedMove) return null
  return fu
}

export function followUpMoveHexes(s: GameState, fu: PendingFollowUp): Set<string> {
  return new Set(reachableFor(s, fu.unitId, { kind: 'move', base: fu.move, ignoreEngagement: true }).keys())
}

// Enemigos a los que podría atacar con el arma de la carta desde `to` (o desde donde está)
export function followUpAttackHexes(s: GameState, fu: PendingFollowUp, to: HexCoord | null): Set<string> {
  const c = structuredClone(s)
  const u = c.units[fu.unitId]
  const weapon = u?.weapons.find(w => w.name === fu.weaponName)
  if (!u?.position || !weapon) return new Set()
  if (to) {
    c.board[hexKey(u.position)].occupiedBy = null
    u.position = to
    c.board[hexKey(to)].occupiedBy = u.id
  }
  return new Set(attackableHexesWith(c, u.id, weapon).filter(k => targetAt(c, k, fu.playerId)?.kind === 'unit'))
}
