// Resolución de un ataque según "Attack Timing and Responses" (Core Rulebook v1.2):
//  1-3. Declarar, comprobar alcance/LoS (lo hace el llamador) y pagar TL.
//  4.   Efectos "Before Attack Roll" (p.ej. Pull) y ventana de Response.
//  5.   Tirar tantos d10 como Strength (arma + modificadores).
//  6.   Ventana de Response "After Attack Roll"; Disarm: se repiten los impactos
//       y no hay efectos de crit.
//  7.   Efectos de crítico (una sola vez por ataque).
//  8.   Daño = impactos (+ Damage+X − reducciones) − Shields; Fracture; derrota.
//  9.   Efectos "After Combat Damage" y su ventana de Response.
// En cada ventana responde primero el atacante y después el defensor. El
// ataque queda guardado en `state.pendingAttack` mientras una ventana está
// abierta y se reanuda con `closeResponseWindow`.
// Precisión: cada punto de Accuracy suma/resta al valor del dado, salvo 1 (fallo
// siempre) y 9-10 (crit siempre). Impacta con 4 o más.
// MUTA `state` (el llamador clona).
import type {
    GameState, AttackReport, Weapon, WeaponEffect, PlayerId, PendingAttack, PendingResponse, TacticsCard, ResponseTrigger,
} from '../types'
import type { CardEffect } from '../types/tactics'
import { hexKey, keyToHex, gridDistance, findPath } from './hexGrid'
import {
    terrainAccuracy, targetAt, enemiesAdjacentTo, upgradeCount, moveOptionsFor, attackTargets, otherPlayer,
    attackDefenders, canPlayResponseCard, type TargetRef,
} from './queries'
import { damageUnit, destroyGarrison, forceMove, pushLog } from './damage'
import { getAttackModifiers, addStatus, destroyUpgrade, gainUpgrade, useResponseAbility, hasAbilityType } from './effects'
import { advanceToken } from './timeline'
import { captureObjective } from './victory'

export type Rng = () => number   // devuelve un d10 (1–10)

export function rollD10(): number {
    return Math.floor(Math.random() * 10) + 1
}

export function isHit(roll: number, accuracy: number, critThreshold: number): boolean {
    if (roll === 1) return false
    if (roll >= critThreshold) return true
    return roll + accuracy >= 4
}

function isCritEffect(e: WeaponEffect | null | undefined, timing: 'roll' | 'damage'): boolean {
    if (!e) return false
    const afterDamage = e.trigger === 'after_combat_damage'
    return timing === 'damage' ? afterDamage : !afterDamage
}

function refs(state: GameState, pa: PendingAttack): TargetRef[] {
    const player = state.units[pa.attackerId].playerId
    return pa.targetKeys.map(k => targetAt(state, k, player)).filter((t): t is TargetRef => t !== null)
}

function accuracyFor(state: GameState, pa: PendingAttack, key: string): number {
    const attacker = state.units[pa.attackerId]
    const primary = targetAt(state, pa.primaryKey, attacker.playerId)
    const mods = getAttackModifiers(state, pa.attackerId, pa.weapon.name, primary?.kind === 'unit' ? primary.id : null)
    const terrain = attacker.position ? terrainAccuracy(state.board, attacker.position, keyToHex(key)) : 0
    return mods.accuracyBonus + pa.bonusAccuracy + terrain
}

export function primaryAccuracy(state: GameState): number {
    const pa = state.pendingAttack!
    return accuracyFor(state, pa, pa.primaryKey)
}

// ─── INICIO ───────────────────────────────────────────────────────────────────

