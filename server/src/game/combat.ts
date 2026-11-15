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
import type { AreaAim } from '../types'
import type {
    GameState, AttackReport, Weapon, WeaponEffect, PlayerId, PendingAttack, PendingResponse, TacticsCard, ResponseTrigger, AttackPreview,
} from '../types'
import type { CardEffect } from '../types/tactics'
import { hexKey, keyToHex, gridDistance, findPath } from './hexGrid'
import {
    terrainAccuracy, targetAt, enemiesAdjacentTo, upgradeCount, moveOptionsFor, attackTargets, otherPlayer, resolveAim,
    attackDefenders, canPlayResponseCard, checkAttackTargetWith, rwsAdjacentTo, alliedRws, challengeOptions, protectiveShooters, type TargetRef,
} from './queries'
import { damageUnit, destroyGarrison, destroyRws, damageAt, forceMove, pushLog } from './damage'
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

// ─── PREVISIÓN ────────────────────────────────────────────────────────────────
// Lo que el atacante puede esperar antes de confirmar: mismos dados, Accuracy y
// umbral de crítico que usará la resolución real. No cuenta las Response (cartas
// ni habilidades con coste de Energy) porque aún no se han decidido. No muta.
export function previewAttack(state: GameState, attackerId: string, weapon: Weapon, targetKey: string, aim?: AreaAim): AttackPreview | null {
    const attacker = state.units[attackerId]
    if (!attacker?.position) return null
    const primary = targetAt(state, targetKey, attacker.playerId)
    if (!primary) return null
    const mods = getAttackModifiers(state, attackerId, weapon.name, primary.kind === 'unit' ? primary.id : null)
    const effect = weapon.effectData
    let dice = weapon.strength + mods.strengthBonus
    if (effect?.type === 'strength_per_upgrade') dice += upgradeCount(attacker, (effect.upgradeType ?? 'any') as 'attack' | 'movement' | 'shield' | 'any')
    if (effect?.type === 'strength_per_ally') {
        const n = Object.values(state.units).filter(u => u.id !== attacker.id && u.playerId === attacker.playerId && u.position &&
            gridDistance(attacker.position!, u.position) <= (effect.max ?? 3)).length
        dice += (effect.amount ?? 2) * n
    }
    if (effect?.type === 'strength_per_rws_adjacent') dice += rwsAdjacentTo(state, targetKey, attacker.playerId).length * (effect.amount ?? 1)
    dice = Math.max(0, dice)
    const terrain = terrainAccuracy(state.board, attacker.position, keyToHex(targetKey))
    const corax = rwsAdjacentTo(state, targetKey, attacker.playerId, 'corax').length > 0 ? 1 : 0
    const accuracy = mods.accuracyBonus + terrain + corax
    const crit = mods.critThreshold
    let hits = 0
    for (let r = 1; r <= 10; r++) if (isHit(r, accuracy, crit)) hits++
    const p = hits / 10
    const pc = Math.max(0, (11 - crit) / 10)
    const target = primary.kind === 'unit' ? state.units[primary.id] : null
    const shields = target ? target.upgrades.filter(u => u.type === 'shield' && u.active !== false).reduce((n, u) => n + (u.value ?? 1), 0) : 0
    const damageBonus = (state.activation?.unitId === attackerId ? state.activation.damageBonus : 0)
    const hp = target ? target.currentHp : 1
    // Probabilidad de derrotarlo: P(impactos + bonus − Shields ≥ HP), binomial exacta
    let kill = 0, comb = 1
    for (let k = 0; k <= dice; k++) {
        if (k > 0) comb = comb * (dice - k + 1) / k
        if (Math.max(0, k + damageBonus - shields) >= hp) kill += comb * p ** k * (1 - p) ** (dice - k)
    }
    return {
        dice, accuracy, critThreshold: crit, hitChance: p,
        expectedHits: dice * p, critChance: 1 - (1 - pc) ** dice,
        shields, damageBonus, expectedDamage: Math.max(0, dice * p + damageBonus - shields),
        killChance: target ? kill : 0,
        targets: attackTargets(state, attackerId, weapon, targetKey, aim).length,
    }
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
    // Corax "Hold In Position": aliados +1 Accuracy contra enemigos adyacentes a ella
    const corax = rwsAdjacentTo(state, key, attacker.playerId, 'corax').length > 0 ? 1 : 0
    return mods.accuracyBonus + pa.bonusAccuracy + terrain + corax
}

