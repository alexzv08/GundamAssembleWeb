import type { BoardMap } from '../types/board'
import type { MapData } from '../api/gameData'
import type { TerrainType } from '../types/units'
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
                terrain: normalizeTerrrain(cell.terrain),
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

const KNOWN_TERRAIN: TerrainType[] = ['water', 'debris', 'impassable', 'minovsky']

function normalizeTerrrain(terrain: string): TerrainType {
    return (KNOWN_TERRAIN as string[]).includes(terrain) ? terrain as TerrainType : 'normal'
}
