import { axialToOffset } from '../game/hexGrid'

export const HEX_SIZE = 1
export const HEX_HEIGHT = 0.2

export function hexToWorld(q: number, r: number, elevation: number = 0): [number, number, number] {
    const { col, row } = axialToOffset(q, r)
    const width = Math.sqrt(3) * HEX_SIZE
    const height = 2 * HEX_SIZE
    const x = col * (height * 0.75)
    const z = row * width + (col % 2) * (width / 2)
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