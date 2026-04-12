import type { BoardMap, HexCoord } from '../types'

// ─── CONVERSIÓN ───────────────────────────────────────────────────────────────
export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`
}

export function keyToHex(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

// Pointy-top odd-r: q=col, r=row (identidad directa)
export function offsetToAxial(col: number, row: number): HexCoord {
  return { q: col, r: row }
}

export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q, row: r }
}

// ─── DISTANCIA ────────────────────────────────────────────────────────────────
// Convierte offset odd-r a cúbico para calcular distancia correcta
function offsetToCube(q: number, r: number) {
  const x = q - (r - (r & 1)) / 2
  const z = r
  const y = -x - z
  return { x, y, z }
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const ac = offsetToCube(a.q, a.r)
  const bc = offsetToCube(b.q, b.r)
  return Math.max(
    Math.abs(ac.x - bc.x),
    Math.abs(ac.y - bc.y),
    Math.abs(ac.z - bc.z)
  )
}

export function gridDistance(a: HexCoord, b: HexCoord): number {
  return hexDistance(a, b)
}

// ─── VECINOS ──────────────────────────────────────────────────────────────────
// Pointy-top odd-r offset: filas impares desplazadas a la derecha
export function getNeighbors(coord: HexCoord): HexCoord[] {
  const { q, r } = coord
  const isOdd = r & 1

  if (isOdd) {
    return [
      { q: q + 1, r: r },
      { q: q - 1, r: r },
      { q: q, r: r - 1 },
      { q: q + 1, r: r - 1 },
      { q: q, r: r + 1 },
      { q: q + 1, r: r + 1 },
    ]
  } else {
    return [
      { q: q + 1, r: r },
      { q: q - 1, r: r },
      { q: q - 1, r: r - 1 },
      { q: q, r: r - 1 },
      { q: q - 1, r: r + 1 },
      { q: q, r: r + 1 },
    ]
  }
}

// ─── HEXES EN RANGO ───────────────────────────────────────────────────────────
export function hexesInRange(origin: HexCoord, range: number): HexCoord[] {
  const results: HexCoord[] = []
  const visited = new Set<string>([hexKey(origin)])
  const queue: { coord: HexCoord; dist: number }[] = [{ coord: origin, dist: 0 }]

  while (queue.length > 0) {
    const { coord, dist } = queue.shift()!
    if (dist >= range) continue
    for (const n of getNeighbors(coord)) {
      const key = hexKey(n)
      if (visited.has(key)) continue
      visited.add(key)
      results.push(n)
      queue.push({ coord: n, dist: dist + 1 })
    }
  }
  return results
}

// ─── LÍNEA DE HEXES ───────────────────────────────────────────────────────────
function cubeToOffset(x: number, z: number): HexCoord {
  const q = x + (z - (z & 1)) / 2
  const r = z
  return { q, r }
}

function cubeRound(x: number, y: number, z: number) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z)
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return { x: rx, y: ry, z: rz }
}

export function hexLineDraw(a: HexCoord, b: HexCoord): HexCoord[] {
  const dist = hexDistance(a, b)
  if (dist === 0) return [a]
  const ac = offsetToCube(a.q, a.r)
  const bc = offsetToCube(b.q, b.r)
  const results: HexCoord[] = []
  for (let i = 0; i <= dist; i++) {
    const t = i / dist
    const rx = ac.x + (bc.x - ac.x) * t
    const ry = ac.y + (bc.y - ac.y) * t
    const rz = ac.z + (bc.z - ac.z) * t
    const rounded = cubeRound(rx, ry, rz)
    results.push(cubeToOffset(rounded.x, rounded.z))
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
  const visited = new Map<string, number>()  // key → menor coste encontrado
  visited.set(hexKey(start), 0)

  // Cola de prioridad: [coste, coord]
  const queue: { coord: HexCoord; cost: number }[] = [{ coord: start, cost: 0 }]

  while (queue.length > 0) {
    // Ordenar por coste — explorar primero los más baratos
    queue.sort((a, b) => a.cost - b.cost)
    const { coord, cost } = queue.shift()!

    for (const neighbor of getNeighbors(coord)) {
      const key = hexKey(neighbor)
      if (!board[key]) continue
      if (obstacles.has(key)) continue

      const hex = board[key]
      const currentHex = board[hexKey(coord)]
      const elevCost = Math.max(0, hex.elevation - (currentHex?.elevation ?? 0))
      const waterCost = currentHex?.terrain === 'water' ? 1 : 0
      const newCost = cost + 1 + elevCost + waterCost

      if (newCost > maxDistance) continue

      // Solo añadir si no hemos visitado con menor o igual coste
      if (!visited.has(key) || newCost < visited.get(key)!) {
        visited.set(key, newCost)
        reachable.push(neighbor)
        queue.push({ coord: neighbor, cost: newCost })
      }
    }
  }

  // Eliminar duplicados
  const seen = new Set<string>()
  return reachable.filter(h => {
    const k = hexKey(h)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}