// Resolución de un ataque según "Attack Timing and Responses" (Core Rulebook v1.2):
//  1-3. Declarar, comprobar alcance/LoS (lo hace el llamador) y pagar TL.
//  4.   Efectos "Before Attack Roll" (p.ej. Pull).
//  5.   Tirar tantos d10 como Strength (arma + modificadores).
//  6.   Efectos "After Attack Roll" (desactivar Shields, destruir Upgrade…);
//       Disarm: se repiten todos los dados que son impacto y no hay efectos de crit.
//  7.   Efectos de crítico (una sola vez por ataque).
//  8.   Daño = impactos (+ Damage+X) − Shields; Fracture; derrota si HP 0.
//  9.   Efectos "After Combat Damage".
// Precisión: cada punto de Accuracy suma/resta al valor del dado, salvo 1 (fallo
// siempre) y 9-10 (crit siempre). Impacta con 4 o más.
// MUTA `state` (el llamador clona).
import type { GameState, AttackReport, Weapon, WeaponEffect } from '../types'
import { hexKey, keyToHex, gridDistance, findPath } from './hexGrid'
import { terrainAccuracy, targetAt, enemiesAdjacentTo, upgradeCount, moveOptionsFor, type TargetRef } from './queries'
import { damageUnit, destroyGarrison, forceMove, pushLog } from './damage'
import { getAttackModifiers, addStatus, destroyUpgrade, gainUpgrade, hasAbilityType } from './effects'
import { advanceToken } from './timeline'

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

