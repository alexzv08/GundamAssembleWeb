// Catálogo de unidades y cartas (server/data) y reglas de construcción de
// escuadra y mazo (Core Rulebook v1.2, "Squad and Deck Building").
import fs from 'fs'
import path from 'path'
import type { Unit, Weapon, Ability, PlayerId, TacticsCard } from '../types'

export interface UnitCardJSON {
    cardId: string
    set: string
    name: string
    /** Nombre corto para la Timeline y las etiquetas del tablero */
    shortName?: string
    model?: string
    signature?: string
    traits: string[]
    hp: number
    vp: number
    tl: number
    provisionalStats?: boolean
    weapons: (Omit<Weapon, 'effect' | 'critEffect'> & { effect: string; crit: string })[]
    abilities: { name: string; effect: string; type: Ability['type']; energyCost?: number; tlCost?: number; abilityData?: Ability['abilityData'] }[]
}

interface TacticsCardJSON {
    cardId: string; name: string; type: string; faction: string; signature?: string; tlCost?: number
    effect: string; effectData?: TacticsCard['effectData']; weapon?: Weapon; source?: string
}

const DATA_DIR = path.join(__dirname, '../../data')

export function loadUnitCatalog(): UnitCardJSON[] {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'units/unit_library.json'), 'utf-8')).cards
}

export function loadTacticsCatalog(): TacticsCard[] {
    const raw: TacticsCardJSON[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cards/card_library.json'), 'utf-8')).cards
    return raw.map(c => ({
        id: c.cardId,
        name: c.name,
        type: (['command', 'response', 'attack'].includes(c.type) ? c.type : 'command') as TacticsCard['type'],
        faction: c.faction ?? '',
        signature: c.signature,
        tlCost: c.tlCost,
        effect: c.effect,
        effectData: c.effectData ?? null,
        weapon: c.weapon,
        source: c.source,
    }))
}

export function buildUnit(card: UnitCardJSON, playerId: PlayerId, instance: number): Unit {
    return {
        id: `${card.cardId}_${playerId}_${instance}`,
        cardId: card.cardId,
        name: card.name,
        shortName: card.shortName,
        signature: card.signature,
        unitType: 'Mobile Suit',
        traits: card.traits,
        maxHp: card.hp,
        vp: card.vp,
        startingTl: card.tl,
        currentHp: card.hp,
        energy: 0,
        position: null,
        weapons: card.weapons.map(w => ({
            name: w.name, range: w.range, strength: w.strength, tlCost: w.tlCost,
            effect: w.effect || undefined, critEffect: w.crit || undefined,
            effectData: w.effectData ?? null, critData: w.critData ?? null, energyCost: w.energyCost,
        })),
        abilities: card.abilities.map(a => ({
            name: a.name, type: a.type, description: a.effect,
            energyCost: a.energyCost, tlCost: a.tlCost, abilityData: a.abilityData ?? null,
        })),
        statusEffects: [],
        upgrades: [],
        playerId,
        activated: false,
        provisionalStats: card.provisionalStats,
    }
}

export { validateSquad, validateDeck, eligibleCards, requiredDeckSize, DECK_SIZE } from './deckRules'