export function primaryAccuracy(state: GameState): number {
    const pa = state.pendingAttack!
    return accuracyFor(state, pa, pa.primaryKey)
}

// ─── INICIO ───────────────────────────────────────────────────────────────────

export function startAttack(
    state: GameState, attackerId: string, weapon: Weapon, primaryKey: string, rng: Rng,
    opts: { isRepeat?: boolean; aim?: AreaAim } = {},
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

    // Plantilla de área: la colocación elegida (o la mejor) queda fija para todo el ataque
    const aim = weapon.area && attacker.position ? resolveAim(state, attacker.position, weapon, key, opts.aim) : undefined
    state.pendingAttack = {
        attackerId, weapon, primaryKey: key, aim,
        targetKeys: attackTargets(state, attackerId, weapon, key, aim).map(t => t.key),
        stage: 'before_roll', isRepeat: !!opts.isRepeat,
        bonusStrength: 0, bonusAccuracy: 0, bonusDamage: 0, reductions: {}, destroyTargetUpgrades: false,
        rolls: [], rerolled: [], disarmed: false, critThreshold: 9, queue: [], targetIds: [], damagedIds: [],
    }
    if (!opts.isRepeat && openAttackWindows(state, 'before_attack_roll')) return
    continueAttack(state, rng)
}