export function startAttack(
    state: GameState, attackerId: string, weapon: Weapon, primaryKey: string, rng: Rng,
    opts: { isRepeat?: boolean } = {},
): void {
    const attacker = state.units[attackerId]
    const player = attacker.playerId
    const effect = weapon.effectData
    let key = primaryKey

    // 4. Before Attack Roll del arma (Pull / Push al objetivo principal)
    const primary = targetAt(state, key, player)
    if (effect?.trigger === 'before_attack_roll' && primary?.kind === 'unit' && attacker.position &&
        (effect.type === 'pull' || effect.type === 'push')) {
        forceMove(state, hexKey(attacker.position), primary.id, effect.amount ?? 1, effect.type, player)
        const moved = state.units[primary.id]
        if (moved?.position) key = hexKey(moved.position)
    }

    state.pendingAttack = {
        attackerId, weapon, primaryKey: key,
        targetKeys: attackTargets(state, attackerId, weapon, key).map(t => t.key),
        stage: 'before_roll', isRepeat: !!opts.isRepeat,
        bonusStrength: 0, bonusAccuracy: 0, bonusDamage: 0, reductions: {}, destroyTargetUpgrades: false,
        rolls: [], rerolled: [], disarmed: false, critThreshold: 9, queue: [],
    }
    if (!opts.isRepeat && openAttackWindows(state, 'before_attack_roll')) return
    continueAttack(state, rng)
}

// Avanza el ataque pendiente hasta la siguiente ventana de Response o hasta el final.
export function continueAttack(state: GameState, rng: Rng): void {
    const pa = state.pendingAttack
    if (!pa) return
    if (pa.stage === 'before_roll') {
        rollDice(state, pa, rng)
        pa.stage = 'after_roll'
        if (!pa.isRepeat && openAttackWindows(state, 'after_attack_roll')) return
    }
    finishAttack(state, rng)
}

// ─── 5-6. TIRADA ──────────────────────────────────────────────────────────────

function rollDice(state: GameState, pa: PendingAttack, rng: Rng): void {
    const attacker = state.units[pa.attackerId]
    const weapon = pa.weapon
    const effect = weapon.effectData
    const primary = targetAt(state, pa.primaryKey, attacker.playerId)
    const mods = getAttackModifiers(state, pa.attackerId, weapon.name, primary?.kind === 'unit' ? primary.id : null)

    let strength = weapon.strength + mods.strengthBonus + pa.bonusStrength
    if (effect?.type === 'strength_per_upgrade') strength += upgradeCount(attacker, (effect.upgradeType ?? 'any') as 'attack' | 'movement' | 'shield' | 'any')
    const nearbyAllies = (range: number) => attacker.position
        ? Object.values(state.units).filter(u => u.id !== attacker.id && u.playerId === attacker.playerId && u.position &&
            gridDistance(attacker.position!, u.position) <= range).length
        : 0
    if (effect?.type === 'strength_per_ally') strength += (effect.amount ?? 2) * nearbyAllies(effect.max ?? 3)
    // Coordinated Payload (Response con coste de Energy): se usa si hay Energy
    const payload = useResponseAbility(state, pa.attackerId, 'strength_per_ally_nearby')
    if (payload) strength += (payload.amount ?? 2) * nearbyAllies(payload.range ?? 3)

    pa.rolls = Array.from({ length: Math.max(0, strength) }, rng)
    pa.critThreshold = mods.critThreshold
    const acc = accuracyFor(state, pa, pa.primaryKey)

    if (mods.rerollMisses > 0) {
        let left = mods.rerollMisses
        for (let i = 0; i < pa.rolls.length && left > 0; i++) {
            if (!isHit(pa.rolls[i], acc, pa.critThreshold)) { pa.rolls[i] = rng(); pa.rerolled.push(i); left-- }
        }
    }

    pa.disarmed = attacker.statusEffects.some(e => e.type === 'disarm')
    if (pa.disarmed) {
        for (let i = 0; i < pa.rolls.length; i++) {
            if (isHit(pa.rolls[i], acc, pa.critThreshold)) { pa.rolls[i] = rng(); pa.rerolled.push(i) }
        }
        attacker.statusEffects = attacker.statusEffects.filter(e => e.type !== 'disarm')
        pushLog(state, attacker.playerId, `${attacker.name} está Disarmed: repite sus impactos y no puede hacer críticos`, 'attack')
    }

    // Crit "Roll N additional dice" (los dados extra no vuelven a activar el crit, Q&A 13)
    const crit = weapon.critData
    if (!pa.disarmed && crit?.type === 'extra_dice' && pa.rolls.some(r => r >= pa.critThreshold)) {
        for (let i = 0; i < (crit.amount ?? 2); i++) pa.rolls.push(rng())
    }
}

