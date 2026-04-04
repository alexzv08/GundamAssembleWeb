import { axialToOffset } from '../game/hexGrid'

export const HEX_SIZE = 1
export const HEX_HEIGHT = 0.2

// Pointy-top hex geometry
// col step = sqrt(3)*R, row step = 1.5*R, odd rows shift right by sqrt(3)*R/2
export function hexToWorld(q: number, r: number, elevation: number = 0): [number, number, number] {
    const { col, row } = axialToOffset(q, r)
    const SQ3 = Math.sqrt(3)
    // Pointy-top odd-r: filas impares desplazadas a la derecha
    const x = col * SQ3 * HEX_SIZE + (row % 2 === 1 ? SQ3 / 2 * HEX_SIZE : 0)
    const z = row * 1.5 * HEX_SIZE
    const y = elevation * 0.3
    return [x, y, z]
}

export function terrainColor(terrain: string, elevation: number): string {
    if (terrain === 'water') return '#4a90d9'
    if (elevation >= 3) return '#888888'
    if (elevation >= 2) return '#a0856b'
    if (elevation >= 1) return '#7a9e5a'
    return '#5a8a3a'
}