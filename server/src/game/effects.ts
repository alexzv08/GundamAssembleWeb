// Habilidades de unidad (Ongoing / Command / Response automáticas) y cartas de
// Tactics. Las funciones que reciben `state` lo MUTAN (el llamador clona).
import type { GameState, PlayerId, HexCoord, AbilityEffect } from '../types'
import type { CardEffect, PendingResponse } from '../types/tactics'
import { hexKey, getNeighbors, gridDistance, checkLineOfSight, findPath } from './hexGrid'
import { upgradeCount, enemyHexes, moveOptionsFor, rwsDeployHexes, alliedRws, rwsAdjacentTo, isEmptyHex, targetAt } from './queries'
import { damageUnit, damageAt, destroyGarrison, forceMove, pushLog } from './damage'
import { advanceToken } from './timeline'
import { captureObjective } from './victory'

export interface EffectResult {
    success: boolean
    error?: string
}
const ok: EffectResult = { success: true }
const fail = (error: string): EffectResult => ({ success: false, error })

// ─── MODIFICADORES DE ATAQUE (habilidades Ongoing + bonos de la activación) ──

export interface AttackModifiers {
    strengthBonus: number
    accuracyBonus: number
    critThreshold: number     // valor natural del d10 que cuenta como crit (9 por defecto)
    rerollMisses: number
}

export function getAttackModifiers(
    state: GameState, unitId: string, weaponName: string, primaryTargetId: string | null,
): AttackModifiers {
    const unit = state.units[unitId]
    const target = primaryTargetId ? state.units[primaryTargetId] : null
    const act = state.activation?.unitId === unitId ? state.activation : null

    const mods: AttackModifiers = {
        strengthBonus: upgradeCount(unit, 'attack') + (act?.strengthBonus ?? 0) + (act?.weaponStrengthBonus[weaponName] ?? 0),
        accuracyBonus: act?.accuracyBonus ?? 0,
        critThreshold: 9,
        rerollMisses: 0,
    }

    for (const ability of unit.abilities) {
        const d = ability.abilityData
        if (ability.type !== 'ONG' || !d) continue
        const meetsUpgrades = upgradeCount(unit, d.upgradeType ?? 'any') >= (d.requiredUpgrades ?? 0)
        switch (d.type) {
            case 'extended_crit_threshold':
                if (meetsUpgrades) mods.critThreshold = Math.min(mods.critThreshold, d.threshold ?? 7)
                break
            case 'accuracy_bonus':
                if (meetsUpgrades) mods.accuracyBonus += d.amount ?? 0
                break
            case 'strength_vs_damaged':
                if (target && target.currentHp < target.maxHp) mods.strengthBonus += d.amount ?? 0
                break
            case 'strength_vs_status':
                if (target && target.statusEffects.length > 0) mods.strengthBonus += d.amount ?? 0
                break
            case 'strength_per_damage_taken': {
                const taken = unit.maxHp - unit.currentHp
                for (const step of d.steps ?? []) if (taken >= step.damage) mods.strengthBonus += step.strength
                break
            }
            case 'firing_line':
                if (!act?.moved) {
                    mods.accuracyBonus += d.accuracy ?? 1
                    mods.strengthBonus += d.strength ?? 1
                }
                break
            case 'strength_per_ally_nearby': {
                if (!unit.position) break
                const allies = Object.values(state.units).filter(u =>
                    u.id !== unitId && u.playerId === unit.playerId && u.position &&
                    gridDistance(unit.position!, u.position) <= (d.range ?? 3))
                mods.strengthBonus += allies.length * (d.amount ?? 2)
                break
            }
            case 'reroll_one_miss':
                mods.rerollMisses = Math.max(mods.rerollMisses, d.amount ?? 1)
                break
        }
    }
    return mods
}

// ─── RESPONSE AUTOMÁTICAS DE UNIDAD ──────────────────────────────────────────

function firstAdjacentEnemyUnit(state: GameState, unitId: string): string | null {
    const unit = state.units[unitId]
    if (!unit?.position) return null
    for (const n of getNeighbors(unit.position)) {
        const occ = state.board[hexKey(n)]?.occupiedBy
        if (occ && state.units[occ]?.playerId !== unit.playerId) return occ
    }
    return null
}

