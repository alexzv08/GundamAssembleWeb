import type { Weapon } from './units'

// ─── CARD EFFECTS ─────────────────────────────────────────────────────────────

export type ResponseTrigger =
    | 'before_attack_roll' | 'after_attack_roll'   // durante un ataque (atacante o defensor)
    | 'after_combat_damage' | 'after_rescue' | 'after_enemy_advance'

export interface CardEffect {
    type: 'heal_per_upgrade' | 'destroy_upgrade_and_slow' | 'destroy_upgrade_and_fracture' |
          'aoe_damage' | 'gain_shield_and_capture_objective' | 'move_and_push' |
          'reduce_incoming_damage' | 'counter_attack' | 'gain_upgrade_after_rescue' |
          'retaliate_damage' | 'damage_on_adjacent_enemy' |
          // ── Command oficiales ──
          'gain_upgrade' | 'status_adjacent' | 'repair' | 'energy_if_rescued' | 'push_adjacent' |
          'free_attack' | 'damage_per_own_upgrade' | 'aoe_status' | 'activation_move_buff' |
          'move' | 'move_and_rescue' | 'steal_upgrade' |
          // ── Response durante un ataque ──
          'attack_bonus' | 'reduce_damage' | 'set_crit' | 'reroll_misses' |
          // ── Response tras el daño ──
          'self_and_targets_damage' | 'gain_energy' |
          // ── Command (lista oficial) ──
          'destroy_upgrades' | 'strength_if_garrisons_defeated' | 'free_dash_and_attack'
    range?: number
    amount?: number
    upgradeType?: string
    trigger?: ResponseTrigger
    side?: 'attacker' | 'defender'      // quién puede jugar la Response durante un ataque
    status?: 'slow' | 'fracture' | 'disarm'
    strength?: number
    accuracy?: number
    damage?: number
    weapon?: string                     // arma del ataque adicional
    threshold?: number
    requiresActiveTrait?: string        // la unidad activa / defensora debe tener este rasgo
    gainShield?: boolean
    destroyAttackerUpgrade?: boolean
    destroyTargetUpgrades?: boolean
    ifLowerVp?: boolean
    hover?: boolean
    energyIfFull?: number
    drawIfAtLeast?: number
    requiresAllyWithin?: number         // el atacante necesita otro aliado a esta distancia
    thenStatus?: 'slow' | 'fracture' | 'disarm'   // tras moverse, estado a enemigos a `thenRange`
    thenRange?: number
}

// ─── TACTICS CARD ─────────────────────────────────────────────────────────────

// Tipos oficiales: Attack (sustituye al ataque primario), Command (durante tu
// activación) y Response (cuando se cumple su condición, en cualquier turno).
// faction = rasgo requerido para incluirla en el mazo ('' = sin requisito).
// signature = título de firma de la unidad que puede jugarla.
export interface TacticsCard {
    id: string
    name: string
    type: 'command' | 'response' | 'attack'
    faction: string
    signature?: string
    tlCost?: number
    effect: string
    effectData?: CardEffect | null
    weapon?: Weapon                     // cartas Attack: el arma con la que se ataca
    source?: string                     // de dónde salen los datos (web oficial, wiki…)
}

// ─── PENDING RESPONSE ─────────────────────────────────────────────────────────

export interface PendingResponse {
    trigger: ResponseTrigger
    forPlayerId: 'player1' | 'player2'
    side?: 'attacker' | 'defender'
    attackerUnitId?: string
    defenderUnitId?: string
    rescuerUnitId?: string
    movedUnitId?: string
}

// ─── TACTICS STATE ────────────────────────────────────────────────────────────

export interface TacticsState {
    deck: TacticsCard[]
    hand: TacticsCard[]
    discarded: TacticsCard[]
    usedResponseThisTurn: boolean
}

// ─── ATAQUE EN CURSO ──────────────────────────────────────────────────────────
// Un ataque se pausa en las ventanas "Before Attack Roll" y "After Attack Roll"
// si algún jugador puede responder, y se reanuda cuando todos pasan o responden.
export interface PendingAttack {
    attackerId: string
    weapon: Weapon
    primaryKey: string
    targetKeys: string[]
    stage: 'before_roll' | 'after_roll' | 'after_damage'
    isRepeat: boolean
    bonusStrength: number
    bonusAccuracy: number
    bonusDamage: number
    reductions: Record<string, number>   // unitId → daño reducido
    destroyTargetUpgrades: boolean
    rolls: number[]
    rerolled: number[]
    disarmed: boolean
    critThreshold: number
    queue: PendingResponse[]             // ventanas que faltan por abrir
    targetIds: string[]                  // unidades atacadas (para efectos tras el daño)
    damagedIds: string[]                 // unidades que recibieron daño
}
