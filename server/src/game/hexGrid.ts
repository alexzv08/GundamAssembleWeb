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

// ─── PLANTILLA EN CUÑA (área "SP" en cono) ────────────────────────────────────
// Direcciones cúbicas en orden circular: E, NE, NO, O, SO, SE.
const CUBE_DIRS = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]] as const

// Cuña de 60° entre las direcciones `facing` y `facing + 1` (0-5), de `depth` hexes
// de fondo: 2 hexes a distancia 1, 3 a distancia 2, 4 a distancia 3… Es la forma
// del diagrama de las cartas (War Edge: fondo 2; Twin Buster Rifle: fondo 3).
// Plantilla fija: cada celda [a, b] es a·dir(facing) + b·dir(facing + 1) desde el origen.
export function patternHexes(origin: HexCoord, facing: number, cells: [number, number][]): HexCoord[] {
  const o = offsetToCube(origin.q, origin.r)
  const d1 = CUBE_DIRS[((facing % 6) + 6) % 6], d2 = CUBE_DIRS[(((facing + 1) % 6) + 6) % 6]
  return cells.map(([a, b]) => cubeToOffset(o.x + a * d1[0] + b * d2[0], o.z + a * d1[2] + b * d2[2]))
}

export function coneHexes(origin: HexCoord, facing: number, depth: number): HexCoord[] {
  const o = offsetToCube(origin.q, origin.r)
  const d1 = CUBE_DIRS[((facing % 6) + 6) % 6], d2 = CUBE_DIRS[(((facing + 1) % 6) + 6) % 6]
  const out: HexCoord[] = []
  for (let k = 1; k <= depth; k++) {
    for (let j = 0; j <= k; j++) {
      const i = k - j
      out.push(cubeToOffset(o.x + i * d1[0] + j * d2[0], o.z + i * d1[2] + j * d2[2]))
    }
  }
  return out
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

// nudge: desplazamiento minúsculo para desempatar cuando la línea pasa
// exactamente entre dos hexes (+1 / -1 eligen uno u otro lado).
export function hexLineDraw(a: HexCoord, b: HexCoord, nudge = 0): HexCoord[] {
  const dist = hexDistance(a, b)
  if (dist === 0) return [a]
  const ac = offsetToCube(a.q, a.r)
  const bc = offsetToCube(b.q, b.r)
  const e = 1e-6 * nudge
  const results: HexCoord[] = []
  for (let i = 0; i <= dist; i++) {
    const t = i / dist
    const rx = ac.x + e + (bc.x - ac.x) * t
    const ry = ac.y + 2 * e + (bc.y - ac.y) * t
    const rz = ac.z - 3 * e + (bc.z - ac.z) * t
    const rounded = cubeRound(rx, ry, rz)
    results.push(cubeToOffset(rounded.x, rounded.z))
  }
  return results
}

// ─── LINE OF SIGHT ────────────────────────────────────────────────────────────
// Core Rulebook v1.2, "Line of Sight". Se traza una línea entre centros:
//  • Bloquea el terreno a mayor elevación que atacante Y objetivo.
//  • Misma elevación: bloquean enemigos (unidades, Garrisons, Bases) a esa
//    misma elevación.
//  • Distinta elevación: bloquea el terreno o un enemigo a la elevación del
//    que está más alto.
//  • Los aliados nunca bloquean.
//  • Si la línea pasa justo entre dos hexes, el atacante elige → basta con
//    que una de las dos variantes esté despejada.
export interface LOSResult {
  clear: boolean
  reason?: string
}

export function checkLineOfSight(
  from: HexCoord,
  to: HexCoord,
  board: BoardMap,
  enemyBlockers: Set<string> = new Set(),
): LOSResult {
  const fromHex = board[hexKey(from)]
  const toHex = board[hexKey(to)]
  if (!fromHex || !toHex) return { clear: false, reason: 'Hex fuera del tablero' }
  if (hexDistance(from, to) <= 1) return { clear: true }

  const eA = fromHex.elevation
  const eT = toHex.elevation
  const hi = Math.max(eA, eT)

  const blocks = (key: string): string | null => {
    const hex = board[key]
    if (!hex) return null
    if (hex.elevation > hi) return `terreno elevado en ${key}`
    if (eA === eT) return enemyBlockers.has(key) && hex.elevation === eA ? `enemigo en ${key}` : null
    if (hex.elevation === hi) return enemyBlockers.has(key) ? `enemigo en ${key}` : `terreno en ${key}`
    return null
  }

  // Q&A oficial (Q.3): en cada punto donde la línea pasa justo entre dos
  // hexes, el atacante elige cuál cuenta, por separado en cada punto. Las dos
  // variantes desplazadas de la línea dan, paso a paso, los dos candidatos.
  const lineA = hexLineDraw(from, to, 1)
  const lineB = hexLineDraw(from, to, -1)
  for (let i = 1; i < lineA.length - 1; i++) {
    const ka = hexKey(lineA[i])
    const kb = hexKey(lineB[i])
    const ra = blocks(ka)
    const rb = ka === kb ? ra : blocks(kb)
    if (ra && rb) return { clear: false, reason: `Bloqueado por ${ra}` }
  }
  return { clear: true }
}

// ─── MOVIMIENTO ───────────────────────────────────────────────────────────────
// Core Rulebook v1.2, "Moving" / "Movement Modifiers" / "Jumping":
//  • Subir de elevación cuesta +1 por nivel ganado. Bajar no cuesta.
//  • Si la unidad empieza el movimiento en terreno elevado, salta: su
//    elevación inicial es la de referencia (solo paga lo que suba por encima)
//    y puede pasar por encima de enemigos a menor elevación.
//  • No se puede atravesar enemigos (unidades, Garrisons, Bases) ni terreno
//    Impassable (salvo Hover). Sí se atraviesan aliados.
//  • No se puede terminar en un hex ocupado, ni en Impassable.
//  • Hover ignora las penalizaciones de terreno (elevación incluida).
// Las penalizaciones al iniciar el movimiento (agua, debris, Engagement) se
// restan del presupuesto antes de llamar a estas funciones (ver queries.ts).
export interface MoveOptions {
  budget: number
  enemyHexes: Set<string>      // no se pueden atravesar
  occupiedHexes: Set<string>   // no se puede terminar en ellos
  hover?: boolean
  ignoreTerrain?: boolean      // efectos que ignoran penalizaciones de terreno
}

interface MoveNode { key: string; cost: number }

export function moveStepCost(
  board: BoardMap, fromKey: string, toKey: string, startElevation: number, opts: MoveOptions,
): number | null {
  const from = board[fromKey]
  const to = board[toKey]
  if (!from || !to) return null
  if (to.terrain === 'impassable' && !opts.hover) return null
  const jumping = startElevation > 0
  if (opts.enemyHexes.has(toKey) && !(jumping && to.elevation < startElevation)) return null
  if (opts.hover || opts.ignoreTerrain) return 1
  const reference = Math.max(from.elevation, startElevation)
  return 1 + Math.max(0, to.elevation - reference)
}

function exploreMoves(start: HexCoord, board: BoardMap, opts: MoveOptions) {
  const startKey = hexKey(start)
  const startElevation = board[startKey]?.elevation ?? 0
  const best = new Map<string, number>([[startKey, 0]])
  const parent = new Map<string, string>()
  const queue: MoveNode[] = [{ key: startKey, cost: 0 }]

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost)
    const { key, cost } = queue.shift()!
    if (cost > (best.get(key) ?? Infinity)) continue
    for (const n of getNeighbors(keyToHex(key))) {
      const nKey = hexKey(n)
      const step = moveStepCost(board, key, nKey, startElevation, opts)
      if (step === null) continue
      const newCost = cost + step
      if (newCost > opts.budget) continue
      if (newCost < (best.get(nKey) ?? Infinity)) {
        best.set(nKey, newCost)
        parent.set(nKey, key)
        queue.push({ key: nKey, cost: newCost })
      }
    }
  }
  return { startKey, best, parent }
}

function canEndOn(board: BoardMap, key: string, startKey: string, opts: MoveOptions): boolean {
  if (key === startKey) return false
  const hex = board[key]
  if (!hex || hex.terrain === 'impassable') return false
  return !opts.occupiedHexes.has(key)
}

// Hexes donde la unidad puede terminar su movimiento → coste
export function getReachableHexes(start: HexCoord, board: BoardMap, opts: MoveOptions): Map<string, number> {
  const { startKey, best } = exploreMoves(start, board, opts)
  const result = new Map<string, number>()
  for (const [key, cost] of best) {
    if (canEndOn(board, key, startKey, opts)) result.set(key, cost)
  }
  return result
}

// Camino (incluye inicio y destino) o null si no es un destino válido
export function findPath(start: HexCoord, goal: HexCoord, board: BoardMap, opts: MoveOptions): HexCoord[] | null {
  const { startKey, best, parent } = exploreMoves(start, board, opts)
  const goalKey = hexKey(goal)
  if (!best.has(goalKey) || !canEndOn(board, goalKey, startKey, opts)) return null
  const path: HexCoord[] = []
  let cur: string | undefined = goalKey
  while (cur) {
    path.unshift(keyToHex(cur))
    cur = parent.get(cur)
  }
  return path
}
