// Terreno según el Core Rulebook v1.2 ("Elevation and Special Terrain").
// La elevación va aparte (Hex.elevation); los valores elevation_N se conservan
// solo por compatibilidad con mapas antiguos y se tratan como terreno normal.
export type TerrainType =
    | 'normal' | 'water' | 'debris' | 'impassable' | 'minovsky'
    | 'elevation_1' | 'elevation_2' | 'elevation_3'

// ─── REMOTE WEAPON SYSTEMS ────────────────────────────────────────────────────
// RWS (Q&A 110): no son unidades; no bloquean LoS ni movimiento ni causan
// Engagement, pero nadie termina un movimiento en su hex. Se pueden atacar.
export type RwsKind = 'bit_stave' | 'corax' | 'isvara'

export interface RemoteWeapon {
    id: string
    kind: RwsKind
    name: string
    owner: 'player1' | 'player2'
    ownerUnitId: string
    position: HexCoord | null   // null = en la reserva de su unidad
    vp: number
}

export interface HexCoord {
    q: number
    r: number
}

// ─── WEAPON EFFECTS ───────────────────────────────────────────────────────────
// trigger:
//   always              → efecto pasivo del arma (p.ej. ignorar LoS, atacar adyacentes)
//   before_attack_roll  → se resuelve antes de tirar (p.ej. Pull)
//   after_attack_roll   → tras la tirada, antes del daño (p.ej. desactivar Shields)
//   after_combat_damage → tras el daño

export type WeaponEffectTrigger = 'always' | 'before_attack_roll' | 'after_attack_roll' | 'after_combat_damage'

export type WeaponEffectType =
    | 'ignore_los'                 // "This attack ignores Line of Sight."
    | 'also_target_adjacent'       // "This attack also targets each enemy adjacent to the target."
    | 'bonus_damage'               // [Damage +X]
    | 'bonus_damage_near_objective'
    | 'damage_per_crit'            // [Damage +1] por cada crit (max)
    | 'damage_per_upgrade'         // [Damage +1] por cada Upgrade (de un tipo o todos) (max)
    | 'strength_per_upgrade'       // [Strength +1] por cada Upgrade de un tipo
    | 'extra_dice'                 // "Roll N additional dice"
    | 'deactivate_shields'         // "Deactivate all [Shield] Upgrades on the target."
    | 'destroy_upgrade'
    | 'slow' | 'fracture' | 'disarm'
    | 'gain_upgrade'
    | 'push' | 'pull'
    | 'move_toward_target'         // "Move 1 towards the target ignoring terrain penalties."
    | 'repeat_attack'              // "Repeat this attack at [Timeline 0] without this ability."
    | 'free_dash'                  // "Make an additional Dash at [Timeline 0]."
    | 'splash_damage'              // (legado) daño a adyacentes al objetivo
    | 'strength_per_ally'          // Epic Shot: [Strength +N] por cada otro aliado a [Range R]
    | 'capture_objective_near_target'  // Claiming Vengeance
    | 'strength_per_rws_adjacent'  // Beam Rifle de Aerial: [Strength +1] por cada RWS aliada adyacente al objetivo
    | 'damage_adjacent_to_rws'     // Beam Saber de Darilbalde: daño a cada enemigo adyacente a su Iśvara

export interface WeaponEffect {
    trigger: WeaponEffectTrigger
    type: WeaponEffectType
    target?: 'self' | 'target' | 'adjacent_enemies'
    amount?: number
    max?: number
    upgradeType?: 'shield' | 'attack' | 'movement' | 'energy' | 'any'
}

// ─── ABILITY EFFECTS ──────────────────────────────────────────────────────────

