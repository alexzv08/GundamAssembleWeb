import type { BoardMap } from '../types/board'
import type { Unit } from '../types/units'
import type { MapData, UnitCardData } from '../api/gameData'
import { offsetToAxial, hexKey } from './hexGrid'

// ─── CARGAR MAPA ──────────────────────────────────────────────────────────────
export function loadMapFromJSON(mapData: MapData): BoardMap {
    const board: BoardMap = {}

    // El JSON está organizado como grid[row][col]
    for (let row = 0; row < mapData.rows; row++) {
        for (let col = 0; col < mapData.cols; col++) {
            const cell = mapData.grid[row][col]
            const coord = offsetToAxial(col, row)
            const key = hexKey(coord)

            // Convertir elevation: en el JSON es 1-based, internamente 0-based
            const elevation = cell.elevation - 1

            // Normalizar terrain
            const terrain = normalizeTerrrain(cell.terrain, elevation)

            board[key] = {
                coord,
                terrain,
                elevation,
                occupiedBy: null,
                upgradeToken: null,
                garrisonToken: null,
                objectiveToken: null,
            }
        }
    }

    return board
}

function normalizeTerrrain(terrain: string, elevation: number): 'normal' | 'water' | 'elevation_1' | 'elevation_2' | 'elevation_3' {
    if (terrain === 'water') return 'water'
    if (elevation >= 3) return 'elevation_3'
    if (elevation >= 2) return 'elevation_2'
    if (elevation >= 1) return 'elevation_1'
    return 'normal'
}

// ─── CARGAR UNIDAD DESDE JSON ─────────────────────────────────────────────────
export function loadUnitFromJSON(
    card: UnitCardData,
    playerId: 'player1' | 'player2',
    position: { q: number; r: number },
    instanceId?: string
): Unit {
    return {
        id: instanceId ?? `${card.cardId}_${playerId}`,
        name: card.unitName,
        unitType: 'Mobile Suit',
        traits: [card.faction, ...(card.pilot === 'Mass Produced' ? ['Mass Produced'] : [])],
        maxHp: parseInt(card.hp),
        vp: parseInt(card.vp),
        startingTl: parseInt(card.tl),
        currentHp: parseInt(card.hp),
        energy: 0,
        position,
        weapons: card.weapons.map(w => ({
            name: w.name,
            range: parseInt(w.range),
            strength: parseInt(w.str),
            tlCost: parseInt(w.cost),
            critEffect: w.crit || undefined,
            specialRule: w.effect || undefined,
        })),
        abilities: card.abilities.map(a => ({
            name: a.name,
            type: normalizeAbilityType(a.type),
            description: a.effect,
            energyCost: a.tags.includes('Energy') ? 1 : undefined,
        })),
        statusEffects: [],
        upgrades: [],
        playerId,
        activated: false,
    }
}

function normalizeAbilityType(type: string): 'CMD' | 'ONG' | 'RSP' {
    if (type === 'burst') return 'CMD'
    if (type === 'ongoing') return 'ONG'
    if (type === 'response') return 'RSP'
    return 'CMD'
}