// ─── 6b-9. EFECTOS, DAÑO Y FINAL ─────────────────────────────────────────────

function finishAttack(state: GameState, rng: Rng): void {
    const pa = state.pendingAttack!
    const attacker = state.units[pa.attackerId]
    const player = attacker.playerId
    const weapon = pa.weapon
    const effect = weapon.effectData
    const crit = weapon.critData
    const critTriggered = !pa.disarmed && pa.rolls.some(r => r >= pa.critThreshold)
    let primary = targetAt(state, pa.primaryKey, player)
    const primaryUnit = primary?.kind === 'unit' ? state.units[primary.id] : null

    // 6b. After Attack Roll del arma y de la activación
    if (primaryUnit) {
        if (effect?.trigger === 'after_attack_roll') applyOnTarget(state, pa.attackerId, primaryUnit.id, effect)
        if (state.activation?.unitId === pa.attackerId && state.activation.destroyUpgradeOnHit) destroyUpgrade(state, primaryUnit.id, 'any', 1)
    }
    if (pa.destroyTargetUpgrades) for (const t of refs(state, pa)) if (t.kind === 'unit') destroyUpgrade(state, t.id, 'any', 1)
    if (effect?.type === 'capture_objective_near_target') {
        const center = keyToHex(pa.primaryKey)
        for (const [k, h] of Object.entries(state.board)) {
            if (h.objectiveToken && gridDistance(h.coord, center) <= 1) captureObjective(state, k, player)
        }
    }
    // Toss Away: "[After Attack Roll] If this unit is attacking, it Pushes 2 the target."
    const toss = primaryUnit?.position && attacker.position ? useResponseAbility(state, pa.attackerId, 'push_on_attack') : null
    if (toss && primaryUnit && attacker.position) {
        forceMove(state, hexKey(attacker.position), primaryUnit.id, toss.amount ?? 2, 'push', player)
        if (state.units[primaryUnit.id].position) pa.primaryKey = hexKey(state.units[primaryUnit.id].position!)
    }
    if (effect?.type === 'move_toward_target' && attacker.position) stepToward(state, pa.attackerId, pa.primaryKey, effect.amount ?? 1)

    // 7. Crit previo al daño
    primary = targetAt(state, pa.primaryKey, player)
    if (critTriggered && crit && isCritEffect(crit, 'roll') && primary?.kind === 'unit') applyOnTarget(state, pa.attackerId, primary.id, crit)

    // 8. Daño
    const report: AttackReport = { attackerId: pa.attackerId, weaponName: weapon.name, rolls: [...pa.rolls], rerolled: pa.rerolled, targets: [] }
    const actBonus = state.activation?.unitId === pa.attackerId ? state.activation.damageBonus : 0
    // los objetivos empujados se siguen por id
    const targets = pa.targetKeys.map(k => targetAt(state, k, player)).filter((t): t is TargetRef => t !== null)
    if (primary && !targets.some(t => t.id === primary!.id)) targets.unshift(primary)
    for (const t of targets) {
        const acc = accuracyFor(state, pa, t.key)
        const hits = pa.rolls.filter(r => isHit(r, acc, pa.critThreshold)).length
        const crits = pa.rolls.filter(r => r >= pa.critThreshold).length
        if (t.kind === 'garrison') {
            const destroyed = hits > 0 && destroyGarrison(state, t.key, player)
            report.targets.push({ id: t.id, kind: 'garrison', hits, crits, damage: hits > 0 ? 1 : 0, defeated: destroyed })
            continue
        }
        let damage = hits
        if (hits > 0 || critTriggered) damage += bonusDamage(state, pa.attackerId, weapon, critTriggered, crits, t) + pa.bonusDamage + actBonus
        // Las reducciones de daño se aplican antes que los Shields
        damage = Math.max(0, damage - (pa.reductions[t.id] ?? 0))
        const { dealt, defeated } = damageUnit(state, t.id, damage, { combat: true })
        report.targets.push({ id: t.id, kind: 'unit', hits, crits, damage: dealt, defeated })
    }

    // 9. After Combat Damage
    const primaryId = primary?.kind === 'unit' ? primary.id : null
    for (const t of report.targets) {
        if (t.kind !== 'unit') continue
        const alive = !!state.units[t.id]?.position
        if (effect?.trigger === 'after_combat_damage' && t.damage > 0 && alive) applyOnTarget(state, pa.attackerId, t.id, effect)
        if (critTriggered && crit && isCritEffect(crit, 'damage') && (t.id === primaryId || isStatusEffect(crit))) {
            // Los efectos de crit se aplican aunque los Shields eviten todo el daño.
            if (crit.type === 'repeat_attack') continue
            if (alive || crit.target === 'self' || crit.type === 'gain_upgrade' || crit.type === 'free_dash') {
                applyOnTarget(state, pa.attackerId, t.id, crit)
            }
        }
    }
    // Stunning Shot: cada objetivo dañado avanza en el Timeline.
    if (report.targets.some(t => t.kind === 'unit' && t.damage > 0)) {
        const stun = useResponseAbility(state, pa.attackerId, 'stun_on_damage')
        if (stun) for (const t of report.targets) {
            if (t.kind === 'unit' && t.damage > 0 && state.units[t.id]?.position) state.timeline = advanceToken(state.timeline, t.id, stun.amount ?? 1)
        }
    }
    // Crowd Control: si dañó a 2 o más enemigos, roba 1 carta.
    if (report.targets.filter(t => t.damage > 0).length >= 2) {
        const crowd = useResponseAbility(state, pa.attackerId, 'draw_on_multi_damage')
        if (crowd) drawCards(state, player, crowd.amount ?? 1)
    }

    const wasRepeat = pa.isRepeat
    state.pendingAttack = null
    logAttack(state, report, attacker.name, primary ? describe(state, primary) : 'el objetivo')

    // Repetir el ataque a TL 0 (Beam Sabers de Aerial, Handguns de Vidar), sin el efecto
    if (critTriggered && crit?.type === 'repeat_attack' && !wasRepeat) {
        const again = primary ? targetAt(state, pa.primaryKey, player) : null
        if (again && attacker.position) {
            pushLog(state, player, `${attacker.name} repite el ataque (${weapon.name}) a TL 0`, 'attack')
            startAttack(state, pa.attackerId, { ...weapon, critData: null }, pa.primaryKey, rng, { isRepeat: true })
            const second = state.lastAttack
            if (second) { report.rolls.push(...second.rolls); report.targets.push(...second.targets) }
        }
    }
    state.lastAttack = report

    if (!wasRepeat) openAfterDamageWindow(state, pa.attackerId, primaryId)
}