// Char Kick: "After this unit Dashes: It deals [Damage 1] to an adjacent enemy."
export function triggerAfterDash(state: GameState, unitId: string): void {
    const unit = state.units[unitId]
    for (const a of unit.abilities) {
        if (a.abilityData?.type !== 'damage_after_dash' || !unit.position) continue
        const enemy = firstAdjacentEnemyUnit(state, unitId)
        if (!enemy) continue
        pushLog(state, unit.playerId, `${a.name}: ${state.units[enemy].name} recibe ${a.abilityData.amount ?? 1} de daño`, 'ability')
        damageUnit(state, enemy, a.abilityData.amount ?? 1)
    }
}

// Blitzing Slash: "After this unit ends its movement: It deals [Damage 1] to
// each enemy it moved adjacent to." `before` = hexes enemigos adyacentes al empezar.
export function triggerAfterMove(state: GameState, unitId: string, before: Set<string>): void {
    const unit = state.units[unitId]
    if (!unit.position || !unit.abilities.some(a => a.abilityData?.type === 'damage_after_move')) return
    const newly = getNeighbors(unit.position).map(hexKey).filter(key => {
        if (before.has(key)) return false
        const hex = state.board[key]
        const isEnemyUnit = hex?.occupiedBy && state.units[hex.occupiedBy]?.playerId !== unit.playerId
        const isEnemyGarrison = hex?.garrisonToken && hex.garrisonToken.owner !== unit.playerId
        return isEnemyUnit || isEnemyGarrison
    })
    if (newly.length === 0) return
    const data = useResponseAbility(state, unitId, 'damage_after_move')
    if (!data) return
    for (const key of newly) damageAt(state, key, data.amount ?? 1, unit.playerId)
}

// Habilidades Response automáticas: se usan cuando se cumple su condición. Si
// tienen coste de Energy, solo si la unidad puede pagarlo (y lo paga).
export function useResponseAbility(state: GameState, unitId: string, type: string): AbilityEffect | null {
    const unit = state.units[unitId]
    const ability = unit?.abilities.find(a => (a.type === 'RSP' || a.type === 'ONG') && a.abilityData?.type === type)
    if (!ability?.abilityData) return null
    const cost = ability.energyCost ?? 0
    if (unit.energy < cost) return null
    unit.energy -= cost
    pushLog(state, unit.playerId, `${unit.name} usa "${ability.name}"${cost ? ` (−${cost} Energy)` : ''}`, 'ability')
    return ability.abilityData
}

export function adjacentEnemyKeys(state: GameState, unitId: string): Set<string> {
    const unit = state.units[unitId]
    const enemies = enemyHexes(state, unit.playerId)
    return new Set((unit.position ? getNeighbors(unit.position) : []).map(hexKey).filter(k => enemies.has(k)))
}

// Escape from Side 7 / Supply: "After this unit Rescues a Garrison: Gain ..."
export function triggerAfterRescue(state: GameState, unitId: string): void {
    const unit = state.units[unitId]
    for (const a of unit.abilities) {
        const d = a.abilityData
        if (!d) continue
        if (d.type === 'gain_after_rescue') {
            gainUpgrade(state, unitId, d.upgradeType ?? 'energy', d.amount ?? 1)
            pushLog(state, unit.playerId, `${a.name}: ${unit.name} gana ${d.upgradeType ?? 'energy'}`, 'ability')
        }
        if (d.type === 'heal_ally_after_rescue') {
            const ally = Object.values(state.units).find(u =>
                u.id !== unitId && u.playerId === unit.playerId && u.position && u.currentHp < u.maxHp)
            if (ally) ally.currentHp = Math.min(ally.maxHp, ally.currentHp + (d.amount ?? 2))
        }
    }
}

export function gainUpgrade(state: GameState, unitId: string, type: string, amount = 1): void {
    const unit = state.units[unitId]
    if (!unit) return
    if (type === 'energy') { unit.energy += amount; return }
    for (let i = 0; i < amount; i++) {
        const t = type as 'attack' | 'movement' | 'shield'
        unit.upgrades.push(t === 'shield' ? { type: t, value: 1, active: true } : { type: t, value: 1 })
    }
}

