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

// Paleta del tablero: tonos apagados de "mesa al anochecer" para que los
// resaltados (cian, rojo, ámbar) y las unidades destaquen. La altura se lee por
// tono (más claro y más cálido cuanto más alto) y por la altura física del hex.
export interface TerrainLook { top: string; side: string; emissive?: string; emissiveIntensity?: number; label: string }

export function terrainLook(terrain: string, elevation: number): TerrainLook {
    if (terrain === 'water') return { top: '#245d86', side: '#163a55', emissive: '#1d6fa8', emissiveIntensity: 0.25, label: 'Agua' }
    if (terrain === 'debris') return { top: '#5a4c40', side: '#3a3029', label: 'Debris' }
    if (terrain === 'impassable') return { top: '#25272e', side: '#17181d', label: 'Infranqueable' }
    if (terrain === 'minovsky') return { top: '#4b3d78', side: '#2d2449', emissive: '#7e57c2', emissiveIntensity: 0.35, label: 'Partículas Minovsky' }
    if (elevation >= 3) return { top: '#9a9a90', side: '#5d5d57', label: 'Elevación 3' }
    if (elevation >= 2) return { top: '#8a7556', side: '#57492f', label: 'Elevación 2' }
    if (elevation >= 1) return { top: '#6b8758', side: '#3e5233', label: 'Elevación 1' }
    return { top: '#4a6844', side: '#2b3f28', label: 'Llano' }
}

/** @deprecated usar terrainLook */
export function terrainColor(terrain: string, elevation: number): string {
    return terrainLook(terrain, elevation).top
}
