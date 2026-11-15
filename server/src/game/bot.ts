// IA sencilla para el rival automático y las partidas de prueba (self-play).
// Elige acciones legales con unas reglas simples; el motor valida todo igualmente.
import type { GameState, GameAction, PlayerId } from '../types'
import { reachableFor, attackableHexes, attackableHexesWith, targetAt, canPlayResponseCard, rwsDeployHexes, baseOwnerAt } from './queries'
import { previewAttack } from './combat'
import { keyToHex, gridDistance, hexKey } from './hexGrid'
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

export type BotLevel = 'facil' | 'normal' | 'dificil'
export const BOT_LEVELS: BotLevel[] = ['facil', 'normal', 'dificil']

// ─── IA POR PUNTUACIÓN (normal y difícil) ─────────────────────────────────────
// Puntúa cada ataque posible con la misma previsión que ve el jugador (daño
// esperado, probabilidad de derrota, VP del objetivo, coste de TL) y cada casilla
// de destino por Objetivos, alcance a enemigos y peligro. "Normal" añade algo de
// ruido para no ser perfecta; "difícil" elige siempre lo mejor y pesa más el TL
// y el peligro.
interface Scored { action: GameAction; score: number }

function bestAttack(s: GameState, player: PlayerId, level: BotLevel, noise: () => number): Scored | null {
    const id = s.activeUnitId!
    const unit = s.units[id]
    const act = s.activation!
    let best: Scored | null = null
    unit.weapons.forEach((w, wi) => {
        if (s.hasUsedPrimaryAction && !act.freeAttacks.includes(wi)) return
        for (const key of attackableHexes(s, id, wi)) {
            const t = targetAt(s, key, player)
            const p = t ? previewAttack(s, id, w, key) : null
            if (!t || !p) continue
            const anyHit = 1 - (1 - p.hitChance) ** p.dice
            let score = t.kind === 'unit'
                ? p.expectedDamage + p.killChance * (s.units[t.id].vp + 4)
                : anyHit * (t.kind === 'garrison' ? 2.5 : (s.rws[t.id]?.vp ?? 2))
            score += (p.targets - 1) * 1.5
            const free = s.hasUsedPrimaryAction && act.freeAttacks.includes(wi)
            if (!free) score -= w.tlCost * (level === 'dificil' ? 0.45 : 0.25)
            score += noise()
            const action: GameAction = t.kind === 'unit' ? { type: 'ATTACK', unitId: id, weaponIndex: wi, targetId: t.id }
                : t.kind === 'rws' ? { type: 'ATTACK_RWS', unitId: id, weaponIndex: wi, rwsId: t.id }
                    : { type: 'ATTACK_GARRISON', unitId: id, weaponIndex: wi, garrisonId: t.id }
            if (!best || score > best.score) best = { action, score }
        }
    })
    return best
}

// Mejor ataque si la unidad activa estuviera en `key` (se mueve y se deshace sin copiar el estado)
function attackFrom(s: GameState, player: PlayerId, level: BotLevel, key: string): Scored | null {
    const unit = s.units[s.activeUnitId!]
    const from = unit.position!
    const fromKey = hexKey(from)
    s.board[fromKey].occupiedBy = null
    s.board[key].occupiedBy = unit.id
    unit.position = keyToHex(key)
    try { return bestAttack(s, player, level, () => 0) } finally {
        s.board[key].occupiedBy = null
        s.board[fromKey].occupiedBy = unit.id
        unit.position = from
    }
}

function scoreHex(s: GameState, player: PlayerId, unitId: string, key: string, level: BotLevel): number {
    const unit = s.units[unitId]
    const pos = keyToHex(key)
    const hex = s.board[key]
    let score = 0
    if (baseOwnerAt(s, key) !== null) score -= 10
    if (hex.upgradeToken) score += 2
    // Objetivos: estar en uno o al lado de uno que no es nuestro
    const objectives = Object.values(s.board).filter(h => h.objectiveToken)
    let nearest = Infinity
    for (const o of objectives) {
        const d = gridDistance(pos, o.coord)
        if (o.objectiveToken!.controlledBy === player) continue
        nearest = Math.min(nearest, d)
        if (d <= 1) score += o.objectiveToken!.controlledBy ? 6 : 5
    }
    if (nearest !== Infinity) score -= 0.45 * nearest
    // Ataque: enemigos a alcance de alguna arma desde aquí
    const enemies = Object.values(s.units).filter(u => u.playerId !== player && u.position)
    const maxRange = Math.max(...unit.weapons.map(w => w.range))
    const inRange = enemies.filter(e => gridDistance(pos, e.position!) <= maxRange)
    if (inRange.length) score += 3 + Math.max(...inRange.map(e => (1 - e.currentHp / e.maxHp) * 3))
    else if (enemies.length) score -= 0.25 * Math.min(...enemies.map(e => gridDistance(pos, e.position!)))
    // Garrisons propias que rescatar
    if (!s.hasUsedPrimaryAction && Object.values(s.board).some(h => h.garrisonToken?.owner === player && gridDistance(h.coord, pos) === 1)) score += 3
    // Peligro: enemigos que podrían alcanzarle en su turno (más pesado en difícil)
    const threat = enemies.filter(e => gridDistance(pos, e.position!) <= 3 + Math.max(...e.weapons.map(w => w.range))).length
    score -= threat * (level === 'dificil' ? 0.9 : 0.4) * (unit.currentHp / unit.maxHp < 0.4 ? 2 : 1)
    return score
}

