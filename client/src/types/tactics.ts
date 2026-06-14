// ─── CARD EFFECTS ─────────────────────────────────────────────────────────────

export type ResponseTrigger = 'after_combat_damage' | 'after_rescue' | 'after_enemy_advance'

export interface CardEffect {
    type: 'heal_per_upgrade' | 'destroy_upgrade_and_slow' | 'destroy_upgrade_and_fracture' |
          'aoe_damage' | 'gain_shield_and_capture_objective' | 'move_and_push' |
          'reduce_incoming_damage' | 'counter_attack' | 'gain_upgrade_after_rescue' |
          'retaliate_damage' | 'damage_on_adjacent_enemy'
    range?: number
    amount?: number
    upgradeType?: string
    trigger?: ResponseTrigger
}

// ─── TACTICS CARD ─────────────────────────────────────────────────────────────

export interface TacticsCard {
    id: string
    name: string
    type: 'command' | 'response'
    faction: string
    effect: string
    effectData?: CardEffect | null
}

// ─── PENDING RESPONSE ─────────────────────────────────────────────────────────

export interface PendingResponse {
    trigger: ResponseTrigger
    forPlayerId: 'player1' | 'player2'
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
