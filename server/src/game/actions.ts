import { GameState, GameAction, PlayerId, LogCategory } from '../types'
import { hexKey, findPath, checkLineOfSight, gridDistance, getNeighbors } from './hexGrid'
import { advanceToken, getNextActivation, reorderSlotForTie, getCurrentRound } from './timeline'
import {
    getOngoingModifiers, getDashBonus, applyWeaponEffect, isNearObjective,
    triggerAfterDash, triggerAfterRescue, applyBurstAbility, applyCardEffect,
    applyResponseCardEffect, AttackContext
} from './effects'
import { PendingResponse } from '../types/tactics'

export interface ActionResult {
    success: boolean
    newState?: GameState
    error?: string
}

function validateTurn(state: GameState, unitId: string, playerId: PlayerId): string | null {
    if (state.activePlayerId !== playerId) return 'No es tu turno'
    if (state.activeUnitId !== unitId) return 'No es el turno de esta unidad'
    const unit = state.units[unitId]
    if (!unit) return 'Unidad no encontrada'
    if (unit.playerId !== playerId) return 'Esta unidad no es tuya'
    if (unit.currentHp <= 0) return 'La unidad está derrotada'
    return null
}

function getMovementObstacles(state: GameState, movingUnitId: string): Set<string> {
    const movingUnit = state.units[movingUnitId]
    const obstacles = new Set<string>()
    for (const unit of Object.values(state.units)) {
        if (unit.id === movingUnitId || unit.currentHp <= 0 || !unit.position) continue
        if (unit.playerId !== movingUnit.playerId) obstacles.add(hexKey(unit.position))
    }
    for (const hex of Object.values(state.board)) {
        if (hex.garrisonToken && hex.garrisonToken.owner !== movingUnit.playerId) {
            obstacles.add(hexKey(hex.coord))
        }
    }
    return obstacles
}

function getAlliedPositions(state: GameState, movingUnitId: string): Set<string> {
    const movingUnit = state.units[movingUnitId]
    const allied = new Set<string>()
    for (const unit of Object.values(state.units)) {
        if (unit.id === movingUnitId || unit.currentHp <= 0 || !unit.position) continue
        if (unit.playerId === movingUnit.playerId) allied.add(hexKey(unit.position))
    }
    return allied
}

function getEnemyUnitIds(state: GameState, playerId: PlayerId): Set<string> {
    const ids = new Set<string>()
    for (const unit of Object.values(state.units)) {
        if (unit.playerId !== playerId && unit.currentHp > 0 && unit.position) ids.add(unit.id)
    }
    return ids
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state))
}

function pushLog(state: GameState, playerId: PlayerId, message: string, category: LogCategory, hexes: string[] = []): void {
    state.log.push({ message, playerId, round: getCurrentRound(state.timeline), category, hexes })
}

function advanceToNextActivation(state: GameState): GameState {
    const lastPlayer = state.activePlayerId

    // Reordenar el slot activo para aplicar desempate por iniciativa (intercalado)
    const nextSlot = state.timeline.slots.find(s => s.tokens.length > 0)
    const newTimeline = nextSlot
        ? reorderSlotForTie(state.timeline, nextSlot.round, lastPlayer)
        : state.timeline

    const next = getNextActivation(newTimeline)
    if (!next) return {
        ...state,
        timeline: newTimeline,
        activeUnitId: null,
        activePlayerId: state.activePlayerId,
        lastActivePlayer: lastPlayer,
        hasUsedPrimaryAction: false,
    }
    return {
        ...state,
        timeline: newTimeline,
        activeUnitId: next.unitId,
        activePlayerId: next.playerId,
        lastActivePlayer: lastPlayer,
        hasUsedPrimaryAction: false,
    }
}

// ─── SPAWN ────────────────────────────────────────────────────────────────────

