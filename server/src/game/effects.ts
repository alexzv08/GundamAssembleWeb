import { GameState, PlayerId } from '../types'
import { WeaponEffect, AbilityEffect } from '../types/units'
import { CardEffect, PendingResponse } from '../types/tactics'
import { hexKey, getNeighbors, gridDistance } from './hexGrid'
import { advanceToken } from './timeline'

// ─── ATTACK CONTEXT ───────────────────────────────────────────────────────────

export interface AttackContext {
    attackerId: string
    targetId: string
    hits: number
    critCount: number
    damage: number
}

// ─── ATTACK MODIFIERS (from ONGOING abilities) ────────────────────────────────

export interface AttackModifiers {
    strengthBonus: number
    accuracyBonus: number
    critThreshold: number   // d10 value that counts as crit (default 9)
    rerollMisses: number
}

export function getOngoingModifiers(state: GameState, unitId: string, targetId: string): AttackModifiers {
    const unit = state.units[unitId]
    const target = state.units[targetId]

    const mods: AttackModifiers = {
        strengthBonus: 0,
        accuracyBonus: 0,
        critThreshold: 9,
        rerollMisses: 0,
    }

    for (const ability of unit.abilities) {
        if (ability.type !== 'ONG' || !ability.abilityData) continue
        const data = ability.abilityData as AbilityEffect

        switch (data.type) {
            case 'extended_crit_threshold':
                if (unit.upgrades.length >= (data.requiredUpgrades ?? 0)) {
                    mods.critThreshold = Math.min(mods.critThreshold, data.threshold ?? 8)
                }
                break
            case 'accuracy_bonus':
                if (unit.upgrades.length >= (data.requiredUpgrades ?? 0)) {
                    mods.accuracyBonus += data.amount ?? 0
                }
                break
            case 'strength_vs_damaged':
                if (target.currentHp < target.maxHp) {
                    mods.strengthBonus += data.amount ?? 0
                }
                break
            case 'reroll_one_miss':
                mods.rerollMisses = 1
                break
        }
    }

    return mods
}

export function getDashBonus(state: GameState, unitId: string): number {
    const unit = state.units[unitId]
    let bonus = 0
    for (const ability of unit.abilities) {
        if (ability.type !== 'ONG' || !ability.abilityData) continue
        const data = ability.abilityData as AbilityEffect
        if (data.type === 'dash_range_bonus') bonus += data.amount ?? 0
    }
    return bonus
}

// ─── WEAPON EFFECT APPLICATOR ─────────────────────────────────────────────────

export function applyWeaponEffect(effect: WeaponEffect, state: GameState, ctx: AttackContext): GameState {
    switch (effect.type) {
        case 'slow':         return addStatus(state, ctx.targetId, 'slow')
        case 'fracture':     return addStatus(state, ctx.targetId, 'fracture')
        case 'destroy_upgrade': return destroyUpgrade(state, ctx.targetId, effect.upgradeType ?? 'any', effect.amount ?? 1)
        case 'gain_upgrade': return gainUpgrade(state, ctx.attackerId, effect.upgradeType ?? 'attack')
        case 'splash_damage': return splashDamage(state, ctx.attackerId, ctx.targetId, effect.amount ?? 1)
        case 'push':         return pushTarget(state, ctx.attackerId, ctx.targetId, effect.amount ?? 1)
        default:             return state
    }
}

function addStatus(state: GameState, unitId: string, status: 'slow' | 'fracture' | 'disarm'): GameState {
    const unit = state.units[unitId]
    if (!unit || unit.currentHp <= 0) return state
    return {
        ...state,
        units: {
            ...state.units,
            [unitId]: {
                ...unit,
                statusEffects: [...unit.statusEffects.filter(e => e.type !== status), { type: status }]
            }
        }
    }
}

function destroyUpgrade(state: GameState, unitId: string, upgradeType: string, amount: number): GameState {
    const unit = state.units[unitId]
    if (!unit) return state
    let remaining = amount
    const upgrades = unit.upgrades.filter(u => {
        if (remaining > 0 && (upgradeType === 'any' || u.type === upgradeType)) {
            remaining--
            return false
        }
        return true
    })
    return { ...state, units: { ...state.units, [unitId]: { ...unit, upgrades } } }
}

