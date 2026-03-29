import { Unit } from '../types'
import { HexCoord } from '../types'

// ─── DEFINICIONES DE UNIDADES ─────────────────────────────────────────────────
// Estas son las unidades base — se clonan al crear una partida

export interface UnitDefinition {
    id: string
    name: string
    pilot: string
    faction: 'Earth Federation' | 'Zeon'
    unitType: string
    traits: string[]
    maxHp: number
    vp: number
    startingTl: number
    weapons: {
        name: string
        range: number
        strength: number
        tlCost: number
        critEffect?: string
        specialRule?: string
        energyCost?: number
    }[]
    abilities: {
        name: string
        type: 'CMD' | 'ONG' | 'RSP'
        description: string
        energyCost?: boolean
    }[]
    cardId: string
}

export const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {

    // ── EARTH FEDERATION ──────────────────────────────────────────────────────

    gundam: {
        id: 'gundam',
        name: 'Gundam',
        pilot: 'Amuro Ray',
        faction: 'Earth Federation',
        unitType: 'Mobile Suit',
        traits: ['Earth Federation'],
        maxHp: 11,
        vp: 5,
        startingTl: 2,
        cardId: 'DM01-U01',
        weapons: [
            {
                name: 'Beam Saber',
                range: 1,
                strength: 2,
                tlCost: 2,
                critEffect: 'Gain a Strength Upgrade',
                specialRule: 'After Attack Roll: Destroy 1 Shield Upgrade on the target',
            },
            {
                name: 'Beam Rifle',
                range: 4,
                strength: 5,
                tlCost: 4,
                critEffect: 'Crit +2 Damage',
            },
        ],
        abilities: [
            {
                name: 'White Base Unity',
                type: 'CMD',
                description: 'If another allied unit within Range 3 has 1 or fewer Upgrades, it gains an Upgrade of your choice.',
                energyCost: true,
            },
            {
                name: 'Newtype Instincts',
                type: 'RSP',
                description: 'After Attack Roll: if this unit is attacking, it rerolls one miss.',
            },
        ],
    },

    guncannon: {
        id: 'guncannon',
        name: 'Guncannon',
        pilot: 'Kai Shiden',
        faction: 'Earth Federation',
        unitType: 'Mobile Suit',
        traits: ['Earth Federation'],
        maxHp: 10,
        vp: 4,
        startingTl: 2,
        cardId: 'DM01-U02',
        weapons: [
            {
                name: 'Beam Rifle',
                range: 3,
                strength: 2,
                tlCost: 2,
                critEffect: 'Slow the target',
            },
            {
                name: 'Shoulder Cannons',
                range: 3,
                strength: 4,
                tlCost: 3,
                critEffect: 'Dash at TL 0. Then, Rescue an adjacent allied Garrison at TL 0',
            },
        ],
        abilities: [
            {
                name: 'Critical Shot',
                type: 'CMD',
                description: 'Fracture an enemy unit within Range 3.',
                energyCost: true,
            },
            {
                name: 'Federation Courage',
                type: 'ONG',
                description: "While this unit has 2 or more Upgrades, its attacks count 7's and 8's as Crit.",
            },
        ],
    },

    guntank: {
        id: 'guntank',
        name: 'Guntank',
        pilot: 'Hayato Kobayashi',
        faction: 'Earth Federation',
        unitType: 'Mobile Suit',
        traits: ['Earth Federation'],
        maxHp: 9,
        vp: 3,
        startingTl: 3,
        cardId: 'DM01-U03',
        weapons: [
            {
                name: '4-Tube Missile Launcher',
                range: 3,
                strength: 2,
                tlCost: 2,
                critEffect: 'Fracture the target',
                specialRule: 'This attack deals +1 Damage when targeting enemies on or adjacent to an objective',
            },
            {
                name: 'Low-Recoil Cannons',
                range: 4,
                strength: 4,
                tlCost: 4,
                critEffect: 'Slow the target',
                specialRule: 'This attack ignores Line of Sight',
            },
        ],
        abilities: [
            {
                name: 'Saturated Fire',
                type: 'CMD',
                description: 'Roll 5 dice. For each Crit, deal 1 Damage to each enemy unit within Range 4.',
                energyCost: true,
            },
            {
                name: 'Targeted Shot',
                type: 'ONG',
                description: 'While this unit has 2 or more Upgrades, its attacks gain +1 Accuracy.',
            },
        ],
    },

    // ── ZEON ──────────────────────────────────────────────────────────────────

    chars_zaku_ii: {
        id: 'chars_zaku_ii',
        name: "Char's Zaku II",
        pilot: 'Char Aznable',
        faction: 'Zeon',
        unitType: 'Mobile Suit',
        traits: ['Zeon'],
        maxHp: 8,
        vp: 5,
        startingTl: 1,
        cardId: 'DM01-U04',
        weapons: [
            {
                name: 'Heat Hawk',
                range: 1,
                strength: 3,
                tlCost: 2,
                critEffect: 'Fracture the target',
            },
            {
                name: 'Machine Gun',
                range: 2,
                strength: 5,
                tlCost: 3,
                critEffect: 'Dash at TL 0',
            },
        ],
        abilities: [
            {
                name: 'Burst Attack',
                type: 'CMD',
                description: 'Make a Heat Hawk attack at TL 0.',
                energyCost: true,
            },
            {
                name: 'Three Times Faster',
                type: 'ONG',
                description: 'When this unit Dashes: It moves up to 1 additional hex.',
            },
            {
                name: 'Char Kick',
                type: 'RSP',
                description: 'After this unit Dashes: Deal 1 Damage to an adjacent enemy.',
            },
        ],
    },

    zaku_ii_line_breaker: {
        id: 'zaku_ii_line_breaker',
        name: 'Zaku II [Line Breaker]',
        pilot: '',
        faction: 'Zeon',
        unitType: 'Mobile Suit',
        traits: ['Zeon', 'Mass Produced'],
        maxHp: 9,
        vp: 4,
        startingTl: 2,
        cardId: 'DM01-U05',
        weapons: [
            {
                name: 'Cracker Grenade',
                range: 3,
                strength: 2,
                tlCost: 2,
                critEffect: '+1 Damage',
                specialRule: 'After Combat Damage: Deal 2 Damage to each enemy adjacent to the target',
            },
            {
                name: 'Bazooka',
                range: 3,
                strength: 4,
                tlCost: 3,
                critEffect: '+1 Damage for each Garrison you have Rescued',
            },
        ],
        abilities: [
            {
                name: 'Zeon Zealotry',
                type: 'CMD',
                description: 'Move 5 towards a damaged enemy unit, ignoring terrain penalties.',
                energyCost: true,
            },
            {
                name: 'Rescue the Mechanics',
                type: 'RSP',
                description: 'After this unit Rescues a Garrison: Another allied unit gains 2 hit points (cannot exceed max HP).',
            },
        ],
    },

    zaku_ii_enforcer: {
        id: 'zaku_ii_enforcer',
        name: 'Zaku II [Enforcer]',
        pilot: '',
        faction: 'Zeon',
        unitType: 'Mobile Suit',
        traits: ['Zeon', 'Mass Produced'],
        maxHp: 11,
        vp: 4,
        startingTl: 2,
        cardId: 'DM01-U06',
        weapons: [
            {
                name: 'Shoulder Bash',
                range: 1,
                strength: 3,
                tlCost: 2,
                critEffect: 'Push 2 the target',
            },
            {
                name: 'Heat Hawk',
                range: 1,
                strength: 5,
                tlCost: 4,
                critEffect: 'Slow the target',
                specialRule: 'After Attack Roll: Destroy 1 Upgrade on the target',
            },
        ],
        abilities: [
            {
                name: 'Domination',
                type: 'CMD',
                description: 'Capture an objective this unit is on or adjacent to.',
                energyCost: true,
            },
            {
                name: 'Suppressing Presence',
                type: 'ONG',
                description: 'This unit gains +1 Strength when attacking damaged enemy units.',
            },
        ],
    },
}