function spawnUnitIfNeeded(state: GameState, unitId: string): GameState {
    const unit = state.units[unitId]
    if (unit.position !== null) return state

    const deployHex = state.players[unit.playerId].deployHex
    if (!deployHex) return state

    const deployKey = hexKey(deployHex)
    if (state.board[deployKey] && !state.board[deployKey].occupiedBy) {
        const newState = cloneState(state)
        newState.units[unitId].position = deployHex
        newState.board[deployKey].occupiedBy = unitId
        return newState
    }

    for (const neighbor of getNeighbors(deployHex)) {
        const key = hexKey(neighbor)
        if (state.board[key] && !state.board[key].occupiedBy) {
            const newState = cloneState(state)
            newState.units[unitId].position = neighbor
            newState.board[key].occupiedBy = unitId
            return newState
        }
    }

    return state
}

// ─── ADVANCE ──────────────────────────────────────────────────────────────────

export function applyAdvance(
    state: GameState,
    unitId: string,
    to: { q: number; r: number },
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const unit = state.units[unitId]
    if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }

    const hasSlow = unit.statusEffects.some(e => e.type === 'slow')
    if (hasSlow) return { success: false, error: 'La unidad tiene Slow y no puede moverse' }

    const destKey = hexKey(to)
    if (!state.board[destKey]) return { success: false, error: 'Hex destino no existe en el tablero' }

    const obstacles = getMovementObstacles(state, unitId)
    const allied = getAlliedPositions(state, unitId)
    if (allied.has(destKey)) return { success: false, error: 'Ese hex está ocupado por una unidad aliada' }

    const maxMove = 3 + (unit.upgrades.find(u => u.type === 'movement')?.value ?? 0)
    const hasHover = unit.traits.includes('Hover')
    const path = findPath(unit.position, to, state.board, obstacles, maxMove, hasHover)
    if (!path) return { success: false, error: 'Movimiento no válido o fuera de rango' }

    const newState = cloneState(state)
    const newUnit = newState.units[unitId]

    const oldKey = hexKey(unit.position)
    if (newState.board[oldKey]) newState.board[oldKey].occupiedBy = null
    newUnit.position = to
    if (newState.board[destKey]) newState.board[destKey].occupiedBy = unitId

    const destHex = newState.board[destKey]
    if (destHex?.upgradeToken && !destHex.upgradeToken.revealed) {
        destHex.upgradeToken.revealed = true
        if (destHex.upgradeToken.type === 'energy') {
            newUnit.energy += destHex.upgradeToken.value
        } else {
            newUnit.upgrades.push({ type: destHex.upgradeToken.type as 'attack' | 'movement' | 'shield', value: destHex.upgradeToken.value })
        }
    }

    newUnit.statusEffects = newUnit.statusEffects.filter(e => e.type !== 'slow')
    newState.actionLog.push({ type: 'ADVANCE', unitId, to })
    {
        const from = unit.position!
        pushLog(newState, playerId,
            `${state.units[unitId].name} avanzó de (${from.q},${from.r}) a (${to.q},${to.r})`,
            'move', [hexKey(from), hexKey(to)]
        )
    }

    // Ventana de respuesta: T16 (Iron Grip) — si el oponente tiene carta after_enemy_advance
    const advOpponent: PlayerId = playerId === 'player1' ? 'player2' : 'player1'
    const advOppHand = newState.players[advOpponent].tactics.hand
    const hasAdvanceTrigger = advOppHand.some(c =>
        c.type === 'response' && c.effectData?.trigger === 'after_enemy_advance'
    )
    if (hasAdvanceTrigger) {
        const neighbors = getNeighbors(to)
        const adjacentToOpponent = neighbors.some(n => {
            const occupant = newState.board[hexKey(n)]?.occupiedBy
            return occupant && newState.units[occupant]?.playerId === advOpponent && newState.units[occupant].currentHp > 0
        })
        if (adjacentToOpponent) {
            newState.pendingResponse = {
                trigger: 'after_enemy_advance',
                forPlayerId: advOpponent,
                movedUnitId: unitId,
            }
        }
    }

    return { success: true, newState }
}