function describe(state: GameState, t: TargetRef): string {
    return t.kind === 'unit' ? state.units[t.id].name : 'una Garrison'
}

function logAttack(state: GameState, report: AttackReport, attackerName: string, targetName: string): void {
    const main = report.targets[0]
    const attacker = state.units[report.attackerId]
    pushLog(state, attacker.playerId,
        `${attackerName} atacó a ${targetName} con ${report.weaponName} [${report.rolls.join(', ')}]` +
        (main ? ` — ${main.hits} impactos, ${main.damage} de daño` : '') +
        (report.targets.length > 1 ? ` (+${report.targets.length - 1} objetivos)` : ''),
        'attack', attacker.position ? [hexKey(attacker.position)] : [])
}

function drawCards(state: GameState, player: PlayerId, n: number): void {
    const t = state.players[player].tactics
    t.hand.push(...t.deck.splice(0, n))
}

function isStatusEffect(e: WeaponEffect): boolean {
    return e.type === 'slow' || e.type === 'fracture' || e.type === 'disarm'
}

function bonusDamage(
    state: GameState, attackerId: string, weapon: Weapon, critTriggered: boolean, crits: number, t: TargetRef,
): number {
    const attacker = state.units[attackerId]
    const crit = weapon.critData
    let bonus = 0
    if (critTriggered && crit) {
        if (crit.type === 'bonus_damage') bonus += crit.amount ?? 0
        if (crit.type === 'damage_per_crit') bonus += Math.min(crits, crit.max ?? 4)
        if (crit.type === 'damage_per_upgrade') {
            const n = crit.upgradeType && crit.upgradeType !== 'any' && crit.upgradeType !== 'energy'
                ? upgradeCount(attacker, crit.upgradeType) : attacker.upgrades.length
            bonus += Math.min(n, crit.max ?? 4)
        }
    }
    const effect = weapon.effectData
    if (effect?.type === 'bonus_damage_near_objective') {
        const pos = keyToHex(t.key)
        const near = Object.values(state.board).some(h => h.objectiveToken && gridDistance(h.coord, pos) <= 1)
        if (near) bonus += effect.amount ?? 0
    }
    return bonus
}

