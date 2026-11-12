// Construye el GameState inicial a partir del mapa, la escuadra y el mazo de
// cada jugador (Core Rulebook v1.2, "Setup").
import type { GameState, BoardMap, TerrainType, PlayerId, HexCoord, Unit } from '../types'
import { createEmptyTimeline, placeInitialToken, reorderSlotForTie } from './timeline'
import { offsetToAxial, hexKey, getNeighbors } from './hexGrid'
import { loadUnitCatalog, loadTacticsCatalog, buildUnit, type UnitCardJSON } from './catalog'
import { rollD10, type Rng } from './combat'
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

const UPGRADE_TYPES: ('attack' | 'movement' | 'shield')[] = ['attack', 'movement', 'shield']
const KNOWN_TERRAIN: TerrainType[] = ['water', 'debris', 'impassable', 'minovsky']

function loadJSON<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
}

function toTerrain(raw: string): TerrainType {
    return (KNOWN_TERRAIN as string[]).includes(raw) ? raw as TerrainType : 'normal'
}

function findNearestValidHex(coord: HexCoord, board: BoardMap): HexCoord {
    if (board[hexKey(coord)]) return coord
    for (const n of getNeighbors(coord)) if (board[hexKey(n)]) return n
    for (const n of getNeighbors(coord)) for (const n2 of getNeighbors(n)) if (board[hexKey(n2)]) return n2
    return coord
}

function shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

export interface CreateGameOptions {
    mapId?: string
    rng?: Rng
}