// ─── ATTACK ───────────────────────────────────────────────────────────────────

function markPrimaryUsed(state: GameState): GameState | null {
    if (state.hasUsedPrimaryAction) return null
    return { ...state, hasUsedPrimaryAction: true }
}

export function applyAttack(
    state: GameState,
    unitId: string,
    weaponIndex: number,
    targetId: string,
    playerId: PlayerId,
    diceRolls: number[]
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }
    state = primaryState

    const attacker = state.units[unitId]
    const target = state.units[targetId]

    if (!attacker.position) return { success: false, error: 'El atacante no está en el tablero' }
    if (!target) return { success: false, error: 'Objetivo no encontrado' }
    if (target.currentHp <= 0) return { success: false, error: 'El objetivo ya está derrotado' }
    if (!target.position) return { success: false, error: 'El objetivo no está en el tablero' }
    if (target.playerId === playerId) return { success: false, error: 'No puedes atacar unidades aliadas' }

    const weapon = attacker.weapons[weaponIndex]
    if (!weapon) return { success: false, error: 'Arma no encontrada' }

    if (weapon.energyCost && attacker.energy < weapon.energyCost) {
        return { success: false, error: 'No hay suficiente energía' }
    }

    const dist = gridDistance(attacker.position, target.position)
    if (dist > weapon.range) return { success: false, error: 'Objetivo fuera de rango' }

    // LoS (ignorable por ignore_los)
    const ignoresLoS = weapon.effectData?.type === 'ignore_los'
    if (dist > 1 && !ignoresLoS) {
        const enemyIds = getEnemyUnitIds(state, playerId)
        const los = checkLineOfSight(attacker.position, target.position, state.board, playerId, enemyIds)
        if (!los.clear) return { success: false, error: `Sin línea de visión: ${los.reason}` }
    }

    // Modificadores de habilidades ONGOING
    const mods = getOngoingModifiers(state, unitId, targetId)

    const hasDisarm = attacker.statusEffects.some(e => e.type === 'disarm')
    const attackerHex = state.board[hexKey(attacker.position)]
    const targetHex = state.board[hexKey(target.position)]
    const elevDiff = (attackerHex?.elevation ?? 0) - (targetHex?.elevation ?? 0)

    let accuracyMod = 0
    if (elevDiff > 0) accuracyMod -= 1
    if (elevDiff < 0) accuracyMod += 1
    if (targetHex?.terrain === 'water') accuracyMod += 1
    if (attackerHex?.terrain === 'water') accuracyMod += 1

    const hitThreshold = Math.max(2, Math.min(10, 4 + accuracyMod - mods.accuracyBonus))
    const critThreshold = mods.critThreshold  // default 8, Federation Courage lo baja a 7

    const totalStrength = weapon.strength + mods.strengthBonus

    // Reroll de fallos (Newtype Instincts)
    let effectiveDice = diceRolls.slice(0, totalStrength)
    if (mods.rerollMisses > 0) {
        let left = mods.rerollMisses
        effectiveDice = effectiveDice.map(roll => {
            if (left > 0 && roll !== 1 && roll < hitThreshold) {
                left--
                return Math.floor(Math.random() * 10) + 1
            }
            return roll
        })
    }

    let hits = 0
    let critCount = 0
    for (const roll of effectiveDice) {
        if (roll === 1) continue
        if (roll >= critThreshold) {
            hits++
            if (!hasDisarm) critCount++
        } else if (roll >= hitThreshold) {
            hits++
        }
    }

    const shieldUpgrade = target.upgrades.find(u => u.type === 'shield')?.value ?? 0
    let damage = Math.max(0, hits - shieldUpgrade)

    // Bonus daño de crit (bonus_damage en critData)
    if (critCount > 0 && weapon.critData?.type === 'bonus_damage') {
        damage += weapon.critData.amount ?? 0
    }

    // Bonus daño cerca de objetivo
    if (weapon.effectData?.type === 'bonus_damage_near_objective' && isNearObjective(state, target.position)) {
        damage += weapon.effectData.amount ?? 0
    }

    const hasFracture = target.statusEffects.some(e => e.type === 'fracture')
    if (hasFracture && damage >= 3) damage += 3

    const newState = cloneState(state)
    const newTarget = newState.units[targetId]
    const newAttacker = newState.units[unitId]

    newTarget.currentHp = Math.max(0, newTarget.currentHp - damage)

    if (weapon.energyCost) newAttacker.energy -= weapon.energyCost
    if (hasDisarm) newAttacker.statusEffects = newAttacker.statusEffects.filter(e => e.type !== 'disarm')
    if (hasFracture) newTarget.statusEffects = newTarget.statusEffects.filter(e => e.type !== 'fracture')

    const ctx: AttackContext = { attackerId: unitId, targetId, hits, critCount, damage }

    // Efectos after_attack_roll
    let resultState = newState
    if (hits > 0 && weapon.effectData?.trigger === 'after_attack_roll') {
        resultState = applyWeaponEffect(weapon.effectData, resultState, ctx)
    }
    if (critCount > 0 && weapon.critData?.trigger === 'after_attack_roll' && weapon.critData.type !== 'bonus_damage') {
        resultState = applyWeaponEffect(weapon.critData, resultState, ctx)
    }

    resultState.timeline = advanceToken(resultState.timeline, unitId, weapon.tlCost)

    const finalTarget = resultState.units[targetId]
    const targetKilled = finalTarget.currentHp <= 0
    const targetVp = finalTarget.vp
    if (targetKilled) {
        resultState.players[playerId].vp += finalTarget.vp
        if (finalTarget.position) {
            const key = hexKey(finalTarget.position)
            if (resultState.board[key]) resultState.board[key].occupiedBy = null
            finalTarget.position = null
        }
        resultState.timeline = advanceToken(resultState.timeline, targetId, 2)
        finalTarget.currentHp = finalTarget.maxHp
    } else {
        // Efectos after_combat_damage (solo si hubo daño y el objetivo sobrevivió)
        if (damage > 0 && weapon.effectData?.trigger === 'after_combat_damage') {
            resultState = applyWeaponEffect(weapon.effectData, resultState, ctx)
        }
        if (critCount > 0 && damage > 0 && weapon.critData?.trigger === 'after_combat_damage') {
            resultState = applyWeaponEffect(weapon.critData, resultState, ctx)
        }
    }

    resultState.actionLog.push({ type: 'ATTACK', unitId, weaponIndex, targetId })
    {
        const critMsg = critCount > 0 ? `, ${critCount} crít` : ''
        const killMsg = targetKilled ? ` — ¡KO! (+${targetVp} VP)` : ''
        const noHitMsg = hits === 0 ? ' — Sin impactos' : ''
        const atkPos = state.units[unitId].position
        const defPos = state.units[targetId].position
        const logHexes = [atkPos ? hexKey(atkPos) : null, defPos ? hexKey(defPos) : null].filter(Boolean) as string[]
        pushLog(resultState, playerId,
            `${state.units[unitId].name} atacó a ${state.units[targetId].name}` +
            (hits > 0 ? ` — ${hits} impactos, ${damage} daño${critMsg}` : noHitMsg) + killMsg,
            'attack', logHexes
        )
    }

    // Ventana de respuesta post-ataque solo si el defensor sobrevivió (position !== null)
    const atkTargetSurvived = resultState.units[targetId]?.position !== null
    const atkDefenderPlayerId = resultState.units[targetId]?.playerId
    if (atkTargetSurvived && atkDefenderPlayerId && atkDefenderPlayerId !== playerId) {
        const defenderHand = resultState.players[atkDefenderPlayerId].tactics.hand
        const hasResponseCard = defenderHand.some(c =>
            c.type === 'response' && c.effectData?.trigger === 'after_combat_damage'
        )
        if (hasResponseCard) {
            resultState.pendingResponse = {
                trigger: 'after_combat_damage',
                forPlayerId: atkDefenderPlayerId,
                attackerUnitId: unitId,
                defenderUnitId: targetId,
            }
        }
    }

    return { success: true, newState: resultState }
}