function gainUpgrade(state: GameState, unitId: string, upgradeType: string): GameState {
    const unit = state.units[unitId]
    if (!unit) return state
    if (upgradeType === 'energy') {
        return { ...state, units: { ...state.units, [unitId]: { ...unit, energy: unit.energy + 1 } } }
    }
    const type = upgradeType as 'attack' | 'movement' | 'shield'
    return {
        ...state,
        units: { ...state.units, [unitId]: { ...unit, upgrades: [...unit.upgrades, { type, value: 1 }] } }
    }
}

function splashDamage(state: GameState, attackerId: string, targetId: string, amount: number): GameState {
    const target = state.units[targetId]
    const attacker = state.units[attackerId]
    if (!target?.position) return state

    let newState = state
    for (const neighbor of getNeighbors(target.position)) {
        const key = hexKey(neighbor)
        const hex = newState.board[key]
        if (!hex?.occupiedBy || hex.occupiedBy === targetId) continue
        const splashUnit = newState.units[hex.occupiedBy]
        if (!splashUnit || splashUnit.playerId === attacker.playerId) continue
        if (splashUnit.currentHp <= 0) continue

        const newHp = Math.max(0, splashUnit.currentHp - amount)
        newState = { ...newState, units: { ...newState.units, [hex.occupiedBy]: { ...splashUnit, currentHp: newHp } } }

        if (newHp <= 0) {
            newState = {
                ...newState,
                players: {
                    ...newState.players,
                    [attacker.playerId]: {
                        ...newState.players[attacker.playerId],
                        vp: newState.players[attacker.playerId].vp + splashUnit.vp
                    }
                },
                board: { ...newState.board, [key]: { ...newState.board[key], occupiedBy: null } },
                units: { ...newState.units, [hex.occupiedBy]: { ...newState.units[hex.occupiedBy], position: null, currentHp: splashUnit.maxHp } }
            }
        }
    }
    return newState
}

function pushTarget(state: GameState, attackerId: string, targetId: string, hexes: number): GameState {
    const attacker = state.units[attackerId]
    const target = state.units[targetId]
    if (!attacker?.position || !target?.position || target.currentHp <= 0) return state

    let newState = state
    let currentPos = target.position
    const attackerPos = attacker.position

    for (let i = 0; i < hexes; i++) {
        let bestNeighbor = null
        let maxDist = -1

        for (const n of getNeighbors(currentPos)) {
            const key = hexKey(n)
            if (!newState.board[key] || newState.board[key].occupiedBy) continue
            const dist = gridDistance(attackerPos, n)
            if (dist > maxDist) { maxDist = dist; bestNeighbor = n }
        }

        if (!bestNeighbor) break

        const oldKey = hexKey(currentPos)
        const newKey = hexKey(bestNeighbor)
        newState = {
            ...newState,
            board: {
                ...newState.board,
                [oldKey]: { ...newState.board[oldKey], occupiedBy: null },
                [newKey]: { ...newState.board[newKey], occupiedBy: targetId }
            },
            units: { ...newState.units, [targetId]: { ...newState.units[targetId], position: bestNeighbor } }
        }
        currentPos = bestNeighbor
    }
    return newState
}

// ─── HELPER: NEAR OBJECTIVE ───────────────────────────────────────────────────

export function isNearObjective(state: GameState, position: { q: number; r: number } | null): boolean {
    if (!position) return false
    for (const hex of Object.values(state.board)) {
        if (hex.objectiveToken && gridDistance(position, hex.coord) <= 1) return true
    }
    return false
}

// ─── RESPONSE ABILITY TRIGGERS ────────────────────────────────────────────────

export function triggerAfterDash(state: GameState, unitId: string): GameState {
    const unit = state.units[unitId]
    if (!unit?.position) return state

    let newState = state
    for (const ability of unit.abilities) {
        if (ability.type !== 'RSP' || !ability.abilityData) continue
        const data = ability.abilityData as AbilityEffect

        if (data.type === 'damage_after_dash') {
            const amount = data.amount ?? 1
            for (const neighbor of getNeighbors(unit.position)) {
                const key = hexKey(neighbor)
                const hex = newState.board[key]
                if (!hex?.occupiedBy) continue
                const adjacentUnit = newState.units[hex.occupiedBy]
                if (!adjacentUnit || adjacentUnit.playerId === unit.playerId || adjacentUnit.currentHp <= 0) continue

                const newHp = Math.max(0, adjacentUnit.currentHp - amount)
                newState = { ...newState, units: { ...newState.units, [hex.occupiedBy]: { ...adjacentUnit, currentHp: newHp } } }

                if (newHp <= 0) {
                    newState = {
                        ...newState,
                        players: {
                            ...newState.players,
                            [unit.playerId]: { ...newState.players[unit.playerId], vp: newState.players[unit.playerId].vp + adjacentUnit.vp }
                        },
                        board: { ...newState.board, [key]: { ...newState.board[key], occupiedBy: null } },
                        units: { ...newState.units, [hex.occupiedBy]: { ...newState.units[hex.occupiedBy], position: null, currentHp: adjacentUnit.maxHp } }
                    }
                }
                break
            }
        }
    }
    return newState
}

