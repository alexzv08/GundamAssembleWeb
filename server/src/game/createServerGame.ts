import { GameState, BoardMap } from '../types'
import { createEmptyTimeline, placeInitialToken } from './timeline'
import { offsetToAxial, hexKey } from './hexGrid'
import fs from 'fs'
import path from 'path'

interface MapCell { terrain: string; elevation: number }
interface ScenarioObjective { col: number; row: number; id: string; vpValue: number }
interface ScenarioGarrison { col: number; row: number; id: string; owner: 'player1' | 'player2'; hp: number }
interface ScenarioUpgrade { col: number; row: number; id: string; type: 'attack' | 'movement' | 'shield' | 'energy' | 'random'; value: number }
interface ScenarioZone { col: number; row: number }
interface Scenario {
    name: string
    objectives: ScenarioObjective[]
    garrisons: ScenarioGarrison[]
    upgrades: ScenarioUpgrade[]
    deployZones: { player1: ScenarioZone[]; player2: ScenarioZone[] }
}
interface MapJSON { cols: number; rows: number; grid: MapCell[][]; scenario?: Scenario }
interface WeaponJSON { name: string; cost: string; range: string; str: string; effect: string; crit: string }
interface AbilityJSON { name: string; type: string; tags: string; effect: string }
interface UnitJSON { unitName: string; pilot: string; faction: string; cardId: string; hp: string; vp: string; tl: string; weapons: WeaponJSON[]; abilities: AbilityJSON[] }
interface UnitsJSON { cards: UnitJSON[] }

function loadJSON<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
}

function normalizeAbilityType(type: string): 'CMD' | 'ONG' | 'RSP' {
    if (type === 'burst') return 'CMD'
    if (type === 'ongoing') return 'ONG'
    if (type === 'response') return 'RSP'
    return 'CMD'
}

const UPGRADE_TYPES: ('attack' | 'movement' | 'shield')[] = ['attack', 'movement', 'shield']

function getNeighbors(coord: { q: number; r: number }): { q: number; r: number }[] {
    const { q, r } = coord
    const isOdd = r & 1
    if (isOdd) {
        return [
            { q: q + 1, r: r }, { q: q - 1, r: r },
            { q: q, r: r - 1 }, { q: q + 1, r: r - 1 },
            { q: q, r: r + 1 }, { q: q + 1, r: r + 1 },
        ]
    } else {
        return [
            { q: q + 1, r: r }, { q: q - 1, r: r },
            { q: q - 1, r: r - 1 }, { q: q, r: r - 1 },
            { q: q - 1, r: r + 1 }, { q: q, r: r + 1 },
        ]
    }
}

function findNearestValidHex(
    coord: { q: number; r: number },
    board: BoardMap
): { q: number; r: number } {
    if (board[hexKey(coord)]) return coord
    const neighbors = getNeighbors(coord)
    for (const n of neighbors) {
        if (board[hexKey(n)]) return n
    }
    // Si ningún vecino es válido, buscar en radio 2
    for (const n of neighbors) {
        for (const n2 of getNeighbors(n)) {
            if (board[hexKey(n2)]) return n2
        }
    }
    return coord
}

