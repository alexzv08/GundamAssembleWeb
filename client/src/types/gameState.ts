// AUTO-GENERADO por scripts/sync-shared.mjs desde server/src — NO EDITAR AQUÍ.
import type { Unit, HexCoord, RemoteWeapon } from './units'
import type { BoardMap } from './board'
import type { Timeline } from './timeline'
import type { TacticsState, PendingResponse, PendingAttack } from './tactics'

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

// Estado de la activación en curso (se reinicia al activar cada unidad).
export interface ActivationState {
  unitId: string
  advanced: boolean          // ya hizo su Advance (solo uno por activación)
  moved: boolean             // se ha movido por cualquier medio (Firing Line)
  usedCommands: number[]     // índices de habilidades Command ya usadas (1 vez cada una)
  cardPlayed: boolean        // máx. 1 carta de Tactics por activación
  freeDashes: number         // Dash adicionales a TL 0 (Zaku Bazooka)
  freeAttacks: number[]      // ataques adicionales a TL 0 (índice de arma)
  attacksMade: number[]      // índices de armas con las que ya atacó esta activación
  strengthBonus: number      // bonos temporales de Command (Full Power, etc.)
  weaponStrengthBonus: Record<string, number>  // bono por nombre de arma (Frenzied Charge)
  accuracyBonus: number
  destroyUpgradeOnHit: boolean
  speedBonus: number         // Full System Burn
  hover: boolean             // Hover solo esta activación
  damageBonus: number        // daño extra en los ataques de esta activación
  deployed: boolean          // la unidad se desplegó al empezar esta activación
}

// Resumen del último ataque, para mostrar los dados en la UI
export interface AttackReport {
  attackerId: string
  weaponName: string
  rolls: number[]
  rerolled: number[]
  targets: { id: string; kind: 'unit' | 'garrison' | 'rws'; hits: number; crits: number; damage: number; defeated: boolean }[]
}

export interface GameState {
  gameId: string
  phase: GamePhase
  activePlayerId: PlayerId
  activeUnitId: string | null
  lastActivePlayer: PlayerId | null
  roundNumber: number
  hasUsedPrimaryAction: boolean
  activation: ActivationState | null
  board: BoardMap
  units: Record<string, Unit>
  rws: Record<string, RemoteWeapon>
  timeline: Timeline
  players: {
    player1: PlayerState
    player2: PlayerState
  }
  actionLog: GameAction[]
  log: LogEntry[]
  lastAttack: AttackReport | null
  winner: PlayerId | null
  winReason?: string
  pendingResponse: PendingResponse | null
  pendingAttack: PendingAttack | null
  /** Push / Pull esperando a que el jugador elija el siguiente hex (ver engine.ts) */
  pendingForcedMove?: PendingForcedMove | null
  /** Acción que una unidad hace fuera de turno al acabar el ataque en curso (Iron-Blooded Tenacity) */
  pendingFollowUp?: PendingFollowUp | null
  /** Reloj del jugador que debe actuar (lo pone el servidor de salas, no el motor) */
  turnClock?: TurnClock | null
}

export interface PendingFollowUp {
  unitId: string
  playerId: PlayerId
  /** Hexes que puede moverse ("Moves 2") y arma del ataque a Timeline 0 */
  move: number
  weaponName: string
  source: string
}

/** Previsión de un ataque antes de confirmarlo (la calcula el servidor con las mismas reglas) */
export interface AttackPreview {
  dice: number
  accuracy: number
  critThreshold: number
  hitChance: number          // por dado, de 0 a 1
  expectedHits: number
  critChance: number         // probabilidad de al menos un crítico
  shields: number            // Shields activos del objetivo principal
  damageBonus: number
  expectedDamage: number
  killChance: number         // probabilidad de derrotar al objetivo principal (sin efectos de crítico)
  targets: number            // objetivos que alcanza el ataque (áreas, ataques a adyacentes)
}

export interface TurnClock {
  playerId: PlayerId
  kind: 'activation' | 'response' | 'choice'
  /** Duración total y tiempo que quedaba al enviar el estado */
  seconds: number
  remainingMs: number
}

/** Paso de un Push / Pull que elige el jugador que lo causa */
export interface ForcedMoveRequest {
  unitId: string
  mode: 'push' | 'pull'
  sourceKey: string
  /** Paso actual (1-based) y total de hexes del efecto */
  step: number
  total: number
  /** Hexes válidos para este paso; también se puede parar (Q&A 7) */
  options: HexCoord[]
}

export interface PendingForcedMove {
  forPlayerId: PlayerId
  /** Acción que provocó el movimiento y quién la envió: se vuelve a resolver con las elecciones */
  action: GameAction
  actorId: PlayerId
  /** Dados ya tirados en esa acción (se reutilizan al volver a resolverla) */
  rolls: number[]
  /** Elecciones por cada Push/Pull de la acción, en orden; null = parar */
  plans: (HexCoord | null)[][]
  /** Índice del Push/Pull (dentro de plans) al que corresponde la pregunta */
  planIndex: number
  request: ForcedMoveRequest
}

export interface PlayerState {
  id: PlayerId
  name: string
  vp: number
  tactics: TacticsState
  squadUnitIds: string[]
  deployHex: HexCoord | null
  garrisonsRescued: number
  garrisonsDefeated?: number
}

export type GameAction =
  | { type: 'ADVANCE'; unitId: string; to: HexCoord }
  | { type: 'ATTACK'; unitId: string; weaponIndex: number; targetId: string }
  | { type: 'DASH'; unitId: string; to: HexCoord }
  | { type: 'ENERGIZE'; unitId: string }
  | { type: 'RESCUE'; unitId: string; garrisonId: string }
  | { type: 'ATTACK_GARRISON'; unitId: string; weaponIndex: number; garrisonId: string }
  | { type: 'ATTACK_RWS'; unitId: string; weaponIndex: number; rwsId: string }
  | { type: 'PLAY_CARD'; unitId: string; cardId: string; targetId?: string; targetHex?: HexCoord; choice?: string; choices?: string[] }
  | { type: 'USE_ABILITY'; unitId: string; abilityIndex: number; targetId?: string; targetHex?: HexCoord; choice?: string; choices?: string[] }
  | { type: 'SET_AUTO_RESPONSES'; unitId: string; enabled: boolean }
  | { type: 'USE_RESPONSE_ABILITY'; unitId: string; abilityIndex: number }
  | { type: 'END_ACTIVATION'; unitId: string }
  | { type: 'PLAY_RESPONSE'; cardId: string; targetId?: string }
  | { type: 'PASS_RESPONSE' }
  | { type: 'CHOOSE_FORCED_MOVE'; to: HexCoord | null }
  | { type: 'SURRENDER' }
  | { type: 'FOLLOW_UP'; to: HexCoord | null; targetId: string | null }