// ─── DASH ─────────────────────────────────────────────────────────────────────

export function applyDash(
    state: GameState,
    unitId: string,
    to: { q: number; r: number },
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }
    state = primaryState

    const unit = state.units[unitId]
    if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }

    const destKey = hexKey(to)
    const obstacles = getMovementObstacles(state, unitId)
    const allied = getAlliedPositions(state, unitId)
    if (allied.has(destKey)) return { success: false, error: 'Ese hex está ocupado por una unidad aliada' }

    const hasHover = unit.traits.includes('Hover')
    const dashRange = 2 + getDashBonus(state, unitId)
    const path = findPath(unit.position, to, state.board, obstacles, dashRange, hasHover)
    if (!path) return { success: false, error: 'Dash no válido o fuera de rango' }

    const newState = cloneState(state)
    const newUnit = newState.units[unitId]

    if (newState.board[hexKey(unit.position)]) newState.board[hexKey(unit.position)].occupiedBy = null
    newUnit.position = to
    if (newState.board[destKey]) newState.board[destKey].occupiedBy = unitId

    const destHex = newState.board[destKey]
    if (destHex?.upgradeToken && !destHex.upgradeToken.revealed) {
        destHex.upgradeToken.revealed = true
        if (destHex.upgradeToken.type === 'energy') {
            newUnit.energy += destHex.upgradeToken.value
        } else {
            newUnit.upgrades.push({ type: destHex.upgradeToken.type as 'attack' | 'movement' | 'shield', value: destHex.upgradeToken.value })
        }
    }

    newState.timeline = advanceToken(newState.timeline, unitId, 2)
    newState.actionLog.push({ type: 'DASH', unitId, to })
    {
        const from = unit.position!
        pushLog(newState, playerId,
            `${state.units[unitId].name} hizo dash de (${from.q},${from.r}) a (${to.q},${to.r})`,
            'move', [hexKey(from), hexKey(to)]
        )
    }

    // Trigger response: Char Kick
    const resultState = triggerAfterDash(newState, unitId)

    return { success: true, newState: resultState }
}

