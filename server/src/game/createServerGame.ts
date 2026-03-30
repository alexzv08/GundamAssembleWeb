import { GameState, BoardMap } from '../types'
import { createEmptyTimeline, placeInitialToken } from './timeline'
import { offsetToAxial, hexKey } from './hexGrid'
import fs from 'fs'
import path from 'path'

// Tipos del JSON
interface MapCell { terrain: string; elevation: number }
interface MapJSON { cols: number; rows: number; grid: MapCell[][] }
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

export function createServerGame(player1Name: string, player2Name: string): GameState {
    const dataDir = path.join(__dirname, '../../data')
    const mapData = loadJSON<MapJSON>(path.join(dataDir, 'maps/DemoMap.json'))
    const unitData = loadJSON<UnitsJSON>(path.join(dataDir, 'units/unit_library.json'))

    // Construir tablero
    const board: BoardMap = {}
    for (let row = 0; row < mapData.rows; row++) {
        for (let col = 0; col < mapData.cols; col++) {
            const cell = mapData.grid[row][col]
            const coord = offsetToAxial(col, row)
            const key = hexKey(coord)
            const elevation = cell.elevation - 1

            board[key] = {
                coord, elevation,
                terrain: elevation >= 3 ? 'elevation_3'
                    : elevation >= 2 ? 'elevation_2'
                        : elevation >= 1 ? 'elevation_1'
                            : cell.terrain === 'water' ? 'water' : 'normal',
                occupiedBy: null, upgradeToken: null,
                garrisonToken: null, objectiveToken: null,
            }
        }
    }

    // Posiciones de inicio
    const fedPositions = [offsetToAxial(0, 6), offsetToAxial(0, 7), offsetToAxial(0, 8)]
    const zeonPositions = [offsetToAxial(13, 6), offsetToAxial(13, 7), offsetToAxial(13, 8)]

    const fedCards = unitData.cards.filter(c => c.faction === 'Earth Federation').slice(0, 3)
    const zeonCards = unitData.cards.filter(c => c.faction === 'Zeon').slice(0, 3)

    const createUnit = (card: UnitJSON, playerId: 'player1' | 'player2', pos: { q: number; r: number }) => ({
        id: `${card.cardId}_${playerId}`,
        name: card.unitName,
        unitType: 'Mobile Suit',
        traits: [card.faction, ...(card.pilot === 'Mass Produced' ? ['Mass Produced'] : [])],
        maxHp: parseInt(card.hp),
        vp: parseInt(card.vp),
        startingTl: parseInt(card.tl),
        currentHp: parseInt(card.hp),
        energy: 0,
        position: pos,
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
        statusEffects: [], upgrades: [],
        playerId, activated: false,
    })

    const p1Units = fedCards.map((c, i) => createUnit(c, 'player1', fedPositions[i]))
    const p2Units = zeonCards.map((c, i) => createUnit(c, 'player2', zeonPositions[i]))
    const allUnits = [...p1Units, ...p2Units]

    allUnits.forEach(u => {
        if (u.position) board[hexKey(u.position)].occupiedBy = u.id
    })

    let timeline = createEmptyTimeline()
    allUnits.forEach(u => {
        timeline = placeInitialToken(timeline, { unitId: u.id, playerId: u.playerId }, u.startingTl)
    })

    const firstToken = timeline.slots.find(s => s.tokens.length > 0)?.tokens[0]

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
                tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
                squadUnitIds: p1Units.map(u => u.id)
            },
            player2: {
                id: 'player2', name: player2Name, vp: 0,
                tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
                squadUnitIds: p2Units.map(u => u.id)
            },
        },
        actionLog: [], winner: null,
    }
}