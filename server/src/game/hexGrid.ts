import type { BoardMap, HexCoord } from '../types'

// ─── CONVERSIÓN ───────────────────────────────────────────────────────────────
export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`
}

export function keyToHex(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

// Convierte col/row de grid rectangular a coordenadas axiales (flat-top, odd-q offset)
export function offsetToAxial(col: number, row: number): HexCoord {
  const q = col
  const r = row - (col - (col & 1)) / 2
  return { q, r }
}

// Convierte coordenadas axiales a col/row
export function axialToOffset(q: number, r: number): { col: number; row: number } {
  const col = q
  const row = r + (q - (q & 1)) / 2
  return { col, row }
}

// ─── DISTANCIA ────────────────────────────────────────────────────────────────
// Fórmula exacta de redblobgames para coordenadas axiales
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

// ─── VECINOS ──────────────────────────────────────────────────────────────────
// Los 6 vecinos en coordenadas axiales — siempre correcto independientemente del layout
const AXIAL_DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function getNeighbors(coord: HexCoord): HexCoord[] {
  return AXIAL_DIRECTIONS.map(dir => ({
    q: coord.q + dir.q,
    r: coord.r + dir.r,
  }))
}

// ─── HEXES EN RANGO ───────────────────────────────────────────────────────────
export function hexesInRange(origin: HexCoord, range: number): HexCoord[] {
  const results: HexCoord[] = []
  for (let q = -range; q <= range; q++) {
    for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
      if (q === 0 && r === 0) continue
      results.push({ q: origin.q + q, r: origin.r + r })
    }
  }
  return results
}

// ─── LÍNEA DE HEXES ───────────────────────────────────────────────────────────
function hexLerp(a: HexCoord, b: HexCoord, t: number): HexCoord {
  const aq = a.q, ar = a.r, as_ = -a.q - a.r
  const bq = b.q, br = b.r, bs_ = -b.q - b.r
  return cubeRound(
    aq + (bq - aq) * t,
    ar + (br - ar) * t,
    as_ + (bs_ - as_) * t
  )
}

function cubeRound(fq: number, fr: number, fs: number): HexCoord {
  let q = Math.round(fq)
  let r = Math.round(fr)
  const s = Math.round(fs)
  const dq = Math.abs(q - fq)
  const dr = Math.abs(r - fr)
  const ds = Math.abs(s - fs)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return { q, r }
}

export function hexLineDraw(a: HexCoord, b: HexCoord): HexCoord[] {
  const dist = hexDistance(a, b)
  if (dist === 0) return [a]
  const results: HexCoord[] = []
  for (let i = 0; i <= dist; i++) {
    results.push(hexLerp(a, b, i / dist))
  }
  return results
}

// ─── LINE OF SIGHT ────────────────────────────────────────────────────────────
export interface LOSResult {
  clear: boolean
  reason?: string
}

export function checkLineOfSight(
  attackerCoord: HexCoord,
  targetCoord: HexCoord,
  board: BoardMap,
  attackerPlayerId: 'player1' | 'player2',
  enemyUnitPositions: Set<string>
): LOSResult {
  if (hexDistance(attackerCoord, targetCoord) <= 1) return { clear: true }

  const attackerHex = board[hexKey(attackerCoord)]
  if (!attackerHex) return { clear: false, reason: 'Atacante fuera del tablero' }

  const attackerElevation = attackerHex.elevation
  const line = hexLineDraw(attackerCoord, targetCoord)
  const intermediate = line.slice(1, -1)

  for (const coord of intermediate) {
    const key = hexKey(coord)
    const hex = board[key]
    if (!hex) continue

    if (hex.elevation > attackerElevation) {
      return { clear: false, reason: `Bloqueado por elevación en ${key}` }
    }

    const targetHex = board[hexKey(targetCoord)]
    if (targetHex && attackerElevation > targetHex.elevation) {
      if (hex.elevation === attackerElevation) {
        return { clear: false, reason: `Bloqueado por elevación igual al atacante en ${key}` }
      }
    }

    if (hex.occupiedBy && enemyUnitPositions.has(hex.occupiedBy)) {
      return { clear: false, reason: `Bloqueado por unidad enemiga en ${key}` }
    }

    if (hex.objectiveToken) {
      return { clear: false, reason: `Bloqueado por objetivo en ${key}` }
    }
  }

  return { clear: true }
}

// ─── PATHFINDING (A*) ─────────────────────────────────────────────────────────
export function findPath(
  start: HexCoord,
  goal: HexCoord,
  board: BoardMap,
  obstacles: Set<string>,
  maxDistance: number
): HexCoord[] | null {
  const startKey = hexKey(start)
  const goalKey = hexKey(goal)

  if (obstacles.has(goalKey)) return null
  if (!board[goalKey]) return null

  type Node = { coord: HexCoord; cost: number; estimated: number }
  const open: Node[] = [{ coord: start, cost: 0, estimated: hexDistance(start, goal) }]
  const cameFrom = new Map<string, string>()
  const costSoFar = new Map<string, number>([[startKey, 0]])

  while (open.length > 0) {
    open.sort((a, b) => (a.cost + a.estimated) - (b.cost + b.estimated))
    const current = open.shift()!
    const currentKey = hexKey(current.coord)

    if (currentKey === goalKey) {
      const path: HexCoord[] = []
      let key = goalKey
      while (key !== startKey) {
        path.unshift(keyToHex(key))
        key = cameFrom.get(key)!
      }
      return path
    }

    for (const neighbor of getNeighbors(current.coord)) {
      const neighborKey = hexKey(neighbor)
      if (!board[neighborKey]) continue
      if (obstacles.has(neighborKey) && neighborKey !== goalKey) continue

      const hex = board[neighborKey]
      const currentHex = board[currentKey]
      const elevationCost = Math.max(0, hex.elevation - (currentHex?.elevation ?? 0))
      const waterCost = currentHex?.terrain === 'water' ? 1 : 0
      const newCost = (costSoFar.get(currentKey) ?? 0) + 1 + elevationCost + waterCost

      if (newCost > maxDistance) continue
      if (!costSoFar.has(neighborKey) || newCost < costSoFar.get(neighborKey)!) {
        costSoFar.set(neighborKey, newCost)
        cameFrom.set(neighborKey, currentKey)
        open.push({ coord: neighbor, cost: newCost, estimated: hexDistance(neighbor, goal) })
      }
    }
  }

  return null
}

// ─── HEXES ALCANZABLES ────────────────────────────────────────────────────────
export function getReachableHexes(
  start: HexCoord,
  board: BoardMap,
  obstacles: Set<string>,
  maxDistance: number
): HexCoord[] {
  const reachable: HexCoord[] = []
  const visited = new Set<string>([hexKey(start)])
  const queue: { coord: HexCoord; movesLeft: number }[] = [
    { coord: start, movesLeft: maxDistance }
  ]

  while (queue.length > 0) {
    const { coord, movesLeft } = queue.shift()!

    for (const neighbor of getNeighbors(coord)) {
      const key = hexKey(neighbor)
      if (visited.has(key)) continue
      if (!board[key]) continue
      if (obstacles.has(key)) continue

      visited.add(key)

      const hex = board[key]
      const currentHex = board[hexKey(coord)]
      const elevationCost = Math.max(0, hex.elevation - (currentHex?.elevation ?? 0))
      const waterCost = currentHex?.terrain === 'water' ? 1 : 0
      const cost = 1 + elevationCost + waterCost

      if (movesLeft - cost >= 0) {
        reachable.push(neighbor)
        queue.push({ coord: neighbor, movesLeft: movesLeft - cost })
      }
    }
  }




  return reachable
}

// Distancia correcta entre dos posiciones en nuestro sistema offset
export function gridDistance(
  a: HexCoord,
  b: HexCoord
): number {
  // Convertir offset a axial real antes de calcular distancia
  const toAxial = (coord: HexCoord) => {
    const q = coord.q
    const r = coord.r - (coord.q - (coord.q & 1)) / 2
    return { q, r }
  }
  const ac = toAxial(a)
  const bc = toAxial(b)
  const dq = ac.q - bc.q
  const dr = ac.r - bc.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}