// ─── ENERGIZE ─────────────────────────────────────────────────────────────────

export function applyEnergize(state: GameState, unitId: string, playerId: PlayerId): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }
    state = primaryState

    const newState = cloneState(state)
    newState.units[unitId].energy += 1
    newState.timeline = advanceToken(newState.timeline, unitId, 2)
    newState.actionLog.push({ type: 'ENERGIZE', unitId })
    {
        const pos = state.units[unitId].position
        pushLog(newState, playerId, `${state.units[unitId].name} se energizó (+1 energía)`,
            'ability', pos ? [hexKey(pos)] : [])
    }

    return { success: true, newState }
}

// ─── RESCUE ───────────────────────────────────────────────────────────────────

export function applyRescue(state: GameState, unitId: string, garrisonId: string, playerId: PlayerId): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }
    state = primaryState

    const unit = state.units[unitId]
    if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }

    const garrisonEntry = Object.entries(state.board).find(([_, hex]) => hex.garrisonToken?.id === garrisonId)
    if (!garrisonEntry) return { success: false, error: 'Garrison no encontrada' }

    const [garrisonKey, garrisonHex] = garrisonEntry
    if (garrisonHex.garrisonToken!.owner !== playerId) return { success: false, error: 'Solo puedes rescatar garrisons aliadas' }
    if (gridDistance(unit.position, garrisonHex.coord) > 1) return { success: false, error: 'La garrison no está adyacente' }

    const newState = cloneState(state)
    newState.board[garrisonKey].garrisonToken = null
    newState.players[playerId].vp += 2
    newState.timeline = advanceToken(newState.timeline, unitId, 2)
    newState.actionLog.push({ type: 'RESCUE', unitId, garrisonId })
    {
        const unitPos = state.units[unitId].position
        const logHexes = [unitPos ? hexKey(unitPos) : null, garrisonKey].filter(Boolean) as string[]
        pushLog(newState, playerId, `${state.units[unitId].name} rescató una garrison aliada (+2 VP)`,
            'objective', logHexes)
    }

    // Trigger response: Rescue the Mechanics
    const rescueResult = triggerAfterRescue(newState, unitId)

    // Ventana de respuesta post-rescue para el jugador activo (T06, T15)
    const rescueHand = rescueResult.players[playerId].tactics.hand
    const hasRescueTrigger = rescueHand.some(c =>
        c.type === 'response' && c.effectData?.trigger === 'after_rescue'
    )
    if (hasRescueTrigger) {
        rescueResult.pendingResponse = {
            trigger: 'after_rescue',
            forPlayerId: playerId,
            rescuerUnitId: unitId,
        }
    }

    return { success: true, newState: rescueResult }
}

