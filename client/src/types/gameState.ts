import type { Unit } from './units'
import type { BoardMap } from './board'
import type { Timeline } from './timeline'
import type { TacticsState } from './tactics'
import type { HexCoord } from './units'

export type PlayerId = 'player1' | 'player2'
export type GamePhase = 'setup' | 'phase1' | 'phase2' | 'finished'

export interface GameState {
  gameId: string
  phase: GamePhase
  activePlayerId: PlayerId
  activeUnitId: string | null
  roundNumber: number
  board: BoardMap
  units: Record<string, Unit>
  timeline: Timeline
  players: {
    player1: PlayerState
    player2: PlayerState
  }
  actionLog: GameAction[]
  winner: PlayerId | null
}

export interface PlayerState {
  id: PlayerId
  name: string
  vp: number
  tactics: TacticsState
  squadUnitIds: string[]
  deployHex: HexCoord | null
}

export type GameAction =
  | { type: 'ADVANCE'; unitId: string; to: HexCoord }
  | { type: 'ATTACK'; unitId: string; weaponIndex: number; targetId: string }
  | { type: 'DASH'; unitId: string; to: HexCoord }
  | { type: 'ENERGIZE'; unitId: string }
  | { type: 'RESCUE'; unitId: string; garrisonId: string }
  | { type: 'PLAY_CARD'; unitId: string; cardId: string }
  | { type: 'USE_ABILITY'; unitId: string; abilityIndex: number; targetId?: string }
  | { type: 'END_ACTIVATION'; unitId: string }