export function destroyUpgrade(state: GameState, unitId: string, type: string, amount = 1): void {
    const unit = state.units[unitId]
    if (!unit) return
    let remaining = amount
    unit.upgrades = unit.upgrades.filter(u => {
        if (remaining > 0 && (type === 'any' || u.type === type)) { remaining--; return false }
        return true
    })
}

export function addStatus(state: GameState, unitId: string, status: 'slow' | 'fracture' | 'disarm'): void {
    const unit = state.units[unitId]
    if (!unit?.position) return   // en la Reserva no se reciben estados
    if (!unit.statusEffects.some(e => e.type === status)) unit.statusEffects.push({ type: status })
}

// ─── RESCATE (compartido por la acción RESCUE y efectos que rescatan) ─────────

export function rescueGarrison(state: GameState, unitId: string, garrisonKey: string): void {
    const unit = state.units[unitId]
    state.board[garrisonKey].garrisonToken = null
    state.players[unit.playerId].vp += 2
    state.players[unit.playerId].garrisonsRescued += 1
    pushLog(state, unit.playerId, `${unit.name} rescató una Garrison (+2 VP)`, 'objective',
        [unit.position ? hexKey(unit.position) : '', garrisonKey].filter(Boolean))
    triggerAfterRescue(state, unitId)
}

// ─── MOVIMIENTO POR HABILIDAD ("Move N") ─────────────────────────────────────

export function moveUnitTo(state: GameState, unitId: string, to: HexCoord, path: HexCoord[]): void {
    const unit = state.units[unitId]
    const before = adjacentEnemyKeys(state, unitId)
    const fromKey = hexKey(unit.position!)
    const toKey = hexKey(to)
    state.board[fromKey].occupiedBy = null
    state.board[toKey].occupiedBy = unitId
    unit.position = to
    if (state.activation?.unitId === unitId) state.activation.moved = true
    collectTokens(state, unitId)
    pushLog(state, unit.playerId, `${unit.name} se mueve de (${path[0].q},${path[0].r}) a (${to.q},${to.r})`, 'move', [fromKey, toKey])
    triggerAfterMove(state, unitId, before)
}

// Recoger Upgrades / Energy al terminar un movimiento (o desplegar) en su hex.
export function collectTokens(state: GameState, unitId: string): void {
    const unit = state.units[unitId]
    if (!unit?.position) return
    const hex = state.board[hexKey(unit.position)]
    const token = hex?.upgradeToken
    if (!token) return
    hex.upgradeToken = null
    gainUpgrade(state, unitId, token.type, token.value || 1)
    pushLog(state, unit.playerId, `${unit.name} recoge un Upgrade (${token.type})`, 'move', [hexKey(unit.position)])
}

function abilityMove(state: GameState, unitId: string, amount: number, to: HexCoord | undefined, ignoreEngagement = false): EffectResult {
    const unit = state.units[unitId]
    if (!unit.position) return fail('La unidad no está en el tablero')
    if (!to) return fail('Elige el hex de destino')
    const path = findPath(unit.position, to, state.board,
        moveOptionsFor(state, unitId, { kind: 'move', base: amount, ignoreEngagement }))
    if (!path) return fail('Destino no alcanzable')
    moveUnitTo(state, unitId, to, path)
    return ok
}

// ─── HABILIDADES COMMAND ──────────────────────────────────────────────────────