function applyOnTarget(state: GameState, attackerId: string, targetId: string, e: WeaponEffect): void {
    const attacker = state.units[attackerId]
    switch (e.type) {
        case 'slow': case 'fracture': case 'disarm':
            addStatus(state, targetId, e.type); break
        case 'deactivate_shields':
            for (const u of state.units[targetId]?.upgrades ?? []) if (u.type === 'shield') u.active = false
            break
        case 'destroy_upgrade':
            destroyUpgrade(state, targetId, e.upgradeType ?? 'any', e.amount ?? 1); break
        case 'gain_upgrade':
            gainUpgrade(state, attackerId, e.upgradeType ?? 'attack', e.amount ?? 1); break
        case 'push': case 'pull':
            if (attacker.position) forceMove(state, hexKey(attacker.position), targetId, e.amount ?? 1, e.type, attacker.playerId)
            break
        case 'free_dash':
            if (state.activation?.unitId === attackerId) state.activation.freeDashes += 1
            break
        case 'splash_damage': {
            const pos = state.units[targetId]?.position
            if (!pos) break
            for (const t of enemiesAdjacentTo(state, hexKey(pos), attacker.playerId)) {
                if (t.kind === 'unit') damageUnit(state, t.id, e.amount ?? 1)
            }
            break
        }
    }
}

// "Move 1 towards the target ignoring terrain penalties."
function stepToward(state: GameState, unitId: string, targetKey: string, steps: number): void {
    const unit = state.units[unitId]
    if (!unit.position) return
    const target = keyToHex(targetKey)
    const opts = moveOptionsFor(state, unitId, { kind: 'move', base: steps + 1, ignoreEngagement: true, ignoreTerrain: true })
    opts.occupiedHexes.delete(targetKey)
    const path = findPath(unit.position, target, state.board, { ...opts, occupiedHexes: new Set() })
    if (!path || path.length < 3) return   // ya adyacente
    const dest = path[Math.min(steps, path.length - 2)]
    const destKey = hexKey(dest)
    if (opts.occupiedHexes.has(destKey)) return
    state.board[hexKey(unit.position)].occupiedBy = null
    state.board[destKey].occupiedBy = unitId
    unit.position = dest
}

// ─── VENTANAS DE RESPONSE ─────────────────────────────────────────────────────

const ATTACK_RESPONSE_TYPES = new Set<CardEffect['type']>(['attack_bonus', 'reduce_damage', 'set_crit', 'reroll_misses'])

export function isAttackResponse(effect: CardEffect): boolean {
    return ATTACK_RESPONSE_TYPES.has(effect.type)
}

function defendersOf(state: GameState, _pa: PendingAttack, player: PlayerId): string[] {
    return attackDefenders(state, player)
}

export function canPlayAttackResponse(state: GameState, player: PlayerId, card: TacticsCard, trigger: ResponseTrigger): boolean {
    return canPlayResponseCard(state, player, card, trigger)
}