// ─── CREAR UNIDAD DESDE DEFINICIÓN ────────────────────────────────────────────
export function createUnit(
    defId: string,
    playerId: 'player1' | 'player2',
    position: HexCoord,
    instanceId?: string
): Unit {
    const def = UNIT_DEFINITIONS[defId]
    if (!def) throw new Error(`Unidad no encontrada: ${defId}`)

    return {
        id: instanceId ?? `${defId}_${playerId}`,
        name: def.name,
        unitType: def.unitType,
        traits: def.traits,
        maxHp: def.maxHp,
        vp: def.vp,
        startingTl: def.startingTl,
        currentHp: def.maxHp,
        energy: 0,
        position,
        weapons: def.weapons.map(w => ({
            name: w.name,
            range: w.range,
            strength: w.strength,
            tlCost: w.tlCost,
            critEffect: w.critEffect,
            energyCost: w.energyCost,
        })),
        abilities: def.abilities.map(a => ({
            name: a.name,
            type: a.type,
            description: a.description,
            energyCost: a.energyCost ? 1 : undefined,
        })),
        statusEffects: [],
        upgrades: [],
        playerId,
        activated: false,
    }
}

// ─── SQUADS PREDEFINIDOS ──────────────────────────────────────────────────────
export const SQUADS = {
    federation: ['gundam', 'guncannon', 'guntank'],
    zeon: ['chars_zaku_ii', 'zaku_ii_line_breaker', 'zaku_ii_enforcer'],
}