// ─── ATTACK_GARRISON ──────────────────────────────────────────────────────────

export function applyAttackGarrison(
    state: GameState,
    unitId: string,
    weaponIndex: number,
    garrisonId: string,
    playerId: PlayerId,
    diceRolls: number[]
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const attacker = state.units[unitId]
    if (!attacker.position) return { success: false, error: 'El atacante no está en el tablero' }

    const weapon = attacker.weapons[weaponIndex]
    if (!weapon) return { success: false, error: 'Arma no encontrada' }
    if (weapon.energyCost && attacker.energy < weapon.energyCost) return { success: false, error: 'No hay suficiente energía' }

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }
    state = primaryState

    const garrisonEntry = Object.entries(state.board).find(([, hex]) => hex.garrisonToken?.id === garrisonId)
    if (!garrisonEntry) return { success: false, error: 'Garrison no encontrada' }

    const [garrisonKey, garrisonHex] = garrisonEntry
    if (garrisonHex.garrisonToken!.owner === playerId) return { success: false, error: 'No puedes atacar tus propias garrisons' }

    const dist = gridDistance(attacker.position, garrisonHex.coord)
    if (dist > weapon.range) return { success: false, error: 'Garrison fuera de rango' }

    if (dist > 1) {
        const enemyIds = getEnemyUnitIds(state, playerId)
        const los = checkLineOfSight(attacker.position, garrisonHex.coord, state.board, playerId, enemyIds)
        if (!los.clear) return { success: false, error: `Sin línea de visión: ${los.reason}` }
    }

    const mods = getOngoingModifiers(state, unitId, unitId)
    const attackerHex = state.board[hexKey(attacker.position)]
    const elevDiff = (attackerHex?.elevation ?? 0) - (garrisonHex.elevation ?? 0)
    let accuracyMod = 0
    if (elevDiff > 0) accuracyMod -= 1
    if (elevDiff < 0) accuracyMod += 1
    const hitThreshold = Math.max(2, Math.min(10, 4 + accuracyMod - mods.accuracyBonus))

    const totalStrength = weapon.strength + mods.strengthBonus
    const effectiveDice = diceRolls.slice(0, totalStrength)
    let hits = 0
    for (const roll of effectiveDice) {
        if (roll !== 1 && roll >= hitThreshold) hits++
    }

    const newState = cloneState(state)
    const newAttacker = newState.units[unitId]

    if (weapon.energyCost) newAttacker.energy -= weapon.energyCost
    newState.timeline = advanceToken(newState.timeline, unitId, weapon.tlCost)

    {
        const atkPos = attacker.position
        const logHexes = [atkPos ? hexKey(atkPos) : null, garrisonKey].filter(Boolean) as string[]
        if (hits > 0) {
            newState.board[garrisonKey].garrisonToken = null
            newState.players[playerId].vp += 2
            newState.actionLog.push({ type: 'ATTACK_GARRISON', unitId, weaponIndex, garrisonId })
            pushLog(newState, playerId, `${attacker.name} destruyó una garrison enemiga (+2 VP)`, 'objective', logHexes)
        } else {
            newState.actionLog.push({ type: 'ATTACK_GARRISON', unitId, weaponIndex, garrisonId })
            pushLog(newState, playerId, `${attacker.name} atacó una garrison enemiga — sin impactos`, 'attack', logHexes)
        }
    }

    return { success: true, newState }
}