function smartAction(s: GameState, player: PlayerId, rand: () => number, level: BotLevel): GameAction | null {
    const id = s.activeUnitId!
    const unit = s.units[id]
    const act = s.activation!
    if (!unit.position) return null
    const noise = () => (level === 'normal' ? rand() * 1.5 : rand() * 0.05)
    const attack = (!s.hasUsedPrimaryAction || act.freeAttacks.length > 0) ? bestAttack(s, player, level, noise) : null
    // Un buen ataque desde aquí, o ya no se puede mover: atacar
    if (attack && (attack.score >= 2 || act.advanced)) return attack.action
    // Moverse a la mejor casilla (Advance)
    if (!act.advanced) {
        const here = scoreHex(s, player, id, hexKey(unit.position), level)
        let bestKey: string | null = null, bestScore = -Infinity
        for (const k of reachableFor(s, id, { kind: 'advance' }).keys()) {
            let sc = scoreHex(s, player, id, k, level) + noise()
            // Difícil mira un paso más: el mejor ataque que tendría desde esa casilla
            if (level === 'dificil' && (!s.hasUsedPrimaryAction || act.freeAttacks.length)) sc += 0.8 * Math.max(0, attackFrom(s, player, level, k)?.score ?? 0)
            if (sc > bestScore) { bestScore = sc; bestKey = k }
        }
        const onBase = baseOwnerAt(s, hexKey(unit.position)) !== null
        if (bestKey && (bestScore > here + 0.5 || onBase)) return { type: 'ADVANCE', unitId: id, to: keyToHex(bestKey) }
    }
    if (attack && attack.score > 0) return attack.action
    if (!s.hasUsedPrimaryAction) {
        const rescue = Object.values(s.board).find(h => h.garrisonToken?.owner === player && gridDistance(h.coord, unit.position!) === 1)
        if (rescue) return { type: 'RESCUE', unitId: id, garrisonId: rescue.garrisonToken!.id }
        // Dash si mejora claramente la posición; si no, Energize
        let bestKey: string | null = null, bestScore = scoreHex(s, player, id, hexKey(unit.position), level) + 1.5
        for (const k of reachableFor(s, id, { kind: 'dash' }).keys()) {
            const sc = scoreHex(s, player, id, k, level)
            if (sc > bestScore) { bestScore = sc; bestKey = k }
        }
        return bestKey ? { type: 'DASH', unitId: id, to: keyToHex(bestKey) } : { type: 'ENERGIZE', unitId: id }
    }
    return null
}

// Bot: en "fácil" ataca si puede o avanza hacia el enemigo más cercano (casi al
// azar); en "normal" y "difícil" usa la IA por puntuación de arriba.
// Respeta "no terminar sobre la Base".
export function chooseBotAction(s: GameState, player: PlayerId, rand: () => number = Math.random, level: BotLevel = 'facil'): GameAction {
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
        return card && (level === 'dificil' || rand() < 0.7) ? { type: 'PLAY_RESPONSE', cardId: card.id } : { type: 'PASS_RESPONSE' }
    }
    const id = s.activeUnitId!
    const unit = s.units[id]
    const act = s.activation!

    if (level !== 'facil') {
        // Cartas de apoyo antes de actuar (misma lógica que abajo, más a menudo)
        if (!act.cardPlayed && rand() < 0.5) {
            const hand = s.players[player].tactics.hand.filter(c => !c.signature || c.signature === unit.signature)
            const simple = new Set(['gain_upgrade', 'repair', 'activation_move_buff', 'heal_per_upgrade', 'energy_if_rescued', 'strength_if_garrisons_defeated'])
            const cmdCard = hand.find(c => c.type === 'command' && c.effectData && simple.has(c.effectData.type))
            if (cmdCard) return { type: 'PLAY_CARD', unitId: id, cardId: cmdCard.id }
        }
        const smart = smartAction(s, player, rand, level)
        if (smart) return smart
        if (s.hasUsedPrimaryAction && !act.freeAttacks.length) return { type: 'END_ACTIVATION', unitId: id }
    }

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

