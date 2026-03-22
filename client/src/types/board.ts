import type { TerrainType, HexCoord } from './units'

// Un hexágono del tablero
export interface Hex {
    coord: HexCoord
    terrain: TerrainType
    elevation: number      // 0 = suelo, 1-3 = altura

    // Tokens encima del hex
    occupiedBy: string | null    // id de la unidad, o null
    upgradeToken: UpgradeToken | null
    garrisonToken: GarrisonToken | null
    objectiveToken: ObjectiveToken | null
}

export interface UpgradeToken {
    type: 'attack' | 'movement' | 'shield'
    value: number
    revealed: boolean
}

export interface GarrisonToken {
    id: string
    owner: 'player1' | 'player2' | 'neutral'
    hp: number
}

export interface ObjectiveToken {
    id: string
    vpValue: number
    controlledBy: 'player1' | 'player2' | null
}

// El tablero completo: mapa de "q,r" → Hex
// Usamos string como clave para acceso rápido
export type BoardMap = Record<string, Hex>