// ─── USE_ABILITY ──────────────────────────────────────────────────────────────

export function applyUseAbility(
    state: GameState,
    unitId: string,
    abilityIndex: number,
    playerId: PlayerId,
    targetId?: string
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }

    const result = applyBurstAbility(primaryState, unitId, abilityIndex, playerId, targetId)
    return result
}

// ─── PLAY_CARD ────────────────────────────────────────────────────────────────

export function applyPlayCard(
    state: GameState,
    unitId: string,
    cardId: string,
    playerId: PlayerId,
    targetId?: string
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const playerState = state.players[playerId]
    const cardIndex = playerState.tactics.hand.findIndex(c => c.id === cardId)
    if (cardIndex === -1) return { success: false, error: 'Carta no está en tu mano' }

    const card = playerState.tactics.hand[cardIndex]
    if (card.type !== 'command') return { success: false, error: 'Solo puedes jugar cartas de comando durante tu turno' }
    if (!card.effectData) return { success: false, error: `"${card.name}" no está implementada aún` }

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }

    const result = applyCardEffect(primaryState, playerId, unitId, card.effectData, targetId)
    if (!result.success) return { success: false, error: result.error }

    const newState = cloneState(result.newState!)
    // Mover carta de mano a descartadas
    newState.players[playerId].tactics.hand.splice(cardIndex, 1)
    newState.players[playerId].tactics.discarded.push(card)
    newState.actionLog.push({ type: 'PLAY_CARD', unitId, cardId })
    {
        const pos = state.units[unitId].position
        pushLog(newState, playerId, `${state.players[playerId].name} jugó "${card.name}"`,
            'card', pos ? [hexKey(pos)] : [])
    }

    return { success: true, newState }
}

// ─── END ACTIVATION ───────────────────────────────────────────────────────────

export function applyEndActivation(state: GameState, unitId: string, playerId: PlayerId): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    if (!state.hasUsedPrimaryAction) {
        return { success: false, error: 'Debes realizar una acción primaria (Atacar, Dash, Energize o Rescue) antes de terminar' }
    }

    const newState = cloneState(state)
    newState.timeline = advanceToken(newState.timeline, unitId, 1)
    const updated = advanceToNextActivation(newState)
    newState.actionLog.push({ type: 'END_ACTIVATION', unitId })
    {
        const pos = state.units[unitId].position
        pushLog(newState, playerId, `${state.units[unitId].name} terminó su activación`,
            'end', pos ? [hexKey(pos)] : [])
    }

    return { success: true, newState: updated }
}

// ─── PLAY_RESPONSE ────────────────────────────────────────────────────────────

