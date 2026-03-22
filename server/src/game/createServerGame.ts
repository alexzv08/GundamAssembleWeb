import { GameState, BoardMap, Unit } from '../types'
import { createEmptyTimeline, placeInitialToken } from './timeline'
import { offsetToAxial, hexKey } from './hexGrid'

export function createServerGame(player1Name: string, player2Name: string): GameState {
    const board: BoardMap = {}
    const cols = 14
    const rows = 15

    for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
            const coord = offsetToAxial(col, row)
            const key = hexKey(coord)

            let terrain: 'normal' | 'water' | 'elevation_1' | 'elevation_2' = 'normal'
            let elevation = 0

            if (col === 3 && row === 3) { terrain = 'water'; elevation = 0 }
            if (col === 4 && row === 4) { terrain = 'water'; elevation = 0 }
            if (col === 3 && row === 4) { terrain = 'water'; elevation = 0 }
            if (col === 10 && row === 5) { elevation = 1; terrain = 'elevation_1' }
            if (col === 10 && row === 6) { elevation = 2; terrain = 'elevation_2' }
            if (col === 11 && row === 6) { elevation = 1; terrain = 'elevation_1' }

            board[key] = {
                coord, terrain, elevation,
                occupiedBy: null, upgradeToken: null,
                garrisonToken: null,
                objectiveToken: (col === 7 && row === 7)
                    ? { id: 'obj_center', vpValue: 3, controlledBy: null }
                    : null,
            }
        }
    }

    const p1Coord = offsetToAxial(0, 0)
    const p2Coord = offsetToAxial(13, 14)

    board[hexKey(p1Coord)].occupiedBy = 'rx78'
    board[hexKey(p2Coord)].occupiedBy = 'zaku2'

    const rx78: Unit = {
        id: 'rx78', name: 'RX-78-2 Gundam', unitType: 'Mobile Suit',
        traits: ['Federation', 'Prototype'],
        maxHp: 5, vp: 4, startingTl: 2, currentHp: 5, energy: 0,
        position: p1Coord,
        weapons: [
            { name: 'Beam Rifle', range: 3, strength: 3, tlCost: 2 },
            { name: 'Beam Saber', range: 1, strength: 4, tlCost: 1 },
        ],
        abilities: [], statusEffects: [], upgrades: [],
        playerId: 'player1', activated: false,
    }

    const zaku2: Unit = {
        id: 'zaku2', name: "Char's Zaku II", unitType: 'Mobile Suit',
        traits: ['Zeon', 'Ace'],
        maxHp: 4, vp: 3, startingTl: 3, currentHp: 4, energy: 0,
        position: p2Coord,
        weapons: [
            { name: 'Zaku Machine Gun', range: 2, strength: 4, tlCost: 2 },
            { name: 'Heat Hawk', range: 1, strength: 3, tlCost: 1 },
        ],
        abilities: [], statusEffects: [], upgrades: [],
        playerId: 'player2', activated: false,
    }

    let timeline = createEmptyTimeline()
    timeline = placeInitialToken(timeline, { unitId: 'rx78', playerId: 'player1' }, 2)
    timeline = placeInitialToken(timeline, { unitId: 'zaku2', playerId: 'player2' }, 3)

    return {
        gameId: Math.random().toString(36).substring(2, 10),
        phase: 'phase1',
        activePlayerId: 'player1',
        activeUnitId: 'rx78',
        roundNumber: 1,
        board, units: { rx78, zaku2 }, timeline,
        players: {
            player1: {
                id: 'player1', name: player1Name, vp: 0,
                tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
                squadUnitIds: ['rx78']
            },
            player2: {
                id: 'player2', name: player2Name, vp: 0,
                tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
                squadUnitIds: ['zaku2']
            },
        },
        actionLog: [], winner: null,
    }
}