// Avanza el ataque pendiente hasta la siguiente ventana de Response o hasta el final.
export function continueAttack(state: GameState, rng: Rng): void {
    const pa = state.pendingAttack
    if (!pa) return
    if (pa.stage === 'after_damage') {   // ya se cerraron las ventanas tras el daño
        state.pendingAttack = null
        return
    }
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
    if (effect?.type === 'strength_per_rws_adjacent') strength += rwsAdjacentTo(state, pa.primaryKey, attacker.playerId).length * (effect.amount ?? 1)
    // Psycho-Frame Synchrony: otro aliado a 3 hexes da +1 Strength por cada Strength Upgrade suyo
    for (const ally of nearbyAllyUnits(state, pa.attackerId, 3)) {
        const n = upgradeCount(ally, 'attack')
        if (n > 0 && ally.abilities.some(a => a.abilityData?.type === 'psycho_frame') && useResponseAbility(state, ally.id, 'psycho_frame')) strength += n
    }
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
    // Inspiring Presence: otro aliado a 2 hexes repite hasta 3 fallos
    const inspirer = nearbyAllyUnits(state, pa.attackerId, 2).find(u => u.abilities.some(a => a.abilityData?.type === 'inspiring_presence'))
    if (inspirer && useResponseAbility(state, inspirer.id, 'inspiring_presence')) {
        const acc = accuracyFor(state, pa, pa.primaryKey)
        let left = 3
        pa.rolls = pa.rolls.map((r, i) => {
            if (left <= 0 || isHit(r, acc, pa.critThreshold)) return r
            left--; pa.rerolled.push(i)
            return rng()
        })
    }
    // Permet Burst: si esta unidad o un aliado a 3 hexes ataca, un dado pasa a crítico
    if (!pa.disarmed && pa.rolls.length && !pa.rolls.every(r => r >= pa.critThreshold)) {
        const burster = [attacker, ...nearbyAllyUnits(state, pa.attackerId, 3)].find(u => u.abilities.some(a => a.abilityData?.type === 'permet_burst'))
        if (burster && useResponseAbility(state, burster.id, 'permet_burst')) {
            let idx = 0
            pa.rolls.forEach((r, i) => { if (r < pa.rolls[idx]) idx = i })
            pa.rolls[idx] = 10
        }
    }
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
        if (t.kind === 'rws') {
            const destroyed = hits > 0 && destroyRws(state, t.id, player)
            report.targets.push({ id: t.id, kind: 'rws', hits, crits, damage: hits > 0 ? 1 : 0, defeated: destroyed })
            continue
        }
        // BIT Stave "Blocking BIT": los aliados adyacentes reciben −1 de daño de ataques enemigos
        const bits = rwsAdjacentTo(state, t.key, state.units[t.id].playerId, 'bit_stave').length
        let damage = hits
        if (hits > 0 || critTriggered) damage += bonusDamage(state, pa.attackerId, weapon, critTriggered, crits, t) + pa.bonusDamage + actBonus
        // Las reducciones de daño se aplican antes que los Shields
        damage = Math.max(0, damage - (pa.reductions[t.id] ?? 0) - bits)
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
    // Lockdown: si atacó a un enemigo adyacente a su Corax, le aplica Slow
    if (primaryId && state.units[primaryId]?.position &&
        alliedRws(state, player, 'corax').some(r => r.ownerUnitId === pa.attackerId && gridDistance(r.position!, state.units[primaryId].position!) === 1) &&
        useResponseAbility(state, pa.attackerId, 'slow_near_rws')) {
        addStatus(state, primaryId, 'slow')
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

    // 9b. Ventanas de Response tras el daño (atacante y luego defensor)
    if (!wasRepeat) {
        state.pendingAttack = {
            ...pa, stage: 'after_damage', queue: [],
            targetIds: report.targets.filter(t => t.kind === 'unit').map(t => t.id),
            damagedIds: report.targets.filter(t => t.kind === 'unit' && t.damage > 0).map(t => t.id),
        }
        if (!openAttackWindows(state, 'after_combat_damage')) state.pendingAttack = null
    }
}

function describe(state: GameState, t: TargetRef): string {
    return t.kind === 'unit' ? state.units[t.id].name : t.kind === 'rws' ? state.rws[t.id].name : 'una Garrison'
}

function nearbyAllyUnits(state: GameState, unitId: string, range: number) {
    const unit = state.units[unitId]
    if (!unit?.position) return []
    return Object.values(state.units).filter(u => u.id !== unitId && u.playerId === unit.playerId && u.position &&
        gridDistance(u.position, unit.position!) <= range)
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
        case 'damage_adjacent_to_rws': {
            // "Deal [Damage 2] to each enemy adjacent to this unit's Iśvara B Type"
            for (const r of alliedRws(state, attacker.playerId, 'isvara').filter(r => r.ownerUnitId === attackerId)) {
                for (const t of enemiesAdjacentTo(state, hexKey(r.position!), attacker.playerId)) damageAt(state, t.key, e.amount ?? 2, attacker.playerId)
            }
            break
        }
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

const ATTACK_RESPONSE_TYPES = new Set<CardEffect['type']>(['attack_bonus', 'reduce_damage', 'set_crit', 'reroll_misses', 'counter_attack', 'self_and_targets_damage', 'gain_energy', 'grant_challenge', 'protective_shot'])

// Se resuelve dentro del ataque en curso (si lo hay) o con el efecto clásico.
export function isAttackResponse(effect: CardEffect, state?: GameState): boolean {
    if (effect.type === 'counter_attack') return !!state?.pendingAttack
    if (effect.type === 'protective_shot') return true
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
        const canAbility = trigger === 'before_attack_roll' && challengeAbilityAvailable(state, player)
        if (!canAbility && !hand.some(c => canPlayAttackResponse(state, player, c, trigger))) continue
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
    const e = card.effectData!
    if (e.type === 'protective_shot') return performProtectiveShot(state, player, card, rng)
    const pa = state.pendingAttack
    if (!pa) return 'No hay ningún ataque en curso'
    switch (e.type) {
        case 'grant_challenge': {
            // Interception: un aliado gana Challenge este ataque
            const opt = challengeOptions(state, player, e.range2 ?? 2)[0]
            if (!opt) return 'Ningún aliado puede hacer Challenge'
            performChallenge(state, opt.challengerId, opt.defenderId)
            return null
        }
        case 'attack_bonus':
            if (e.perRwsAdjacentToTarget) pa.bonusStrength += e.perRwsAdjacentToTarget * rwsAdjacentTo(state, pa.primaryKey, player).length
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
            const nearRws = e.perRwsWithin && state.units[id].position
                ? alliedRws(state, player).filter(r => gridDistance(r.position!, state.units[id].position!) <= e.perRwsWithin!).length : 0
            pa.reductions[id] = (pa.reductions[id] ?? 0) + (e.amount ?? 0) + nearRws
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
        case 'counter_attack': {
            // Counter Attack: el defensor superviviente ataca al atacante a [Timeline -1]
            const defenderId = defendersOf(state, pa, player).find(id => state.units[id].position)
            const attacker = state.units[pa.attackerId]
            if (!defenderId || !attacker.position) return 'No hay defensor o atacante en el tablero'
            const defender = state.units[defenderId]
            const key = hexKey(attacker.position)
            const options = defender.weapons.filter(w => checkAttackTargetWith(state, defenderId, w, key).ok)
            if (options.length === 0) return 'El atacante está fuera del alcance de todas sus armas'
            const weapon = options.reduce((a, b) => (b.strength > a.strength ? b : a))
            state.timeline = advanceToken(state.timeline, defenderId, Math.max(0, weapon.tlCost - 1))
            const outer = state.pendingAttack
            startAttack(state, defenderId, weapon, key, rng, { isRepeat: true })
            state.pendingAttack = outer
            return null
        }
        case 'self_and_targets_damage': {
            // Sacrificial Overload: 2 de daño a la propia unidad y a cada objetivo
            for (const id of pa.targetIds) if (state.units[id]?.position) damageUnit(state, id, e.amount ?? 2)
            damageUnit(state, pa.attackerId, e.amount ?? 2)
            return null
        }
        case 'gain_energy': {
            // Sayla's Encouragement: la unidad aliada dañada gana Energy
            const id = pa.damagedIds.find(d => state.units[d]?.playerId === player && state.units[d].position)
            if (!id) return 'Ninguna unidad aliada ha recibido daño'
            state.units[id].energy += e.amount ?? 2
            return null
        }
        default:
            return 'Efecto de respuesta no implementado'
    }
}

// La ventana se abre también si el jugador tiene una unidad con Challenge utilizable.
function challengeAbilityAvailable(state: GameState, player: PlayerId): boolean {
    const challengers = new Set(challengeOptions(state, player).map(o => o.challengerId))
    return [...challengers].some(id => state.units[id].abilities.some(a => a.type === 'RSP' && a.abilityData?.type === 'challenge'))
}

// Challenge: intercambia posiciones con el aliado defensor; el que se mete pasa
// a ser el defensor (los objetivos del ataque se resuelven por hex).
export function performChallenge(state: GameState, challengerId: string, defenderId: string): void {
    const c = state.units[challengerId]
    const d = state.units[defenderId]
    const cPos = c.position!
    const dPos = d.position!
    state.board[hexKey(cPos)].occupiedBy = defenderId
    state.board[hexKey(dPos)].occupiedBy = challengerId
    c.position = dPos
    d.position = cPos
    pushLog(state, c.playerId, `${c.name} hace Challenge y se cambia por ${d.name}`, 'ability', [hexKey(cPos), hexKey(dPos)])
}

// Protective Shot: la unidad dispara a la que acaba de moverse, a [Timeline 1].
export function performProtectiveShot(state: GameState, player: PlayerId, card: TacticsCard, rng: Rng): string | null {
    const shooter = protectiveShooters(state, player, card)[0]
    const moved = state.pendingResponse?.movedUnitId ? state.units[state.pendingResponse.movedUnitId] : null
    if (!shooter || !moved?.position) return 'Ninguna unidad puede disparar'
    state.timeline = advanceToken(state.timeline, shooter.unitId, card.effectData?.amount ?? 1)
    const outer = state.pendingAttack
    startAttack(state, shooter.unitId, shooter.weapon, hexKey(moved.position), rng, { isRepeat: true })
    state.pendingAttack = outer
    return null
}
