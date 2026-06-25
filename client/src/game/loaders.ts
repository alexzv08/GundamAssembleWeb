import type { BoardMap } from '../types/board'
import type { MapData, UnitCardData } from '../api/gameData'
import { offsetToAxial, hexKey } from './hexGrid'

interface ScenarioToken { col: number; row: number; id: string; vpValue?: number; owner?: string; hp?: number; type?: string; value?: number }

// ─── CARGAR MAPA ──────────────────────────────────────────────────────────────
export function loadMapFromJSON(mapData: MapData): BoardMap {
    const board: BoardMap = {}

    for (let row = 0; row < mapData.rows; row++) {
        for (let col = 0; col < mapData.cols; col++) {
            const cell = mapData.grid[row][col]
            const coord = offsetToAxial(col, row)
            const key = hexKey(coord)
            const elevation = cell.elevation - 1

            board[key] = {
                coord,
                terrain: normalizeTerrrain(cell.terrain, elevation),
                elevation,
                occupiedBy: null,
                upgradeToken: null,
                garrisonToken: null,
                objectiveToken: null,
                deployZone: null,
            }
        }
    }

    // Colocar tokens del escenario si existe
    const scenario = (mapData as MapData & { scenario?: { objectives?: ScenarioToken[]; garrisons?: ScenarioToken[]; upgrades?: ScenarioToken[] } }).scenario
    if (scenario) {
        scenario.objectives?.forEach((obj) => {
            const coord = offsetToAxial(obj.col, obj.row)
            const key = hexKey(coord)
            if (board[key]) board[key].objectiveToken = { id: obj.id, vpValue: obj.vpValue ?? 0, controlledBy: null }
        })

        scenario.garrisons?.forEach((gar) => {
            const coord = offsetToAxial(gar.col, gar.row)
            const key = hexKey(coord)
            if (board[key]) board[key].garrisonToken = { id: gar.id, owner: (gar.owner ?? 'neutral') as 'player1' | 'player2' | 'neutral', hp: gar.hp ?? 0 }
        })

        scenario.upgrades?.forEach((upg) => {
            const coord = offsetToAxial(upg.col, upg.row)
            const key = hexKey(coord)
            if (board[key]) board[key].upgradeToken = { type: (upg.type ?? 'attack') as 'attack' | 'shield' | 'movement' | 'energy', value: upg.value ?? 1, revealed: false }
        })
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

export function loadUnitFromJSON(
    card: UnitCardData,
    playerId: 'player1' | 'player2',
    position: { q: number; r: number },
    instanceId?: string
) {
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