// Colocación a mano de las plantillas de área ("SP"): solo para resaltar y
// componer la acción; el servidor vuelve a validar la colocación.
import type { GameState, Weapon, AreaAim } from '../types'
import { checkAttackTargetWith, templateHexes, targetAt } from './queries'
import { keyToHex, gridDistance, hexKey } from './hexGrid'
import type { HexCoord } from '../types'

// Posición en el plano (odd-r) para medir ángulos
function plane(c: HexCoord): [number, number] {
  return [c.q + (c.r & 1) * 0.5, c.r * Math.sqrt(3) / 2]
}

function angleTo(from: HexCoord, to: HexCoord): number {
  const [ax, ay] = plane(from), [bx, by] = plane(to)
  return Math.atan2(by - ay, bx - ax)
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d
}

// Plantilla que apunta al hex `key`: la cuña cuyo eje está más cerca de esa
// dirección; la flor, centrada en él si está a alcance.
export function aimToward(state: GameState, unitId: string, weapon: Weapon, key: string): AreaAim | null {
  const from = state.units[unitId]?.position
  if (!from || !weapon.area || !state.board[key]) return null
  const to = keyToHex(key)
  if (weapon.area === 'flower') {
    if (gridDistance(from, to) > weapon.range) return null
    // Quadruple Bop Missile: la flor va siempre sobre el objetivo
    if (weapon.areaOnTarget && !targetAt(state, key, state.units[unitId].playerId)) return null
    return { center: to }
  }
  if (gridDistance(from, to) === 0) return null
  const dir = angleTo(from, to)
  let best = 0, bestDiff = Infinity
  for (let f = 0; f < 6; f++) {
    const hexes = templateHexes(state, from, weapon, { facing: f })
    // Eje de la cuña: la media de sus hexes (se calcula con la forma completa,
    // aunque parte se salga del tablero)
    const cells = hexes.length ? hexes.map(keyToHex) : []
    if (!cells.length) continue
    const cx = cells.reduce((s, c) => s + plane(c)[0], 0) / cells.length
    const cy = cells.reduce((s, c) => s + plane(c)[1], 0) / cells.length
    const [ox, oy] = plane(from)
    const d = angleDiff(Math.atan2(cy - oy, cx - ox), dir) - (hexes.includes(key) ? 1 : 0)
    if (d < bestDiff) { bestDiff = d; best = f }
  }
  return { facing: best }
}

export function rotateAim(aim: AreaAim, step: number): AreaAim {
  return aim.facing === undefined ? aim : { facing: (((aim.facing + step) % 6) + 6) % 6 }
}

// Hexes de la plantilla y el objetivo principal con el que se puede declarar el
// ataque (una unidad enemiga si la hay; si no, una Garrison o RWS).
export function aimTargets(state: GameState, unitId: string, weapon: Weapon, aim: AreaAim, prefer?: string | null): { hexes: string[]; primary: string | null } {
  const unit = state.units[unitId]
  if (!unit?.position) return { hexes: [], primary: null }
  const hexes = templateHexes(state, unit.position, weapon, aim)
  const valid = hexes.filter(k => targetAt(state, k, unit.playerId) && checkAttackTargetWith(state, unitId, weapon, k, aim).ok)
  const rank = (k: string) => (k === prefer ? 0 : 2) + (targetAt(state, k, unit.playerId)?.kind === 'unit' ? 0 : 1)
  const primary = [...valid].sort((a, b) => rank(a) - rank(b))[0] ?? null
  return { hexes, primary }
}

export function aimKey(aim: AreaAim | null): string {
  return !aim ? '' : aim.center ? `c${hexKey(aim.center)}` : `f${aim.facing}`
}
