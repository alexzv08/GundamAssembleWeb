import { Unit } from './units'
import { BoardMap } from './board'
import { Timeline } from './timeline'
import { TacticsState } from './tactics'

export type PlayerId = 'player1' | 'player2'
export type GamePhase = 'setup' | 'phase1' | 'phase2' | 'finished'

// El estado completo de una partida en un momento dado
// Todo lo que necesitas para renderizar y validar cualquier acción
export interface GameState {
  // Identificadores
    gameId: string
    phase: GamePhase
    
    // Turno actual
    activePlayerId: PlayerId
    activeUnitId: string | null   // qué unidad está activando ahora
    roundNumber: number           // 1-10 dentro de la fase
    
    // Tablero
    board: BoardMap
    
    // Unidades (todas juntas, filtrar por playerId cuando haga falta)
    units: Record<string, Unit>   // unitId → Unit
    
    // Timeline
    timeline: Timeline

  // Jugadores
    players: {
        player1: PlayerState
        player2: PlayerState
    }
  
  // Historial de acciones (para el replay)
    actionLog: GameAction[]
  
  // Si la partida terminó
    winner: PlayerId | null
}

export interface PlayerState {
    id: PlayerId
    name: string
    vp: number
    tactics: TacticsState
    squadUnitIds: string[]   // ids de sus unidades
}

// Todas las acciones posibles que un jugador puede enviar
export type GameAction =
    | { type: 'ADVANCE';   unitId: string; to: import('./units').HexCoord }
    | { type: 'ATTACK';    unitId: string; weaponIndex: number; targetId: string }
    | { type: 'DASH';      unitId: string; to: import('./units').HexCoord }
    | { type: 'ENERGIZE';  unitId: string }
    | { type: 'RESCUE';    unitId: string; garrisonId: string }
    | { type: 'PLAY_CARD'; unitId: string; cardId: string }
    | { type: 'USE_ABILITY'; unitId: string; abilityIndex: number; targetId?: string }
    | { type: 'END_ACTIVATION'; unitId: string }