export function applyCommandAbility(
    state: GameState, unitId: string, abilityIndex: number, playerId: PlayerId,
    targetId: string | undefined, targetHex: HexCoord | undefined, rng: () => number,
): EffectResult {
    const unit = state.units[unitId]
    const ability = unit.abilities[abilityIndex]
    const d = ability.abilityData!
    const act = state.activation!

    const enemyTarget = (range: number, adjacentOnly?: boolean) => {
        if (!targetId) return fail('Elige un objetivo')
        const t = state.units[targetId]
        if (!t?.position || t.playerId === playerId) return fail('Objetivo no válido')
        const dist = gridDistance(unit.position!, t.position)
        if (adjacentOnly ? dist !== 1 : dist > range) return fail(adjacentOnly ? 'Debe ser adyacente' : `Fuera de alcance (${range})`)
        if (dist > 1) {
            const blockers = enemyHexes(state, playerId)
            blockers.delete(hexKey(t.position))
            if (!checkLineOfSight(unit.position!, t.position, state.board, blockers).clear) return fail('Sin línea de visión')
        }
        return null
    }

    switch (d.type) {
        case 'buff_activation':
            act.strengthBonus += d.strength ?? 0
            act.accuracyBonus += d.accuracy ?? 0
            if (d.destroyUpgradeOnHit) act.destroyUpgradeOnHit = true
            return ok

        case 'status_enemy': {
            if (!unit.position) return fail('La unidad no está en el tablero')
            const err = enemyTarget(d.range ?? 1, d.adjacentOnly)
            if (err) return err
            addStatus(state, targetId!, d.status ?? 'slow')
            return ok
        }

        case 'push_and_damage': {
            if (!unit.position) return fail('La unidad no está en el tablero')
            const err = enemyTarget(1, true)
            if (err) return err
            forceMove(state, hexKey(unit.position), targetId!, d.amount ?? 2, 'push', playerId)
            damageUnit(state, targetId!, 1)
            return ok
        }

        case 'move': {
            if (d.requiresObjectives) {
                const controlled = Object.values(state.board).filter(h => h.objectiveToken?.controlledBy === playerId).length
                if (controlled < d.requiresObjectives) return fail(`Necesitas controlar ${d.requiresObjectives} Objetivos`)
            }
            const res = abilityMove(state, unitId, d.amount ?? 2, targetHex)
            if (!res.success) return res
            // Frenzied Charge: "Beam Saber gains [Strength +1] this activation for each Garrison you've Rescued."
            if (d.strength && ability.description.includes('Beam Saber')) {
                act.weaponStrengthBonus['Beam Saber'] = (act.weaponStrengthBonus['Beam Saber'] ?? 0) +
                    d.strength * state.players[playerId].garrisonsRescued
            } else if (d.strength) {
                act.strengthBonus += d.strength
            }
            return ok
        }

        case 'self_damage_move': {
            if (!targetHex) return fail('Elige el hex de destino')
            damageUnit(state, unitId, d.amount ?? 3)
            if (!state.units[unitId].position) return ok   // se ha derrotado a sí misma
            return abilityMove(state, unitId, d.range ?? 2, targetHex)
        }

        case 'rescue_at_range': {
            if (!unit.position) return fail('La unidad no está en el tablero')
            const entry = Object.entries(state.board).find(([, h]) =>
                h.garrisonToken?.owner === playerId && gridDistance(unit.position!, h.coord) <= (d.range ?? 3) &&
                (!targetId || h.garrisonToken.id === targetId))
            if (!entry) return fail('No hay Garrisons aliadas a ese alcance')
            rescueGarrison(state, unitId, entry[0])
            return ok
        }

        case 'grant_free_attack': {
            const idx = unit.weapons.findIndex(w => w.name === d.weapon)
            if (idx === -1) return fail(`La unidad no tiene ${d.weapon}`)
            if (d.requiresWeapon) {
                const req = unit.weapons.findIndex(w => w.name === d.requiresWeapon)
                if (!act.attacksMade.includes(req)) return fail(`Primero debes atacar con ${d.requiresWeapon}`)
            }
            act.freeAttacks.push(idx)
            return ok
        }

        case 'saturated_fire': {
            // "Roll 5 dice. For each [Crit], deal 1 [Damage] to each enemy unit within [Range 4]."
            if (!unit.position) return fail('La unidad no está en el tablero')
            const rolls = Array.from({ length: d.dice ?? 5 }, rng)
            const crits = rolls.filter(r => r >= 9).length
            pushLog(state, playerId, `${ability.name}: [${rolls.join(', ')}] → ${crits} crit`, 'ability')
            if (crits > 0) {
                for (const enemy of Object.values(state.units)) {
                    if (enemy.playerId !== playerId && enemy.position && gridDistance(unit.position, enemy.position) <= (d.range ?? 4)) {
                        damageUnit(state, enemy.id, crits)
                    }
                }
            }
            return ok
        }

        case 'deploy_rws': {
            // "Deploy or reposition this unit's <RWS> on an empty hex within [Range N]."
            const rws = Object.values(state.rws ?? {}).find(r => r.ownerUnitId === unitId && r.kind === d.rws)
            if (!rws) return fail('Esta unidad no tiene ese RWS')
            if (!targetHex) return fail('Elige un hex vacío')
            const key = hexKey(targetHex)
            if (!rwsDeployHexes(state, unitId, d.range ?? 3).includes(key)) return fail('Ese hex no está vacío o está fuera de alcance')
            placeRws(state, rws.id, targetHex)
            return ok
        }

        case 'capture_objective': {
            if (!unit.position) return fail('La unidad no está en el tablero')
            const entry = Object.entries(state.board).find(([, h]) =>
                h.objectiveToken && gridDistance(unit.position!, h.coord) <= (d.range ?? 1))
            if (!entry) return fail('No hay objetivos a ese alcance')
            captureObjective(state, entry[0], playerId)
            return ok
        }

        default:
            return fail(`"${ability.name}" aún no está implementada`)
    }
}

