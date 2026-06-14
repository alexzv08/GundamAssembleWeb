export type TerrainType = 'normal' | 'water' | 'elevation_1' | 'elevation_2' | 'elevation_3'

export interface HexCoord {
    q: number
    r: number
}

// ─── WEAPON EFFECTS ───────────────────────────────────────────────────────────

export type WeaponEffectTrigger = 'always' | 'after_attack_roll' | 'after_combat_damage'

export interface WeaponEffect {
    trigger: WeaponEffectTrigger
    type: 'ignore_los' | 'bonus_damage' | 'bonus_damage_near_objective' |
          'destroy_upgrade' | 'slow' | 'fracture' | 'gain_upgrade' |
          'splash_damage' | 'push'
    target?: 'self' | 'target' | 'adjacent_enemies'
    amount?: number
    upgradeType?: 'shield' | 'attack' | 'movement' | 'energy' | 'any'
}

// ─── ABILITY EFFECTS ──────────────────────────────────────────────────────────

export interface AbilityEffect {
    type: 'fracture_enemy' | 'saturated_fire' | 'capture_objective'
        | 'reroll_one_miss' | 'extended_crit_threshold' | 'accuracy_bonus'
        | 'dash_range_bonus' | 'strength_vs_damaged'
        | 'damage_after_dash' | 'heal_ally_after_rescue'
    amount?: number
    range?: number
    requiredUpgrades?: number
    threshold?: number
    dice?: number
}

// ─── WEAPON ───────────────────────────────────────────────────────────────────

export interface Weapon {
    name: string
    range: number
    strength: number
    tlCost: number
    effect?: string
    critEffect?: string
    effectData?: WeaponEffect | null
    critData?: WeaponEffect | null
    energyCost?: number
}

// ─── ABILITY ──────────────────────────────────────────────────────────────────

export type AbilityType = 'CMD' | 'ONG' | 'RSP'

export interface Ability {
    name: string
    type: AbilityType
    description: string
    energyCost?: number
    abilityData?: AbilityEffect | null
}

// ─── UNIT ─────────────────────────────────────────────────────────────────────

export interface Unit {
    id: string
    name: string
    unitType: string
    traits: string[]

    maxHp: number
    vp: number
    startingTl: number

    currentHp: number
    energy: number
    position: HexCoord | null

    weapons: Weapon[]
    abilities: Ability[]

    statusEffects: StatusEffect[]
    upgrades: Upgrade[]

    playerId: 'player1' | 'player2'
    activated: boolean
}

export interface StatusEffect {
    type: 'disarm' | 'fracture' | 'slow'
}

export interface Upgrade {
    type: 'attack' | 'movement' | 'shield' | 'energy'
    value: number
}

export interface TempBuff {
    type: 'strength_bonus' | 'crit_threshold' | 'tl_cost_reduction' | 'defeat_gains_upgrade'
    value: number
    upgradeType?: 'attack' | 'movement' | 'shield'
}