export function triggerAfterRescue(state: GameState, unitId: string): GameState {
    const unit = state.units[unitId]
    let newState = state

    for (const ability of unit.abilities) {
        if (ability.type !== 'RSP' || !ability.abilityData) continue
        const data = ability.abilityData as AbilityEffect

        if (data.type === 'heal_ally_after_rescue') {
            const amount = data.amount ?? 2
            for (const [allyId, ally] of Object.entries(newState.units)) {
                if (allyId === unitId || ally.playerId !== unit.playerId) continue
                if (ally.currentHp <= 0 || ally.currentHp >= ally.maxHp) continue
                newState = {
                    ...newState,
                    units: { ...newState.units, [allyId]: { ...ally, currentHp: Math.min(ally.maxHp, ally.currentHp + amount) } }
                }
                break
            }
        }
    }
    return newState
}

// ─── BURST ABILITY ────────────────────────────────────────────────────────────

export interface EffectResult {
    success: boolean
    newState?: GameState
    error?: string
}

export function applyBurstAbility(
    state: GameState,
    unitId: string,
    abilityIndex: number,
    playerId: PlayerId,
    targetId?: string
): EffectResult {
    const unit = state.units[unitId]
    if (!unit) return { success: false, error: 'Unidad no encontrada' }

    const ability = unit.abilities[abilityIndex]
    if (!ability || ability.type !== 'CMD') return { success: false, error: 'No es una habilidad BURST' }
    if (!ability.abilityData) return { success: false, error: `"${ability.name}" no está implementada aún` }

    const energyCost = ability.energyCost ?? 0
    if (energyCost > 0 && unit.energy < energyCost) return { success: false, error: 'Energía insuficiente' }

    const data = ability.abilityData as AbilityEffect
    let newState: GameState = JSON.parse(JSON.stringify(state))

    switch (data.type) {
        case 'fracture_enemy': {
            if (!targetId) return { success: false, error: 'Necesita un objetivo' }
            const target = newState.units[targetId]
            if (!target || target.currentHp <= 0) return { success: false, error: 'Objetivo inválido' }
            if (target.playerId === playerId) return { success: false, error: 'No puedes fracturar aliados' }
            if (!unit.position || !target.position) return { success: false, error: 'Unidad fuera del tablero' }
            if (gridDistance(unit.position, target.position) > (data.range ?? 3)) {
                return { success: false, error: `Fuera de rango ${data.range ?? 3}` }
            }
            newState.units[targetId].statusEffects = [
                ...target.statusEffects.filter(e => e.type !== 'fracture'),
                { type: 'fracture' }
            ]
            break
        }

        case 'saturated_fire': {
            if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }
            const numDice = data.dice ?? 5
            const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * 10) + 1)
            const critCount = rolls.filter(r => r >= 9).length

            if (critCount > 0) {
                const range = data.range ?? 4
                for (const enemy of Object.values(newState.units)) {
                    if (enemy.playerId === playerId || enemy.currentHp <= 0 || !enemy.position) continue
                    if (gridDistance(unit.position, enemy.position) > range) continue
                    enemy.currentHp = Math.max(0, enemy.currentHp - critCount)
                    if (enemy.currentHp <= 0) {
                        newState.players[playerId].vp += enemy.vp
                        if (enemy.position) { newState.board[hexKey(enemy.position)].occupiedBy = null; enemy.position = null }
                        enemy.currentHp = enemy.maxHp
                    }
                }
            }
            break
        }

        case 'capture_objective': {
            if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }
            let captured = false
            for (const [key, hex] of Object.entries(newState.board)) {
                if (!hex.objectiveToken) continue
                if (gridDistance(unit.position, hex.coord) > (data.range ?? 1)) continue
                newState.board[key].objectiveToken = { ...hex.objectiveToken, controlledBy: playerId }
                captured = true
            }
            if (!captured) return { success: false, error: 'No hay objetivos en rango' }
            break
        }

        default:
            return { success: false, error: `"${ability.name}" no implementada aún` }
    }

    if (energyCost > 0) newState.units[unitId].energy -= energyCost
    newState.timeline = advanceToken(newState.timeline, unitId, 2)
    newState.actionLog.push({ type: 'USE_ABILITY', unitId, abilityIndex, targetId })

    return { success: true, newState }
}

