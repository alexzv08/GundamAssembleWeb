import { HexCoord } from '../types'

// ─── CONVERSIÓN ─────────────────────────────────────────────────────────────
// Convierte coordenadas axiales a string para usar como clave en BoardMap
export function hexKey(coord: HexCoord): string {
    return `${coord.q},${coord.r}`
}

// Convierte string "q,r" de vuelta a HexCoord
export function keyToHex(key: string): HexCoord {
    const [q, r] = key.split(',').map(Number)
    return { q, r }
}

// ─── DISTANCIA ───────────────────────────────────────────────────────────────
// En coordenadas axiales la distancia entre dos hexágonos es:
// max(|dq|, |dr|, |dq+dr|) — equivale a pasos mínimos en la grid
export function hexDistance(a: HexCoord, b: HexCoord): number {
    const dq = a.q - b.q
    const dr = a.r - b.r
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

// ─── VECINOS ─────────────────────────────────────────────────────────────────
// Los 6 hexágonos adyacentes en sistema axial
const HEX_DIRECTIONS: HexCoord[] = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
]

export function getNeighbors(coord: HexCoord): HexCoord[] {
    return HEX_DIRECTIONS.map(dir => ({
        q: coord.q + dir.q,
        r: coord.r + dir.r,
    }))
}

// Vecinos que existen en el tablero
export function getValidNeighbors(coord: HexCoord, board: Set<string>): HexCoord[] {
    return getNeighbors(coord).filter(n => board.has(hexKey(n)))
}

// ─── HEXÁGONOS EN RANGO ───────────────────────────────────────────────────────
// Todos los hexágonos a distancia <= range desde origin
export function hexesInRange(origin: HexCoord, range: number): HexCoord[] {
    const results: HexCoord[] = []
    for (let q = -range; q <= range; q++) {
        for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
            if (q === 0 && r === 0) continue  // excluir el origen
            results.push({ q: origin.q + q, r: origin.r + r })
        }
    }
    return results
}

// ─── LÍNEA ENTRE DOS HEXÁGONOS ────────────────────────────────────────────────
// Devuelve todos los hexágonos que forman la línea recta entre a y b
// Usada para calcular Line of Sight
function hexLerp(a: HexCoord, b: HexCoord, t: number): HexCoord {
    // Interpolación en coordenadas cúbicas (s = -q - r)
    const aq = a.q, ar = a.r, as_ = -a.q - a.r
    const bq = b.q, br = b.r, bs_ = -b.q - b.r
    const rq = aq + (bq - aq) * t
    const rr = ar + (br - ar) * t
    const rs = as_ + (bs_ - as_) * t
    return cubeRound(rq, rr, rs)
}

// Redondea coordenadas cúbicas al hexágono más cercano
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
// Según las reglas: LOS bloqueado si la línea pasa por hex de elevación
// mayor que el atacante, por unidad enemiga, o por base/objetivo enemigo.
// Devuelve { clear: boolean, reason?: string }

import { BoardMap } from '../types'

export interface LOSResult {
    clear: boolean
    reason?: string
}

export function checkLineOfSight(
    attackerCoord: HexCoord,
    targetCoord: HexCoord,
    board: BoardMap,
    attackerPlayerId: 'player1' | 'player2',
    // ids de unidades enemigas en el tablero (para bloqueo por unidad)
    enemyUnitPositions: Set<string>
): LOSResult {
    // A rango 1 no se requiere LOS check
    if (hexDistance(attackerCoord, targetCoord) <= 1) {
        return { clear: true }
    }

    const attackerHex = board[hexKey(attackerCoord)]
    if (!attackerHex) return { clear: false, reason: 'Atacante fuera del tablero' }

    const attackerElevation = attackerHex.elevation
    const line = hexLineDraw(attackerCoord, targetCoord)

    // Revisamos todos los hexes intermedios (excluir origen y destino)
    const intermediate = line.slice(1, -1)

    for (const coord of intermediate) {
        const key = hexKey(coord)
        const hex = board[key]
        if (!hex) continue

        // Regla 1: hex intermedio con elevación mayor que el atacante bloquea
        if (hex.elevation > attackerElevation) {
            return { clear: false, reason: `Bloqueado por elevación en ${key}` }
        }

        // Regla 2: si atacante está más alto que el objetivo,
        // hex intermedio a la misma elevación del atacante también bloquea
        const targetHex = board[hexKey(targetCoord)]
        if (targetHex && attackerElevation > targetHex.elevation) {
            if (hex.elevation === attackerElevation) {
                return { clear: false, reason: `Bloqueado por elevación igual al atacante en ${key}` }
            }
        }

        // Regla 3: unidad enemiga en hex intermedio bloquea
        if (hex.occupiedBy && enemyUnitPositions.has(hex.occupiedBy)) {
            return { clear: false, reason: `Bloqueado por unidad enemiga en ${key}` }
        }

        // Regla 4: base u objetivo enemigo bloquea
        if (hex.objectiveToken) {
            return { clear: false, reason: `Bloqueado por objetivo en ${key}` }
        }
    }

    return { clear: true }
}

// ─── PATHFINDING (A*) ─────────────────────────────────────────────────────────
// Devuelve el camino más corto de start a goal evitando obstáculos.
// obstacles: set de hexKeys que no se pueden atravesar (unidades enemigas, etc.)
// maxDistance: límite de movimiento (ej: 3 para Advance, 5 para Advance+Dash)

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

    // Cola de prioridad simple (para este tamaño de tablero es suficiente)
    type Node = { coord: HexCoord; cost: number; estimated: number }
    const open: Node[] = [{ coord: start, cost: 0, estimated: hexDistance(start, goal) }]
    const cameFrom = new Map<string, string>()
    const costSoFar = new Map<string, number>([[startKey, 0]])

    while (open.length > 0) {
        // Sacar el nodo con menor coste estimado
        open.sort((a, b) => (a.cost + a.estimated) - (b.cost + b.estimated))
        const current = open.shift()!
        const currentKey = hexKey(current.coord)

        if (currentKey === goalKey) {
            // Reconstruir camino
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

            // Solo hexes que existen en el tablero
            if (!board[neighborKey]) continue
            // No pasar por obstáculos (salvo que sea el destino)
            if (obstacles.has(neighborKey) && neighborKey !== goalKey) continue

            const hex = board[neighborKey]
            // Coste extra por elevación
            const elevationCost = Math.max(0, hex.elevation - board[currentKey]?.elevation ?? 0)
            // Coste extra si empieza en agua
            const waterCost = board[currentKey]?.terrain === 'water' ? 1 : 0
            const newCost = (costSoFar.get(currentKey) ?? 0) + 1 + elevationCost + waterCost

            if (newCost > maxDistance) continue
            if (!costSoFar.has(neighborKey) || newCost < costSoFar.get(neighborKey)!) {
                costSoFar.set(neighborKey, newCost)
                cameFrom.set(neighborKey, currentKey)
                open.push({
                    coord: neighbor,
                    cost: newCost,
                    estimated: hexDistance(neighbor, goal),
                })
            }
        }
    }

    return null  // No hay camino posible
}

// ─── HEXES ALCANZABLES ────────────────────────────────────────────────────────
// Todos los hexes a los que una unidad puede moverse (para resaltar en el tablero)
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