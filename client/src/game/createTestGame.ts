import { GameState, BoardMap } from '../types'
import { createEmptyTimeline, placeInitialToken } from './timeline'
import { offsetToAxial, hexKey } from './hexGrid'
import { createUnit, SQUADS } from './units'

export function createTestGame(): GameState {
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
        occupiedBy: null, upgradeToken: null, garrisonToken: null,
        objectiveToken: (col === 7 && row === 7)
          ? { id: 'obj_center', vpValue: 3, controlledBy: null }
          : null,
      }
    }
  }

  // Posiciones de inicio — federación izquierda, zeon derecha
  const fedPositions = [
    offsetToAxial(0, 6),
    offsetToAxial(0, 7),
    offsetToAxial(0, 8),
  ]
  const zeonPositions = [
    offsetToAxial(13, 6),
    offsetToAxial(13, 7),
    offsetToAxial(13, 8),
  ]

  // Crear unidades
  const p1Units = SQUADS.federation.map((defId, i) =>
    createUnit(defId, 'player1', fedPositions[i])
  )
  const p2Units = SQUADS.zeon.map((defId, i) =>
    createUnit(defId, 'player2', zeonPositions[i])
  )
  const allUnits = [...p1Units, ...p2Units]

  // Colocar en tablero
  allUnits.forEach(u => {
    if (u.position) board[hexKey(u.position)].occupiedBy = u.id
  })

  // Timeline
  let timeline = createEmptyTimeline()
  allUnits.forEach(u => {
    timeline = placeInitialToken(timeline, { unitId: u.id, playerId: u.playerId }, u.startingTl)
  })

  // Primera unidad activa
  const firstToken = timeline.slots.find(s => s.tokens.length > 0)?.tokens[0]

  return {
    gameId: 'test-game',
    phase: 'phase1',
    activePlayerId: firstToken?.playerId ?? 'player1',
    activeUnitId: firstToken?.unitId ?? p1Units[0].id,
    roundNumber: 1,
    board,
    units: Object.fromEntries(allUnits.map(u => [u.id, u])),
    timeline,
    players: {
      player1: {
        id: 'player1', name: 'Earth Federation', vp: 0,
        tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
        squadUnitIds: p1Units.map(u => u.id),
      },
      player2: {
        id: 'player2', name: 'Principality of Zeon', vp: 0,
        tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
        squadUnitIds: p2Units.map(u => u.id),
      },
    },
    actionLog: [],
    winner: null,
  }
}