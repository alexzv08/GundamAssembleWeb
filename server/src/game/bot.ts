// IA sencilla para el rival automático y las partidas de prueba (self-play).
// Elige acciones legales con unas reglas simples; el motor valida todo igualmente.
import type { GameState, GameAction, PlayerId } from '../types'
import { reachableFor, attackableHexes, attackableHexesWith, targetAt, canPlayResponseCard, rwsDeployHexes } from './queries'
import { keyToHex, gridDistance } from './hexGrid'
import { loadUnitCatalog, loadTacticsCatalog, validateSquad, eligibleCards, requiredDeckSize } from './catalog'

function shuffleWith<T>(xs: T[], rand: () => number): T[] {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
    return a
}

// Escuadra legal al azar (sin las unidades de la demo).
export function randomSquad(size = 3, rand: () => number = Math.random): string[] {
    const units = loadUnitCatalog()
    const pool = units.filter(u => !u.cardId.startsWith('DM01'))
    for (;;) {
        const squad = shuffleWith(pool, rand).slice(0, size).map(u => u.cardId)
        if (validateSquad(squad, units, size) === null) return squad
    }
}

// Mazo legal al azar para esa escuadra.
export function randomDeck(squad: string[], rand: () => number = Math.random): string[] {
    const units = loadUnitCatalog()
    const tactics = loadTacticsCatalog()
    // Solo cartas oficiales (las de la demo se quedan fuera); si no llegan, se completa con la demo
    const all = eligibleCards(squad, units, tactics)
    const official = all.filter(c => c.source !== 'demo')
    const size = requiredDeckSize(squad, units, tactics)
    return [...shuffleWith(official, rand), ...shuffleWith(all.filter(c => c.source === 'demo'), rand)].slice(0, size).map(c => c.id)
}

// Acción segura si el motor rechaza la elegida.
export function botFallback(s: GameState): GameAction {
    if (followUpReady(s)) return { type: 'FOLLOW_UP', to: null, targetId: null }
    if (s.pendingForcedMove) return { type: 'CHOOSE_FORCED_MOVE', to: s.pendingForcedMove.request.options[0] ?? null }
    if (s.pendingResponse) return { type: 'PASS_RESPONSE' }
    return s.hasUsedPrimaryAction
        ? { type: 'END_ACTIVATION', unitId: s.activeUnitId! }
        : { type: 'ENERGIZE', unitId: s.activeUnitId! }
}

// Jugador que debe actuar ahora (el que responde, si hay una ventana abierta).
export function actingPlayer(s: GameState): PlayerId {
    return s.pendingForcedMove?.forPlayerId ?? s.pendingResponse?.forPlayerId
        ?? (followUpReady(s) ? s.pendingFollowUp!.playerId : null) ?? s.activePlayerId
}

// Hay un movimiento y ataque pendientes listos para resolverse (ya no hay ataque en curso)
export function followUpReady(s: GameState): boolean {
    return !!s.pendingFollowUp && !s.pendingAttack && !s.pendingResponse && !s.pendingForcedMove
}