// ─── CARTAS COMMAND ───────────────────────────────────────────────────────────

export function applyCardEffect(
    state: GameState, playerId: PlayerId, unitId: string, effect: CardEffect,
    targetId?: string, targetHex?: HexCoord,
): EffectResult {
    const unit = state.units[unitId]
    if (!unit) return fail('Unidad no encontrada')

    const enemyInRange = (range: number) => {
        if (!targetId) return fail('Necesita un objetivo')
        const t = state.units[targetId]
        if (!t?.position || t.playerId === playerId) return fail('Objetivo no válido')
        if (!unit.position) return fail('La unidad no está en el tablero')
        if (gridDistance(unit.position, t.position) > range) return fail(`Fuera de alcance (${range})`)
        return null
    }

    switch (effect.type) {
        case 'heal_per_upgrade':
            unit.currentHp = Math.min(unit.maxHp, unit.currentHp + unit.upgrades.length)
            return ok

        case 'destroy_upgrade_and_slow':
        case 'destroy_upgrade_and_fracture': {
            const err = enemyInRange(effect.range ?? 3)
            if (err) return err
            destroyUpgrade(state, targetId!, 'any', 1)
            addStatus(state, targetId!, effect.type === 'destroy_upgrade_and_slow' ? 'slow' : 'fracture')
            return ok
        }

        case 'aoe_damage': {
            if (!unit.position) return fail('La unidad no está en el tablero')
            const range = effect.range ?? 3
            for (const enemy of Object.values(state.units)) {
                if (enemy.playerId === playerId || !enemy.position) continue
                if (gridDistance(unit.position, enemy.position) <= range) damageUnit(state, enemy.id, effect.amount ?? 2)
            }
            for (const [key, hex] of Object.entries(state.board)) {
                if (hex.garrisonToken && hex.garrisonToken.owner !== playerId &&
                    gridDistance(unit.position, hex.coord) <= range) destroyGarrison(state, key, playerId)
            }
            return ok
        }

        case 'gain_shield_and_capture_objective': {
            gainUpgrade(state, unitId, 'shield')
            if (unit.position) {
                for (const [key, hex] of Object.entries(state.board)) {
                    if (hex.objectiveToken && gridDistance(unit.position, hex.coord) <= 1) captureObjective(state, key, playerId)
                }
            }
            return ok
        }

        case 'move_and_push': {
            // "Your active unit Moves 2. Then Push 1 an adjacent enemy unit and deal 1 [Damage] to it."
            if (targetHex) {
                const res = abilityMove(state, unitId, effect.range ?? 2, targetHex)
                if (!res.success) return res
            }
            const pos = state.units[unitId].position
            if (!pos) return ok
            const enemyId = targetId && state.units[targetId]?.position &&
                gridDistance(pos, state.units[targetId].position!) === 1
                ? targetId : firstAdjacentEnemyUnit(state, unitId)
            if (enemyId) {
                forceMove(state, hexKey(pos), enemyId, 1, 'push', playerId)
                damageUnit(state, enemyId, effect.amount ?? 1)
            }
            return ok
        }

        // ── Cartas Command oficiales ──
        case 'gain_upgrade':
            gainUpgrade(state, unitId, effect.upgradeType ?? 'attack', effect.amount ?? 1)
            return ok

        case 'repair': {
            unit.currentHp = Math.min(unit.maxHp, unit.currentHp + (effect.amount ?? 0))
            if (effect.energyIfFull && unit.currentHp === unit.maxHp) unit.energy += effect.energyIfFull
            return ok
        }

        case 'energy_if_rescued':
            if (state.players[playerId].garrisonsRescued < (effect.threshold ?? 3)) {
                return fail(`Necesitas haber rescatado ${effect.threshold ?? 3} Garrisons`)
            }
            unit.energy += effect.amount ?? 2
            return ok

        case 'status_adjacent':
        case 'push_adjacent': {
            if (!unit.position) return fail('La unidad no está en el tablero')
            const t = targetId ? unitById(state, targetId) : null
            if (!t?.position || t.playerId === playerId || gridDistance(unit.position, t.position) !== 1) {
                return fail('Elige un enemigo adyacente')
            }
            if (effect.type === 'status_adjacent') addStatus(state, t.id, effect.status ?? 'fracture')
            else forceMove(state, hexKey(unit.position), t.id, effect.amount ?? 2, 'push', playerId)
            return ok
        }

        case 'free_attack': {
            const idx = unit.weapons.findIndex(w => w.name === effect.weapon)
            if (idx === -1) return fail(`La unidad no tiene ${effect.weapon}`)
            state.activation?.freeAttacks.push(idx)
            return ok
        }

        case 'damage_per_own_upgrade': {
            const t = targetId ? unitById(state, targetId) : null
            if (!unit.position || !t?.position || t.playerId === playerId) return fail('Elige un enemigo')
            if (gridDistance(unit.position, t.position) > (effect.range ?? 2)) return fail(`Fuera de alcance (${effect.range ?? 2})`)
            const blockers = enemyHexes(state, playerId)
            blockers.delete(hexKey(t.position))
            if (gridDistance(unit.position, t.position) > 1 && !checkLineOfSight(unit.position, t.position, state.board, blockers).clear) {
                return fail('Sin línea de visión')
            }
            damageUnit(state, t.id, unit.upgrades.length)
            return ok
        }

        case 'aoe_status': {
            if (!unit.position) return fail('La unidad no está en el tablero')
            if (effect.requiresActiveTrait && !unit.traits.includes(effect.requiresActiveTrait)) {
                return fail(`La unidad activa debe tener el rasgo ${effect.requiresActiveTrait}`)
            }
            for (const enemy of Object.values(state.units)) {
                if (enemy.playerId !== playerId && enemy.position && gridDistance(unit.position, enemy.position) <= (effect.range ?? 3)) {
                    addStatus(state, enemy.id, effect.status ?? 'disarm')
                }
            }
            return ok
        }

        case 'activation_move_buff': {
            if (effect.requiresActiveTrait && !unit.traits.includes(effect.requiresActiveTrait)) {
                return fail(`La unidad activa debe tener el rasgo ${effect.requiresActiveTrait}`)
            }
            if (state.activation) {
                state.activation.speedBonus += effect.amount ?? 0
                if (effect.hover) state.activation.hover = true
            }
            return ok
        }

        case 'move': {
            const res = abilityMove(state, unitId, effect.amount ?? 2, targetHex)
            // Bulwark Siege: "Moves 2. Then, it applies [Fracture] to each enemy unit within [Range 2]."
            const pos = state.units[unitId].position
            if (res.success && effect.thenStatus && pos) {
                for (const enemy of Object.values(state.units)) {
                    if (enemy.playerId !== playerId && enemy.position && gridDistance(pos, enemy.position) <= (effect.thenRange ?? 2)) {
                        addStatus(state, enemy.id, effect.thenStatus)
                    }
                }
            }
            return res
        }

        case 'destroy_upgrades': {
            // Breaker Sweep: "destroys up to 2 Upgrades on an enemy unit within [Range 2]"
            const t = targetId ? unitById(state, targetId) : null
            if (!unit.position || !t?.position || t.playerId === playerId) return fail('Elige un enemigo')
            if (gridDistance(unit.position, t.position) > (effect.range ?? 2)) return fail(`Fuera de alcance (${effect.range ?? 2})`)
            destroyUpgrade(state, t.id, 'any', effect.amount ?? 2)
            return ok
        }

        case 'strength_if_garrisons_defeated': {
            // Systematic Elimination: +4 Strength si has derrotado 3 o más Garrisons
            if ((state.players[playerId].garrisonsDefeated ?? 0) < (effect.threshold ?? 3)) {
                return fail(`Necesitas haber derrotado ${effect.threshold ?? 3} Garrisons`)
            }
            if (state.activation) state.activation.strengthBonus += effect.strength ?? 4
            return ok
        }

        // ── Cartas de RWS ──
        case 'rws_damage': {
            // Drone Assault: cada RWS aliada hace [Damage 1] a un enemigo adyacente
            for (const r of alliedRws(state, playerId)) {
                const enemy = getNeighbors(r.position!).map(hexKey).map(k => targetAt(state, k, playerId)).find(t => t?.kind === 'unit')
                if (enemy) damageUnit(state, enemy.id, effect.amount ?? 1)
            }
            return ok
        }

        case 'dismantle': {
            // "destroys all Upgrades on an enemy unit adjacent to an allied RWS"
            const t = targetId ? unitById(state, targetId) : null
            if (!t?.position || t.playerId === playerId) return fail('Elige un enemigo')
            if (rwsAdjacentTo(state, hexKey(t.position), playerId).length === 0) return fail('El enemigo debe estar junto a una RWS aliada')
            t.upgrades = []
            return ok
        }

        case 'reposition_near_rws': {
            // Iśvara Assault: recoloca a la unidad junto a su RWS y +2 de daño esta activación
            const rws = alliedRws(state, playerId, effect.rws).find(r => r.ownerUnitId === unitId)
            if (!rws) return fail('Tu RWS no está en el tablero')
            if (!targetHex) return fail('Elige un hex junto a tu RWS')
            const key = hexKey(targetHex)
            if (gridDistance(targetHex, rws.position!) !== 1 || !isEmptyHex(state, key)) return fail('Elige un hex vacío junto a tu RWS')
            if (unit.position) state.board[hexKey(unit.position)].occupiedBy = null
            state.board[key].occupiedBy = unitId
            unit.position = targetHex
            if (state.activation) { state.activation.moved = true; state.activation.damageBonus += effect.damage ?? 2 }
            return ok
        }

        case 'rws_timeline_push': {
            // Cold Silence: los enemigos adyacentes a su Corax avanzan 1 en el Timeline
            const rws = alliedRws(state, playerId, effect.rws).find(r => r.ownerUnitId === unitId)
            if (!rws) return fail('Tu RWS no está en el tablero')
            for (const t of getNeighbors(rws.position!).map(hexKey).map(k => targetAt(state, k, playerId))) {
                if (t?.kind === 'unit') state.timeline = advanceToken(state.timeline, t.id, effect.amount ?? 1)
            }
            return ok
        }

        case 'free_dash_and_attack': {
            // Crimson Execution: Dash adicional a TL 0 y luego un ataque adicional a TL 0
            const idx = unit.weapons.findIndex(w => w.name === effect.weapon)
            if (idx === -1) return fail(`La unidad no tiene ${effect.weapon}`)
            if (state.activation) {
                state.activation.freeDashes += 1
                state.activation.freeAttacks.push(idx)
            }
            return ok
        }

        case 'move_and_rescue': {
            // "Moves 5. After it ends its movement, it Rescues each allied Garrison it moved adjacent to."
            const before = new Set(Object.entries(state.board)
                .filter(([, h]) => h.garrisonToken?.owner === playerId && unit.position && gridDistance(h.coord, unit.position) <= 1)
                .map(([k]) => k))
            const res = abilityMove(state, unitId, effect.amount ?? 5, targetHex)
            if (!res.success) return res
            const pos = state.units[unitId].position!
            for (const [k, h] of Object.entries(state.board)) {
                if (h.garrisonToken?.owner === playerId && gridDistance(h.coord, pos) <= 1 && !before.has(k)) rescueGarrison(state, unitId, k)
            }
            return ok
        }

        case 'steal_upgrade': {
            // "takes an [Energy] and 1 Upgrade from a unit within [Range 3]"
            const t = targetId ? unitById(state, targetId) : null
            if (!unit.position || !t?.position || t.id === unitId) return fail('Elige otra unidad')
            if (gridDistance(unit.position, t.position) > (effect.range ?? 3)) return fail(`Fuera de alcance (${effect.range ?? 3})`)
            if (t.energy > 0) { t.energy -= 1; unit.energy += 1 }
            const up = t.upgrades.shift()
            if (up) unit.upgrades.push(up.type === 'shield' ? { ...up, active: true } : up)
            return ok
        }

        default:
            return fail('Efecto de carta no implementado')
    }
}