// ─── CARD EFFECT ──────────────────────────────────────────────────────────────

export function applyCardEffect(
    state: GameState,
    playerId: PlayerId,
    unitId: string,
    effect: CardEffect,
    targetId?: string
): EffectResult {
    let newState: GameState = JSON.parse(JSON.stringify(state))
    const unit = newState.units[unitId]
    if (!unit) return { success: false, error: 'Unidad no encontrada' }

    switch (effect.type) {
        case 'heal_per_upgrade': {
            const heal = unit.upgrades.length
            unit.currentHp = Math.min(unit.maxHp, unit.currentHp + heal)
            break
        }

        case 'destroy_upgrade_and_slow':
        case 'destroy_upgrade_and_fracture': {
            if (!targetId) return { success: false, error: 'Necesita un objetivo' }
            const target = newState.units[targetId]
            if (!target || target.playerId === playerId) return { success: false, error: 'Objetivo inválido' }
            if (!unit.position || !target.position) return { success: false, error: 'Unidades fuera del tablero' }
            if (gridDistance(unit.position, target.position) > (effect.range ?? 3)) {
                return { success: false, error: `Fuera de rango ${effect.range ?? 3}` }
            }
            if (target.upgrades.length > 0) target.upgrades.splice(0, 1)
            const statusType = effect.type === 'destroy_upgrade_and_slow' ? 'slow' : 'fracture'
            target.statusEffects = [...target.statusEffects.filter(e => e.type !== statusType), { type: statusType }]
            break
        }

        case 'aoe_damage': {
            if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }
            const range = effect.range ?? 3
            const amount = effect.amount ?? 2
            for (const enemy of Object.values(newState.units)) {
                if (enemy.playerId === playerId || enemy.currentHp <= 0 || !enemy.position) continue
                if (gridDistance(unit.position, enemy.position) > range) continue
                enemy.currentHp = Math.max(0, enemy.currentHp - amount)
                if (enemy.currentHp <= 0) {
                    newState.players[playerId].vp += enemy.vp
                    if (enemy.position) { newState.board[hexKey(enemy.position)].occupiedBy = null; enemy.position = null }
                    enemy.currentHp = enemy.maxHp
                }
            }
            for (const [key, hex] of Object.entries(newState.board)) {
                if (!hex.garrisonToken || hex.garrisonToken.owner === playerId) continue
                if (gridDistance(unit.position, hex.coord) > range) continue
                newState.board[key].garrisonToken = null
                newState.players[playerId].vp += 2
            }
            break
        }

        case 'gain_shield_and_capture_objective': {
            unit.upgrades.push({ type: 'shield', value: 1 })
            if (unit.position) {
                for (const [key, hex] of Object.entries(newState.board)) {
                    if (!hex.objectiveToken) continue
                    if (gridDistance(unit.position, hex.coord) <= 1) {
                        newState.board[key].objectiveToken = { ...hex.objectiveToken, controlledBy: playerId }
                    }
                }
            }
            break
        }

        default:
            return { success: false, error: 'Efecto de carta no implementado' }
    }

    return { success: true, newState }
}

// ─── RESPONSE CARD EFFECT ─────────────────────────────────────────────────────