// Abre las ventanas de una fase del ataque: primero el atacante, luego el defensor.
export function openAttackWindows(state: GameState, trigger: ResponseTrigger): boolean {
    const pa = state.pendingAttack!
    const attackerPlayer = state.units[pa.attackerId].playerId
    const defender = refs(state, pa).find(t => t.kind === 'unit')
    const queue: PendingResponse[] = []
    for (const player of [attackerPlayer, otherPlayer(attackerPlayer)] as PlayerId[]) {
        const hand = state.players[player].tactics.hand
        if (!hand.some(c => canPlayAttackResponse(state, player, c, trigger))) continue
        queue.push({
            trigger, forPlayerId: player, side: player === attackerPlayer ? 'attacker' : 'defender',
            attackerUnitId: pa.attackerId, defenderUnitId: defender?.id,
        })
    }
    if (queue.length === 0) return false
    state.pendingResponse = queue.shift()!
    pa.queue = queue
    return true
}

// Cierra la ventana actual (se jugó o se pasó) y sigue con la siguiente o con el ataque.
export function closeResponseWindow(state: GameState, rng: Rng): void {
    const pa = state.pendingAttack
    if (pa && pa.queue.length > 0) {
        state.pendingResponse = pa.queue.shift()!
        return
    }
    state.pendingResponse = null
    if (pa) continueAttack(state, rng)
}

// Efecto de una carta Response jugada durante un ataque.
export function applyAttackResponse(state: GameState, player: PlayerId, card: TacticsCard, rng: Rng): string | null {
    const pa = state.pendingAttack
    const e = card.effectData!
    if (!pa) return 'No hay ningún ataque en curso'
    switch (e.type) {
        case 'attack_bonus':
            pa.bonusStrength += e.strength ?? 0
            pa.bonusAccuracy += e.accuracy ?? 0
            pa.bonusDamage += e.damage ?? 0
            if (e.destroyTargetUpgrades) pa.destroyTargetUpgrades = true
            return null
        case 'reduce_damage': {
            const ids = defendersOf(state, pa, player).filter(id =>
                (!e.requiresActiveTrait || state.units[id].traits.includes(e.requiresActiveTrait)) &&
                (!e.ifLowerVp || state.units[id].vp < state.units[pa.attackerId].vp))
            const id = ids[0]
            if (!id) return 'No tienes un defensor válido en este ataque'
            pa.reductions[id] = (pa.reductions[id] ?? 0) + (e.amount ?? 0)
            if (e.gainShield) gainUpgrade(state, id, 'shield')
            if (e.destroyAttackerUpgrade) destroyUpgrade(state, pa.attackerId, 'any', 1)
            return null
        }
        case 'set_crit': {
            // Se convierte en crítico el dado más bajo
            if (pa.rolls.length === 0) return 'No hay dados que cambiar'
            let idx = 0
            pa.rolls.forEach((r, i) => { if (r < pa.rolls[idx]) idx = i })
            pa.rolls[idx] = 10
            return null
        }
        case 'reroll_misses': {
            const acc = accuracyFor(state, pa, pa.primaryKey)
            let n = 0
            pa.rolls = pa.rolls.map((r, i) => {
                if (isHit(r, acc, pa.critThreshold)) return r
                n++; pa.rerolled.push(i)
                return rng()
            })
            if (e.drawIfAtLeast && n >= e.drawIfAtLeast) drawCards(state, player, 1)
            return null
        }
        default:
            return 'Efecto de respuesta no implementado'
    }
}

// Ventana tras el daño (cartas de la demo: reducir daño, devolver el golpe…)
function openAfterDamageWindow(state: GameState, attackerId: string, defenderId: string | null): void {
    if (!defenderId || !state.units[defenderId]?.position || !state.units[attackerId]?.position) return
    const defender = state.units[defenderId].playerId
    const blocked = hasAbilityType(state, attackerId, 'block_enemy_responses') !== null
    const hasCard = state.players[defender].tactics.hand.some(c =>
        c.type === 'response' && c.effectData?.trigger === 'after_combat_damage')
    if (!blocked && hasCard) {
        state.pendingResponse = { trigger: 'after_combat_damage', forPlayerId: defender, attackerUnitId: attackerId, defenderUnitId: defenderId }
    }
}