export function createServerGame(player1Name: string, player2Name: string): GameState {
    const dataDir = path.join(__dirname, '../../data')
    const mapData = loadJSON<MapJSON>(path.join(dataDir, 'maps/DemoMap.json'))
    const unitData = loadJSON<UnitsJSON>(path.join(dataDir, 'units/unit_library.json'))

    // ─── CONSTRUIR TABLERO ────────────────────────────────────────────────────
    const board: BoardMap = {}

    for (let row = 0; row < mapData.rows; row++) {
        for (let col = 0; col < mapData.cols; col++) {
            if (row % 2 === 1 && col === mapData.cols - 1) continue
            const cell = mapData.grid[row][col]
            const coord = offsetToAxial(col, row)
            const key = hexKey(coord)
            const elevation = cell.elevation - 1

            board[key] = {
                coord,
                elevation,
                terrain: elevation >= 3 ? 'elevation_3'
                    : elevation >= 2 ? 'elevation_2'
                        : elevation >= 1 ? 'elevation_1'
                            : cell.terrain === 'water' ? 'water' : 'normal',
                occupiedBy: null,
                upgradeToken: null,
                garrisonToken: null,
                objectiveToken: null,
                deployZone: null,
            }
        }
    }

    // ─── COLOCAR TOKENS DEL ESCENARIO ─────────────────────────────────────────
    const deployP1Raw = mapData.scenario?.deployZones?.player1 ?? []
    const deployP2Raw = mapData.scenario?.deployZones?.player2 ?? []

    if (mapData.scenario) {
        const s = mapData.scenario

        s.objectives.forEach(obj => {
            const key = hexKey(offsetToAxial(obj.col, obj.row))
            if (board[key]) board[key].objectiveToken = {
                id: obj.id, vpValue: obj.vpValue, controlledBy: null,
            }
        })

        s.garrisons.forEach(gar => {
            const key = hexKey(offsetToAxial(gar.col, gar.row))
            if (board[key]) board[key].garrisonToken = {
                id: gar.id, owner: gar.owner, hp: gar.hp,
            }
        })

        s.upgrades.forEach(upg => {
            const key = hexKey(offsetToAxial(upg.col, upg.row))
            if (board[key]) {
                const resolvedType = upg.type === 'random'
                    ? UPGRADE_TYPES[Math.floor(Math.random() * UPGRADE_TYPES.length)]
                    : upg.type as 'attack' | 'movement' | 'shield' | 'energy'
                board[key].upgradeToken = { type: resolvedType, value: upg.value, revealed: false }
            }
        })
    }

    // ─── POSICIONES DE DEPLOY ─────────────────────────────────────────────────
    const p1DeployRaw = deployP1Raw[0]
        ? offsetToAxial(deployP1Raw[0].col, deployP1Raw[0].row)
        : { q: 0, r: 7 }
    const p2DeployRaw = deployP2Raw[0]
        ? offsetToAxial(deployP2Raw[0].col, deployP2Raw[0].row)
        : { q: 12, r: 7 }

    // Buscar hex válido más cercano si el deploy está fuera de bounds
    const p1Deploy = findNearestValidHex(p1DeployRaw, board)
    const p2Deploy = findNearestValidHex(p2DeployRaw, board)

    // Marcar zonas de despliegue
    deployP1Raw.forEach(z => {
        const coord = findNearestValidHex(offsetToAxial(z.col, z.row), board)
        const key = hexKey(coord)
        if (board[key]) board[key].deployZone = 'player1'
    })
    deployP2Raw.forEach(z => {
        const coord = findNearestValidHex(offsetToAxial(z.col, z.row), board)
        const key = hexKey(coord)
        if (board[key]) board[key].deployZone = 'player2'
    })

    const fedCards = unitData.cards.filter(c => c.faction === 'Earth Federation').slice(0, 3)
    const zeonCards = unitData.cards.filter(c => c.faction === 'Zeon').slice(0, 3)

    const createUnit = (card: UnitJSON, playerId: 'player1' | 'player2') => ({
        id: `${card.cardId}_${playerId}`,
        name: card.unitName,
        unitType: 'Mobile Suit',
        traits: [card.faction, ...(card.pilot === 'Mass Produced' ? ['Mass Produced'] : [])],
        maxHp: parseInt(card.hp),
        vp: parseInt(card.vp),
        startingTl: parseInt(card.tl),
        currentHp: parseInt(card.hp),
        energy: 0,
        position: null as { q: number; r: number } | null,
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
    })

    const p1Units = fedCards.map(c => createUnit(c, 'player1'))
    const p2Units = zeonCards.map(c => createUnit(c, 'player2'))
    const allUnits = [...p1Units, ...p2Units]

    // ─── TIMELINE ─────────────────────────────────────────────────────────────
    let timeline = createEmptyTimeline()
    allUnits.forEach(u => {
        timeline = placeInitialToken(timeline, { unitId: u.id, playerId: u.playerId }, u.startingTl)
    })

    const firstToken = timeline.slots.find(s => s.tokens.length > 0)?.tokens[0]

    // ─── SPAWN PRIMERA UNIDAD DE CADA JUGADOR ─────────────────────────────────
    const firstP1Unit = p1Units[0]
    const firstP2Unit = p2Units[0]

    const p1DeployKey = hexKey(p1Deploy)
    const p2DeployKey = hexKey(p2Deploy)

    if (firstP1Unit && board[p1DeployKey] && !board[p1DeployKey].occupiedBy) {
        firstP1Unit.position = p1Deploy
        board[p1DeployKey].occupiedBy = firstP1Unit.id
    }

    if (firstP2Unit && board[p2DeployKey] && !board[p2DeployKey].occupiedBy) {
        firstP2Unit.position = p2Deploy
        board[p2DeployKey].occupiedBy = firstP2Unit.id
    }

    // ─── GAME STATE ───────────────────────────────────────────────────────────
    return {
        gameId: Math.random().toString(36).substring(2, 10),
        phase: 'phase1',
        activePlayerId: firstToken?.playerId ?? 'player1',
        activeUnitId: firstToken?.unitId ?? p1Units[0].id,
        roundNumber: 1,
        board,
        units: Object.fromEntries(allUnits.map(u => [u.id, u])),
        timeline,
        players: {
            player1: {
                id: 'player1', name: player1Name, vp: 0,
                deployHex: p1Deploy,
                tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
                squadUnitIds: p1Units.map(u => u.id),
            },
            player2: {
                id: 'player2', name: player2Name, vp: 0,
                deployHex: p2Deploy,
                tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
                squadUnitIds: p2Units.map(u => u.id),
            },
        },
        actionLog: [],
        winner: null,
    }
}