export function applyResponseCardEffect(
    state: GameState,
    playerId: PlayerId,
    effect: CardEffect,
    context: PendingResponse,
    _targetId?: string
): EffectResult {
    let newState: GameState = JSON.parse(JSON.stringify(state))

    switch (effect.type) {
        case 'reduce_incoming_damage': {
            // T03: sanar al defensor 2 HP (el daño ya se aplicó, lo revertimos parcialmente)
            const defenderId = context.defenderUnitId
            if (!defenderId) return { success: false, error: 'Sin contexto de defensa' }
            const defender = newState.units[defenderId]
            if (!defender || defender.currentHp <= 0) return { success: false, error: 'La unidad defensora fue destruida' }
            defender.currentHp = Math.min(defender.maxHp, defender.currentHp + (effect.amount ?? 2))
            break
        }

        case 'counter_attack': {
            // T05: el defensor hace un ataque básico con su primera arma contra el atacante
            const defenderId = context.defenderUnitId
            const attackerId = context.attackerUnitId
            if (!defenderId || !attackerId) return { success: false, error: 'Sin contexto de ataque' }
            const defender = newState.units[defenderId]
            const attacker = newState.units[attackerId]
            if (!defender || defender.currentHp <= 0) return { success: false, error: 'La unidad defensora fue destruida' }
            if (!attacker || attacker.currentHp <= 0) return { success: false, error: 'El atacante ya fue destruido' }
            const weapon = defender.weapons[0]
            if (!weapon) return { success: false, error: 'El defensor no tiene armas' }

            const rolls = Array.from({ length: weapon.strength }, () => Math.floor(Math.random() * 10) + 1)
            const hits = rolls.filter(r => r >= 4).length
            const shieldAbsorb = attacker.upgrades.filter(u => u.type === 'shield').length
            const damage = Math.max(0, hits - shieldAbsorb)

            attacker.currentHp = Math.max(0, attacker.currentHp - damage)
            if (attacker.currentHp <= 0) {
                newState.players[playerId].vp += attacker.vp
                if (attacker.position) newState.board[hexKey(attacker.position)].occupiedBy = null
                attacker.position = null
                attacker.currentHp = attacker.maxHp
            }
            break
        }

        case 'gain_upgrade_after_rescue': {
            // T06 / T15: la unidad que rescató gana un upgrade
            const rescuerId = context.rescuerUnitId
            if (!rescuerId) return { success: false, error: 'Sin contexto de rescue' }
            const rescuer = newState.units[rescuerId]
            if (!rescuer) return { success: false, error: 'Unidad rescatadora no encontrada' }
            const upgradeType = effect.upgradeType ?? 'shield'
            if (upgradeType === 'energy') {
                rescuer.energy += 1
            } else {
                rescuer.upgrades.push({ type: upgradeType as 'attack' | 'shield' | 'movement', value: 1 })
            }
            break
        }

        case 'retaliate_damage': {
            // T18: si el defensor sobrevivió, devuelve daño al atacante
            const defenderId = context.defenderUnitId
            const attackerId = context.attackerUnitId
            if (!defenderId || !attackerId) return { success: false, error: 'Sin contexto de ataque' }
            const defender = newState.units[defenderId]
            const attacker = newState.units[attackerId]
            if (!defender || defender.currentHp <= 0) return { success: false, error: 'La unidad defensora fue destruida (no puede contraatacar)' }
            if (!attacker || attacker.currentHp <= 0) return { success: false, error: 'El atacante ya fue destruido' }

            const amount = effect.amount ?? 2
            attacker.currentHp = Math.max(0, attacker.currentHp - amount)
            if (attacker.currentHp <= 0) {
                newState.players[playerId].vp += attacker.vp
                if (attacker.position) newState.board[hexKey(attacker.position)].occupiedBy = null
                attacker.position = null
                attacker.currentHp = attacker.maxHp
            }
            break
        }

        case 'damage_on_adjacent_enemy': {
            // T16: la unidad enemiga que se movió adyacente recibe daño
            const movedUnitId = context.movedUnitId
            if (!movedUnitId) return { success: false, error: 'Sin contexto de movimiento' }
            const movedUnit = newState.units[movedUnitId]
            if (!movedUnit || movedUnit.currentHp <= 0) return { success: false, error: 'La unidad enemiga ya fue destruida' }

            const amount = effect.amount ?? 3
            movedUnit.currentHp = Math.max(0, movedUnit.currentHp - amount)
            if (movedUnit.currentHp <= 0) {
                newState.players[playerId].vp += movedUnit.vp
                if (movedUnit.position) newState.board[hexKey(movedUnit.position)].occupiedBy = null
                movedUnit.position = null
                movedUnit.currentHp = movedUnit.maxHp
            }
            break
        }

        default:
            return { success: false, error: 'Efecto de respuesta no implementado' }
    }

    return { success: true, newState }
}

// ─── CARD DRAW ────────────────────────────────────────────────────────────────

export function drawCards(state: GameState, playerId: PlayerId, count: number): GameState {
    const newState: GameState = JSON.parse(JSON.stringify(state))
    const tactics = newState.players[playerId].tactics
    const drawn = tactics.deck.splice(0, Math.min(count, tactics.deck.length))
    tactics.hand = [...tactics.hand, ...drawn]
    return newState
}