export function applyPlayResponse(
    state: GameState,
    cardId: string,
    playerId: PlayerId,
    targetId?: string
): ActionResult {
    if (!state.pendingResponse || state.pendingResponse.forPlayerId !== playerId) {
        return { success: false, error: 'No hay ventana de respuesta disponible para ti' }
    }

    const playerState = state.players[playerId]
    const cardIndex = playerState.tactics.hand.findIndex(c => c.id === cardId)
    if (cardIndex === -1) return { success: false, error: 'Carta no está en tu mano' }

    const card = playerState.tactics.hand[cardIndex]
    if (card.type !== 'response') return { success: false, error: 'Solo puedes usar cartas RSP en la ventana de respuesta' }
    if (!card.effectData?.trigger) return { success: false, error: `"${card.name}" no está implementada aún` }
    if (card.effectData.trigger !== state.pendingResponse.trigger) {
        return { success: false, error: 'Esta carta no corresponde al trigger actual' }
    }

    const result = applyResponseCardEffect(state, playerId, card.effectData, state.pendingResponse, targetId)
    if (!result.success) return { success: false, error: result.error }

    const newState = cloneState(result.newState!)
    newState.players[playerId].tactics.hand.splice(cardIndex, 1)
    newState.players[playerId].tactics.discarded.push(card)
    newState.pendingResponse = null
    newState.actionLog.push({ type: 'PLAY_RESPONSE', cardId })
    pushLog(newState, playerId, `${state.players[playerId].name} respondió con "${card.name}"`, 'card', [])

    return { success: true, newState }
}

// ─── PASS_RESPONSE ────────────────────────────────────────────────────────────

export function applyPassResponse(state: GameState, playerId: PlayerId): ActionResult {
    if (!state.pendingResponse || state.pendingResponse.forPlayerId !== playerId) {
        return { success: false, error: 'No hay ventana de respuesta para ti' }
    }
    const newState = cloneState(state)
    newState.pendingResponse = null
    pushLog(newState, playerId, `${state.players[playerId].name} pasó la respuesta`, 'card', [])
    return { success: true, newState }
}

// ─── DISPATCHER ───────────────────────────────────────────────────────────────

export function applyAction(
    state: GameState,
    action: GameAction,
    playerId: PlayerId,
    diceRolls?: number[]
): ActionResult {
    if (state.activeUnitId) {
        const activeUnit = state.units[state.activeUnitId]
        if (activeUnit && activeUnit.position === null && activeUnit.playerId === playerId) {
            state = spawnUnitIfNeeded(state, state.activeUnitId)
        }
    }

    let result: ActionResult

    switch (action.type) {
        case 'ADVANCE':
            result = applyAdvance(state, action.unitId, action.to, playerId); break
        case 'ATTACK':
            if (!diceRolls) return { success: false, error: 'Faltan los dados para el ataque' }
            result = applyAttack(state, action.unitId, action.weaponIndex, action.targetId, playerId, diceRolls); break
        case 'DASH':
            result = applyDash(state, action.unitId, action.to, playerId); break
        case 'ENERGIZE':
            result = applyEnergize(state, action.unitId, playerId); break
        case 'RESCUE':
            result = applyRescue(state, action.unitId, action.garrisonId, playerId); break
        case 'ATTACK_GARRISON':
            if (!diceRolls) return { success: false, error: 'Faltan los dados para el ataque' }
            result = applyAttackGarrison(state, action.unitId, action.weaponIndex, action.garrisonId, playerId, diceRolls); break
        case 'USE_ABILITY':
            result = applyUseAbility(state, action.unitId, action.abilityIndex, playerId, action.targetId); break
        case 'PLAY_CARD':
            result = applyPlayCard(state, action.unitId, action.cardId, playerId, action.targetId); break
        case 'END_ACTIVATION':
            result = applyEndActivation(state, action.unitId, playerId); break
        case 'PLAY_RESPONSE':
            result = applyPlayResponse(state, action.cardId, playerId, action.targetId); break
        case 'PASS_RESPONSE':
            result = applyPassResponse(state, playerId); break
        default:
            return { success: false, error: 'Acción desconocida' }
    }

    if (result.success && result.newState?.activeUnitId) {
        const nextUnit = result.newState.units[result.newState.activeUnitId]
        if (nextUnit && nextUnit.position === null) {
            result.newState = spawnUnitIfNeeded(result.newState, result.newState.activeUnitId)
        }
    }

    return result
}