export function resolveAttack(
    state: GameState,
    attackerId: string,
    weapon: Weapon,
    primaryKey: string,
    rng: Rng,
    opts: { isRepeat?: boolean } = {},
): AttackReport {
    const attacker = state.units[attackerId]
    const player = attacker.playerId
    const effect = weapon.effectData
    const crit = weapon.critData

    // ── Objetivos ──
    const primary = targetAt(state, primaryKey, player)!
    let targets: TargetRef[] = [primary]
    if (effect?.type === 'also_target_adjacent') {
        targets = [primary, ...enemiesAdjacentTo(state, primaryKey, player)]
    }

    // ── 4. Before Attack Roll ──
    if (effect?.trigger === 'before_attack_roll' && primary.kind === 'unit' && attacker.position) {
        if (effect.type === 'pull' || effect.type === 'push') {
            forceMove(state, hexKey(attacker.position), primary.id, effect.amount ?? 1, effect.type, player)
        }
        // refrescar la clave del objetivo si se ha movido
        const moved = state.units[primary.id]
        if (moved?.position) primary.key = hexKey(moved.position)
        targets = targets.filter(t => t.kind !== 'unit' || state.units[t.id]?.position)
    }

    // ── 5. Tirada ──
    const mods = getAttackModifiers(state, attackerId, weapon.name, primary.kind === 'unit' ? primary.id : null)
    let strength = weapon.strength + mods.strengthBonus
    if (effect?.type === 'strength_per_upgrade') strength += upgradeCount(attacker, (effect.upgradeType ?? 'any') as 'attack' | 'movement' | 'shield' | 'any')
    const rolls: number[] = Array.from({ length: Math.max(0, strength) }, rng)
    const rerolled: number[] = []

    const accFor = (t: TargetRef) => {
        const to = keyToHex(t.key)
        return mods.accuracyBonus + (attacker.position ? terrainAccuracy(state.board, attacker.position, to) : 0)
    }
    const primaryAcc = accFor(primary)

    // Reroll de fallos (habilidades Ongoing)
    if (mods.rerollMisses > 0) {
        let left = mods.rerollMisses
        for (let i = 0; i < rolls.length && left > 0; i++) {
            if (!isHit(rolls[i], primaryAcc, mods.critThreshold)) { rolls[i] = rng(); rerolled.push(i); left-- }
        }
    }

    // ── 6. Disarm: repetir todos los impactos, sin efectos de crit ──
    const disarmed = attacker.statusEffects.some(e => e.type === 'disarm')
    if (disarmed) {
        for (let i = 0; i < rolls.length; i++) {
            if (isHit(rolls[i], primaryAcc, mods.critThreshold)) { rolls[i] = rng(); rerolled.push(i) }
        }
        attacker.statusEffects = attacker.statusEffects.filter(e => e.type !== 'disarm')
        pushLog(state, player, `${attacker.name} está Disarmed: repite sus impactos y no puede hacer críticos`, 'attack')
    }

    const critCount = rolls.filter(r => r >= mods.critThreshold).length
    const critTriggered = critCount > 0 && !disarmed

    // Crit "Roll N additional dice"
    if (critTriggered && crit?.type === 'extra_dice') {
        for (let i = 0; i < (crit.amount ?? 2); i++) rolls.push(rng())
    }

    // ── 6b. After Attack Roll (efecto del arma y bonos de la activación) ──
    const primaryUnit = primary.kind === 'unit' ? state.units[primary.id] : null
    if (primaryUnit) {
        if (effect?.trigger === 'after_attack_roll') applyOnTarget(state, attackerId, primary.id, effect)
        if (state.activation?.unitId === attackerId && state.activation.destroyUpgradeOnHit) {
            destroyUpgrade(state, primary.id, 'any', 1)
        }
    }
    // Toss Away: "[After Attack Roll] If this unit is attacking, it Pushes 2 the target."
    const toss = hasAbilityType(state, attackerId, 'push_on_attack')
    if (toss !== null && primaryUnit?.position && attacker.position) {
        forceMove(state, hexKey(attacker.position), primary.id, toss, 'push', player)
        if (state.units[primary.id].position) primary.key = hexKey(state.units[primary.id].position!)
    }
    if (effect?.type === 'move_toward_target' && attacker.position) {
        stepToward(state, attackerId, primary.key, effect.amount ?? 1)
    }

    // ── 7. Efectos de crítico previos al daño ──
    if (critTriggered && crit && isCritEffect(crit, 'roll') && primaryUnit) {
        applyOnTarget(state, attackerId, primary.id, crit)
    }

    // ── 8. Daño ──
    const report: AttackReport = { attackerId, weaponName: weapon.name, rolls: [...rolls], rerolled, targets: [] }
    for (const t of targets) {
        const acc = t === primary ? primaryAcc : accFor(t)
        const hits = rolls.filter(r => isHit(r, acc, mods.critThreshold)).length
        const crits = rolls.filter(r => r >= mods.critThreshold).length
        if (t.kind === 'garrison') {
            const destroyed = hits > 0 && destroyGarrison(state, t.key, player)
            report.targets.push({ id: t.id, kind: 'garrison', hits, crits, damage: hits > 0 ? 1 : 0, defeated: destroyed })
            continue
        }
        let damage = hits
        if (hits > 0 || critTriggered) damage += bonusDamage(state, attackerId, weapon, critTriggered, crits, t)
        const { dealt, defeated } = damageUnit(state, t.id, damage, { combat: true })
        report.targets.push({ id: t.id, kind: 'unit', hits, crits, damage: dealt, defeated })
    }

    // ── 9. After Combat Damage ──
    for (const t of report.targets) {
        if (t.kind !== 'unit') continue
        const alive = !!state.units[t.id]?.position
        if (effect?.trigger === 'after_combat_damage' && t.damage > 0 && alive) applyOnTarget(state, attackerId, t.id, effect)
        if (critTriggered && crit && isCritEffect(crit, 'damage') && (t.id === primary.id || isStatusEffect(crit))) {
            // Los efectos de crit se aplican aunque los Shields eviten todo el daño.
            if (crit.type === 'repeat_attack') continue
            if (alive || crit.target === 'self' || crit.type === 'gain_upgrade' || crit.type === 'free_dash') {
                applyOnTarget(state, attackerId, t.id, crit)
            }
        }
    }

    // Stunning Shot: cada objetivo dañado avanza en el Timeline.
    const stun = hasAbilityType(state, attackerId, 'stun_on_damage')
    if (stun !== null) {
        for (const t of report.targets) {
            if (t.kind === 'unit' && t.damage > 0 && state.units[t.id]?.position) state.timeline = advanceToken(state.timeline, t.id, stun)
        }
    }
    // Crowd Control: si dañó a 2 o más enemigos, roba 1 carta.
    const crowd = hasAbilityType(state, attackerId, 'draw_on_multi_damage')
    if (crowd !== null && report.targets.filter(t => t.damage > 0).length >= 2) {
        const tactics = state.players[player].tactics
        tactics.hand.push(...tactics.deck.splice(0, crowd))
    }

    // Repetir el ataque a TL 0 (Beam Sabers de Aerial, Handguns de Vidar)
    if (critTriggered && crit?.type === 'repeat_attack' && !opts.isRepeat) {
        const target = targetAt(state, primary.key, player)
        if (target && attacker.position) {
            pushLog(state, player, `${attacker.name} repite el ataque (${weapon.name}) a TL 0`, 'attack')
            const again = resolveAttack(state, attackerId, { ...weapon, critData: null }, primary.key, rng, { isRepeat: true })
            report.rolls.push(...again.rolls)
            for (const t of again.targets) report.targets.push(t)
        }
    }

    state.lastAttack = report
    return report
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