// Bot sencillo: ataca si puede; si no, avanza hacia el enemigo más cercano y
// hace Dash o Energize; respeta "no terminar sobre la Base".
export function chooseBotAction(s: GameState, player: PlayerId, rand: () => number = Math.random): GameAction {
    const pickOne = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
    const shuffle = <T>(xs: T[]): T[] => shuffleWith(xs, rand)
    // Push / Pull: casi siempre el máximo, a veces para antes
    const pf = s.pendingForcedMove
    if (pf) {
        if (pf.forPlayerId !== player) return { type: 'PASS_RESPONSE' }
        return { type: 'CHOOSE_FORCED_MOVE', to: rand() < 0.1 ? null : pickOne(pf.request.options) }
    }
    // Iron-Blooded Tenacity: quedarse donde está y atacar si tiene a quién
    if (followUpReady(s)) {
        const fu = s.pendingFollowUp!
        const unit = s.units[fu.unitId]
        const weapon = unit?.weapons.find(w => w.name === fu.weaponName)
        const hexes = unit?.position && weapon ? attackableHexesWith(s, unit.id, weapon) : []
        const target = hexes.map(k => targetAt(s, k, player)).find(t => t?.kind === 'unit')
        return { type: 'FOLLOW_UP', to: null, targetId: target?.id ?? null }
    }
    if (s.pendingResponse?.forPlayerId === player) {
        const card = s.players[player].tactics.hand.find(c => canPlayResponseCard(s, player, c))
        return card && rand() < 0.7 ? { type: 'PLAY_RESPONSE', cardId: card.id } : { type: 'PASS_RESPONSE' }
    }
    const id = s.activeUnitId!
    const unit = s.units[id]
    const act = s.activation!

    if (!s.hasUsedPrimaryAction || act.freeAttacks.length > 0) {
        const weaponOrder = shuffle(unit.weapons.map((_, i) => i))
        for (const wi of weaponOrder) {
            if (s.hasUsedPrimaryAction && !act.freeAttacks.includes(wi)) continue
            const targets = attackableHexes(s, id, wi)
            if (targets.length === 0) continue
            const t = targetAt(s, pickOne(targets), player)!
            return t.kind === 'unit'
                ? { type: 'ATTACK', unitId: id, weaponIndex: wi, targetId: t.id }
                : t.kind === 'rws'
                    ? { type: 'ATTACK_RWS', unitId: id, weaponIndex: wi, rwsId: t.id }
                    : { type: 'ATTACK_GARRISON', unitId: id, weaponIndex: wi, garrisonId: t.id }
        }
    }

    // Cartas: Attack si aún no atacó, o Command que no necesitan objetivo
    if (!act.cardPlayed && rand() < 0.35) {
        const hand = s.players[player].tactics.hand.filter(c => !c.signature || c.signature === unit.signature)
        const atk = !s.hasUsedPrimaryAction && hand.find(c => c.type === 'attack' && c.weapon && attackableHexesWith(s, id, c.weapon).length)
        if (atk && atk.weapon) {
            const t = targetAt(s, pickOne(attackableHexesWith(s, id, atk.weapon)), player)!
            return { type: 'PLAY_CARD', unitId: id, cardId: atk.id, targetId: t.id }
        }
        const simple = new Set(['gain_upgrade', 'repair', 'activation_move_buff', 'aoe_status', 'free_attack', 'heal_per_upgrade', 'energy_if_rescued', 'rws_damage', 'rws_timeline_push', 'free_dash_and_attack', 'strength_if_garrisons_defeated'])
        const cmdCard = hand.find(c => c.type === 'command' && c.effectData && simple.has(c.effectData.type))
        if (cmdCard) return { type: 'PLAY_CARD', unitId: id, cardId: cmdCard.id }
    }

    // Desplegar RWS
    const dep = unit.abilities.findIndex((a, i) => a.abilityData?.type === 'deploy_rws' && !act.usedCommands.includes(i) && unit.energy >= (a.energyCost ?? 0))
    if (dep !== -1 && rand() < 0.5) {
        const hexes = rwsDeployHexes(s, id, unit.abilities[dep].abilityData!.range ?? 3)
        if (hexes.length) return { type: 'USE_ABILITY', unitId: id, abilityIndex: dep, targetHex: keyToHex(pickOne(hexes)) }
    }

    const cmd = unit.abilities.findIndex((a, i) => a.type === 'CMD' && a.abilityData?.type === 'buff_activation' &&
        !act.usedCommands.includes(i) && unit.energy >= (a.energyCost ?? 0))
    if (cmd !== -1 && rand() < 0.5) return { type: 'USE_ABILITY', unitId: id, abilityIndex: cmd }

    if (!act.advanced && unit.position) {
        const reach = [...reachableFor(s, id, { kind: 'advance' }).keys()]
        if (reach.length) {
            const enemies = Object.values(s.units).filter(u => u.playerId !== player && u.position)
            const score = (k: string) => enemies.length ? Math.min(...enemies.map(e => gridDistance(keyToHex(k), e.position!))) : 0
            reach.sort((a, b) => score(a) - score(b))
            return { type: 'ADVANCE', unitId: id, to: keyToHex(rand() < 0.8 ? reach[0] : pickOne(reach)) }
        }
    }

    if (!s.hasUsedPrimaryAction) {
        const rescue = unit.position && Object.values(s.board).find(h => h.garrisonToken?.owner === player && gridDistance(h.coord, unit.position!) === 1)
        if (rescue) return { type: 'RESCUE', unitId: id, garrisonId: rescue.garrisonToken!.id }
        const dash = [...reachableFor(s, id, { kind: 'dash' }).keys()]
        if (dash.length && rand() < 0.4) return { type: 'DASH', unitId: id, to: keyToHex(pickOne(dash)) }
        return { type: 'ENERGIZE', unitId: id }
    }
    return { type: 'END_ACTIVATION', unitId: id }
}