export type AbilityEffectType =
    // ── Ongoing (pasivas) ──
    | 'extended_crit_threshold'    // Zero System: 7 y 8 cuentan como crit
    | 'accuracy_bonus'
    | 'strength_vs_damaged'
    | 'strength_vs_status'         // Exploit Weakness
    | 'strength_per_damage_taken'  // Fight to the End
    | 'firing_line'                // si no se ha movido: +1 Accuracy, +1 Strength
    | 'strength_per_ally_nearby'   // Coordinated Payload
    | 'dash_range_bonus'           // Three-Times Faster
    | 'hover'                      // Hover (opcionalmente condicionado a Upgrades)
    | 'reroll_one_miss'
    | 'block_enemy_responses'      // Newtype Destroyer
    // ── Response automáticas ──
    | 'push_on_attack'             // Toss Away
    | 'stun_on_damage'             // Stunning Shot: cada objetivo dañado avanza en el Timeline
    | 'draw_on_multi_damage'       // Crowd Control
    | 'damage_after_dash'          // Char Kick
    | 'damage_after_move'          // Blitzing Slash
    | 'gain_after_rescue'          // Escape from Side 7 / Supply
    | 'heal_ally_after_rescue'
    // ── Command ──
    | 'buff_activation'            // Full Power / Checkmate: Strength/Accuracy este turno
    | 'status_enemy'               // No Escape / Sundering Strike
    | 'push_and_damage'            // Hunter's Edge
    | 'move'                       // "Move N"
    | 'self_damage_move'           // Alaya-Vijnana Exertion
    | 'rescue_at_range'            // Rescue Maneuver
    | 'grant_free_attack'          // Annihilate / Burst Attack: ataque adicional a TL 0
    | 'deploy_rws'                 // BIT Stave / Corax / Iśvara B Type Direct
    // ── Response automáticas de apoyo ──
    | 'slow_near_rws'              // Lockdown
    | 'permet_burst'               // Permet Burst: un dado pasa a crit
    | 'psycho_frame'               // Psycho-Frame Synchrony
    | 'inspiring_presence'         // Inspiring Presence: repetir hasta 3 fallos
    | 'fracture_enemy' | 'saturated_fire' | 'capture_objective'  // legado

export interface AbilityEffect {
    type: AbilityEffectType
    amount?: number
    range?: number
    requiredUpgrades?: number
    upgradeType?: 'shield' | 'attack' | 'movement' | 'energy'
    threshold?: number
    dice?: number
    strength?: number
    accuracy?: number
    status?: 'slow' | 'fracture' | 'disarm'
    adjacentOnly?: boolean
    destroyUpgradeOnHit?: boolean
    weapon?: string               // arma del ataque adicional
    requiresWeapon?: string       // arma que debe haberse usado antes en la activación
    requiresObjectives?: number   // nº de Objetivos controlados necesarios
    rws?: RwsKind
    // Escalones de Fight to the End: [{ damage: 6, strength: 1 }, { damage: 12, strength: 1 }]
    steps?: { damage: number; strength: number }[]
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
    // Plantilla de área ("Range: SP"): cono o "flor" (hex elegido + sus 6 vecinos).
    // La forma exacta sale de un diagrama de la carta; aquí es una aproximación.
    area?: 'cone' | 'flower'
}

// ─── ABILITY ──────────────────────────────────────────────────────────────────

export type AbilityType = 'CMD' | 'ONG' | 'RSP' | 'SETUP'

export interface Ability {
    name: string
    type: AbilityType
    description: string
    energyCost?: number
    tlCost?: number
    abilityData?: AbilityEffect | null
}

// ─── UNIT ─────────────────────────────────────────────────────────────────────

export interface Unit {
    id: string
    cardId?: string
    name: string
    signature?: string           // título de firma (p.ej. "Legendary Hero")
    unitType: string
    traits: string[]

    maxHp: number
    vp: number
    startingTl: number

    currentHp: number
    energy: number
    position: HexCoord | null    // null = en la Reserva

    weapons: Weapon[]
    abilities: Ability[]

    statusEffects: StatusEffect[]
    upgrades: Upgrade[]

    playerId: 'player1' | 'player2'
    activated: boolean
    provisionalStats?: boolean   // stats de armas aún sin confirmar con la carta física
}

export interface StatusEffect {
    type: 'disarm' | 'fracture' | 'slow'
}

// attack = Strength Upgrade, movement = Speed Upgrade.
// Los Shield se ponen boca abajo (active=false) al usarse y se reactivan al
// inicio de la siguiente activación de la unidad.
export interface Upgrade {
    type: 'attack' | 'movement' | 'shield' | 'energy'
    value: number
    active?: boolean
}