export function createServerGame(
    player1Name: string,
    player2Name: string,
    p1UnitCardIds: string[],
    p2UnitCardIds: string[],
    p1CardIds: string[] = [],
    p2CardIds: string[] = [],
    opts: CreateGameOptions = {},
): GameState {
    const rng = opts.rng ?? rollD10
    const dataDir = path.join(__dirname, '../../data')
    const mapData = loadJSON<MapJSON>(path.join(dataDir, `maps/${opts.mapId ?? 'DemoMap'}.json`))
    const unitCatalog = loadUnitCatalog()
    const tacticsCatalog = loadTacticsCatalog()

    // ─── TABLERO ──────────────────────────────────────────────────────────────
    const board: BoardMap = {}
    for (let row = 0; row < mapData.rows; row++) {
        for (let col = 0; col < mapData.cols; col++) {
            if (row % 2 === 1 && col === mapData.cols - 1) continue
            const cell = mapData.grid[row][col]
            const coord = offsetToAxial(col, row)
            board[hexKey(coord)] = {
                coord,
                elevation: cell.elevation - 1,
                terrain: toTerrain(cell.terrain),
                occupiedBy: null,
                upgradeToken: null,
                garrisonToken: null,
                objectiveToken: null,
                deployZone: null,
            }
        }
    }

    const scenario = mapData.scenario
    if (scenario) {
        scenario.objectives.forEach(obj => {
            const key = hexKey(offsetToAxial(obj.col, obj.row))
            if (board[key]) board[key].objectiveToken = { id: obj.id, vpValue: obj.vpValue, controlledBy: null }
        })
        scenario.garrisons.forEach(gar => {
            const key = hexKey(offsetToAxial(gar.col, gar.row))
            if (board[key]) board[key].garrisonToken = { id: gar.id, owner: gar.owner, hp: 1 }
        })
        scenario.upgrades.forEach(upg => {
            const key = hexKey(offsetToAxial(upg.col, upg.row))
            if (!board[key]) return
            const type = upg.type === 'random'
                ? UPGRADE_TYPES[Math.floor(Math.random() * UPGRADE_TYPES.length)]
                : upg.type
            board[key].upgradeToken = { type, value: upg.value || 1, revealed: false }
        })
    }

    // ─── BASES ────────────────────────────────────────────────────────────────
    const zones = {
        player1: scenario?.deployZones?.player1 ?? [],
        player2: scenario?.deployZones?.player2 ?? [],
    }
    const baseOf = (z: ScenarioZone | undefined, fallback: HexCoord) =>
        findNearestValidHex(z ? offsetToAxial(z.col, z.row) : fallback, board)
    const p1Base = baseOf(zones.player1[0], { q: 0, r: 7 })
    const p2Base = baseOf(zones.player2[0], { q: 12, r: 7 })
    for (const player of ['player1', 'player2'] as const) {
        for (const z of zones[player]) {
            const key = hexKey(findNearestValidHex(offsetToAxial(z.col, z.row), board))
            if (board[key]) board[key].deployZone = player
        }
    }

    // ─── UNIDADES (empiezan en la Reserva) ────────────────────────────────────
    const pick = (ids: string[], player: PlayerId): Unit[] => ids
        .map(id => unitCatalog.find(c => c.cardId === id))
        .filter((c): c is UnitCardJSON => c !== undefined)
        .map((c, i) => buildUnit(c, player, i))
    const p1Units = pick(p1UnitCardIds, 'player1')
    const p2Units = pick(p2UnitCardIds, 'player2')
    const allUnits = [...p1Units, ...p2Units]

    // ─── TIMELINE ─────────────────────────────────────────────────────────────
    let timeline = createEmptyTimeline()
    for (const u of allUnits) timeline = placeInitialToken(timeline, { unitId: u.id, playerId: u.playerId }, u.startingTl)

    // Empieza el jugador con la unidad de TL inicial más bajo. Si empatan, cada
    // uno tira un dado de ataque y empieza quien saque más.
    const minTl = (units: Unit[]) => units.length ? Math.min(...units.map(u => u.startingTl)) : 99
    const m1 = minTl(p1Units)
    const m2 = minTl(p2Units)
    let firstPlayer: PlayerId = m1 <= m2 ? 'player1' : 'player2'
    const log: GameState['log'] = []
    if (m1 === m2) {
        let r1 = 0
        let r2 = 0
        while (r1 === r2) { r1 = rng(); r2 = rng() }
        firstPlayer = r1 > r2 ? 'player1' : 'player2'
        log.push({ message: `Iniciativa: ${player1Name} saca ${r1}, ${player2Name} saca ${r2}`, playerId: firstPlayer, round: null, category: 'end', hexes: [] })
    }
    const secondPlayer: PlayerId = firstPlayer === 'player1' ? 'player2' : 'player1'
    // reorderSlotForTie pone primero al jugador que NO actuó el último
    timeline = reorderSlotForTie(timeline, Math.min(m1, m2), secondPlayer)
    const firstSlot = timeline.slots.find(s => s.tokens.length > 0)
    const firstToken = firstSlot?.tokens[0]

    // ─── MAZOS ────────────────────────────────────────────────────────────────
    const deckFor = (ids: string[]) => shuffleArray(tacticsCatalog.filter(c => ids.includes(c.id)))
    const p1Deck = deckFor(p1CardIds)
    const p2Deck = deckFor(p2CardIds)
    const p1Hand = p1Deck.splice(0, 3)
    const p2Hand = p2Deck.splice(0, 3)

    return {
        gameId: Math.random().toString(36).substring(2, 10),
        phase: 'setup',
        hasUsedPrimaryAction: false,
        activation: null,
        activePlayerId: firstToken?.playerId ?? firstPlayer,
        activeUnitId: firstToken?.unitId ?? null,
        lastActivePlayer: secondPlayer,
        roundNumber: firstSlot?.round ?? 1,
        board,
        units: Object.fromEntries(allUnits.map(u => [u.id, u])),
        timeline,
        players: {
            player1: {
                id: 'player1', name: player1Name, vp: 0, deployHex: p1Base, garrisonsRescued: 0,
                tactics: { deck: p1Deck, hand: p1Hand, discarded: [], usedResponseThisTurn: false },
                squadUnitIds: p1Units.map(u => u.id),
            },
            player2: {
                id: 'player2', name: player2Name, vp: 0, deployHex: p2Base, garrisonsRescued: 0,
                tactics: { deck: p2Deck, hand: p2Hand, discarded: [], usedResponseThisTurn: false },
                squadUnitIds: p2Units.map(u => u.id),
            },
        },
        actionLog: [],
        log,
        lastAttack: null,
        winner: null,
        pendingResponse: null,
    }
}
