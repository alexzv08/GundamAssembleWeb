import type { Unit } from './units'
import type { BoardMap } from './board'
import type { Timeline } from './timeline'
import type { TacticsState, PendingResponse } from './tactics'
import type { HexCoord } from './units'

export type PlayerId = 'player1' | 'player2'
export type GamePhase = 'setup' | 'phase1' | 'phase2' | 'finished'

export type LogCategory = 'move' | 'attack' | 'ability' | 'card' | 'objective' | 'end'

export interface LogEntry {
  message: string
  playerId: PlayerId
  round: number | null
  category: LogCategory
  hexes: string[]
}

export interface GameState {
  gameId: string
  phase: GamePhase
  activePlayerId: PlayerId
  activeUnitId: string | null
  lastActivePlayer: PlayerId | null
  roundNumber: number
  hasUsedPrimaryAction: boolean
  board: BoardMap
  units: Record<string, Unit>
  timeline: Timeline
  players: {
    player1: PlayerState
    player2: PlayerState
  }
  actionLog: GameAction[]
  log: LogEntry[]
  winner: PlayerId | null
  pendingResponse: PendingResponse | null
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
  | { type: 'ATTACK_GARRISON'; unitId: string; weaponIndex: number; garrisonId: string }
  | { type: 'PLAY_CARD'; unitId: string; cardId: string; targetId?: string }
  | { type: 'USE_ABILITY'; unitId: string; abilityIndex: number; targetId?: string }
  | { type: 'END_ACTIVATION'; unitId: string }
  | { type: 'PLAY_RESPONSE'; cardId: string; targetId?: string }
  | { type: 'PASS_RESPONSE' }