function unitById(state: GameState, id: string) {
    return state.units[id] ?? null
}

// ─── CARTAS RESPONSE ──────────────────────────────────────────────────────────

export function applyResponseCardEffect(
    state: GameState, playerId: PlayerId, effect: CardEffect, context: PendingResponse,
    rng: () => number,
): EffectResult {
    switch (effect.type) {
        case 'reduce_incoming_damage': {
            // El daño ya se aplicó: se devuelve parcialmente.
            const defender = context.defenderUnitId ? state.units[context.defenderUnitId] : null
            if (!defender?.position) return fail('La unidad defensora ya no está en el tablero')
            defender.currentHp = Math.min(defender.maxHp, defender.currentHp + (effect.amount ?? 2))
            return ok
        }

        case 'counter_attack': {
            const defender = context.defenderUnitId ? state.units[context.defenderUnitId] : null
            const attacker = context.attackerUnitId ? state.units[context.attackerUnitId] : null
            if (!defender?.position) return fail('La unidad defensora ya no está en el tablero')
            if (!attacker?.position) return fail('El atacante ya no está en el tablero')
            const weapon = defender.weapons.find(w => gridDistance(defender.position!, attacker.position!) <= w.range)
            if (!weapon) return fail('El atacante está fuera del alcance de todas sus armas')
            let hits = 0
            for (let i = 0; i < weapon.strength; i++) {
                const r = rng()
                if (r !== 1 && r >= 4) hits++
            }
            damageUnit(state, attacker.id, hits, { combat: true })
            return ok
        }

        case 'gain_upgrade_after_rescue': {
            if (!context.rescuerUnitId) return fail('Sin contexto de rescate')
            gainUpgrade(state, context.rescuerUnitId, effect.upgradeType ?? 'shield')
            return ok
        }

        case 'retaliate_damage': {
            const defender = context.defenderUnitId ? state.units[context.defenderUnitId] : null
            const attacker = context.attackerUnitId ? state.units[context.attackerUnitId] : null
            if (!defender?.position) return fail('La unidad defensora no sobrevivió')
            if (!attacker?.position) return fail('El atacante ya no está en el tablero')
            damageUnit(state, attacker.id, effect.amount ?? 2)
            return ok
        }

        case 'damage_on_adjacent_enemy': {
            const moved = context.movedUnitId ? state.units[context.movedUnitId] : null
            if (!moved?.position) return fail('La unidad enemiga ya no está en el tablero')
            damageUnit(state, moved.id, effect.amount ?? 3)
            return ok
        }

        default:
            return fail('Efecto de respuesta no implementado')
    }
}

// ─── ROBAR CARTAS ─────────────────────────────────────────────────────────────

export function drawCards(state: GameState, playerId: PlayerId, count: number): GameState {
    const newState = structuredClone(state)
    const tactics = newState.players[playerId].tactics
    tactics.hand.push(...tactics.deck.splice(0, Math.min(count, tactics.deck.length)))
    return newState
}

export function hasAbilityType(state: GameState, unitId: string, type: string): number | null {
    const a = state.units[unitId]?.abilities.find(x => x.abilityData?.type === type)
    return a ? (a.abilityData?.amount ?? 1) : null
}

// Coloca (o recoloca) una RWS. Iśvara B Type "Beam Saber Drones": al
// desplegarse o recolocarse hace [Damage 1] a una unidad enemiga adyacente.
export function placeRws(state: GameState, rwsId: string, to: HexCoord): void {
    const rws = state.rws[rwsId]
    rws.position = to
    pushLog(state, rws.owner, `${rws.name} se despliega en (${to.q},${to.r})`, 'ability', [hexKey(to)])
    if (rws.kind === 'isvara') {
        const enemy = getNeighbors(to).map(hexKey).map(k => targetAt(state, k, rws.owner)).find(t => t?.kind === 'unit')
        if (enemy) damageUnit(state, enemy.id, 1)
    }
}

