import { GameState, GameAction, PlayerId } from '../types'
import { hexKey, findPath, checkLineOfSight, gridDistance, getNeighbors } from './hexGrid'
import { advanceToken, getNextActivation } from './timeline'

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
        if (unit.id === movingUnitId) continue
        if (unit.currentHp <= 0) continue
        if (!unit.position) continue
        // Enemigos bloquean paso y destino
        if (unit.playerId !== movingUnit.playerId) {
            obstacles.add(hexKey(unit.position))
        }
    }

    // Garrisons enemigas bloquean
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
        if (unit.id === movingUnitId) continue
        if (unit.currentHp <= 0) continue
        if (!unit.position) continue
        if (unit.playerId === movingUnit.playerId) {
            allied.add(hexKey(unit.position))
        }
    }
    return allied
}
function getEnemyPositions(state: GameState, playerId: PlayerId): Set<string> {
    const positions = new Set<string>()
    for (const unit of Object.values(state.units)) {
        if (unit.playerId === playerId) continue
        if (unit.currentHp <= 0) continue
        if (!unit.position) continue
        positions.add(unit.id)
    }
    return positions
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state))
}

function advanceToNextActivation(state: GameState): GameState {
    const next = getNextActivation(state.timeline)
    if (!next) return { ...state, activeUnitId: null, activePlayerId: state.activePlayerId }
    return { ...state, activeUnitId: next.unitId, activePlayerId: next.playerId }
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

// ─── ADVANCE ─────────────────────────────────────────────────────────────────
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
    const path = findPath(unit.position, to, state.board, obstacles, maxMove)
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
            newUnit.upgrades.push({
                type: destHex.upgradeToken.type as 'attack' | 'movement' | 'shield',
                value: destHex.upgradeToken.value,
            })
        }
    }

    newUnit.statusEffects = newUnit.statusEffects.filter(e => e.type !== 'slow')
    newState.actionLog.push({ type: 'ADVANCE', unitId, to })

    return { success: true, newState }
}

// ─── ATTACK ──────────────────────────────────────────────────────────────────
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

    if (dist > 1) {
        const enemyPositions = getEnemyPositions(state, playerId)
        const los = checkLineOfSight(attacker.position, target.position, state.board, playerId, enemyPositions)
        console.log('LOS result:', los)
        if (!los.clear) return { success: false, error: `Sin línea de visión: ${los.reason}` }
    }

    const hasDisarm = attacker.statusEffects.some(e => e.type === 'disarm')
    const attackerHex = state.board[hexKey(attacker.position)]
    const targetHex = state.board[hexKey(target.position)]
    const elevDiff = (attackerHex?.elevation ?? 0) - (targetHex?.elevation ?? 0)

    let accuracyMod = 0
    if (elevDiff > 0) accuracyMod -= 1
    if (elevDiff < 0) accuracyMod += 1
    if (targetHex?.terrain === 'water') accuracyMod += 1
    if (attackerHex?.terrain === 'water') accuracyMod += 1

    const hitThreshold = Math.max(2, Math.min(9, 4 + accuracyMod))

    let hits = 0
    let critEffectTriggered = false
    for (const roll of diceRolls) {
        if (roll === 1) continue
        if (roll >= 9) {
            if (!hasDisarm) { hits++; critEffectTriggered = true }
        } else if (roll >= hitThreshold) {
            hits++
        }
    }

    const shieldUpgrade = target.upgrades.find(u => u.type === 'shield')?.value ?? 0
    let damage = Math.max(0, hits - shieldUpgrade)

    const hasFracture = target.statusEffects.some(e => e.type === 'fracture')
    if (hasFracture && damage > 3) damage += 3

    const newState = cloneState(state)
    const newTarget = newState.units[targetId]
    const newAttacker = newState.units[unitId]

    newTarget.currentHp = Math.max(0, newTarget.currentHp - damage)

    if (weapon.energyCost) newAttacker.energy -= weapon.energyCost
    if (hasDisarm) newAttacker.statusEffects = newAttacker.statusEffects.filter(e => e.type !== 'disarm')
    if (hasFracture) newTarget.statusEffects = newTarget.statusEffects.filter(e => e.type !== 'fracture')

    newState.timeline = advanceToken(newState.timeline, unitId, weapon.tlCost)

    if (newTarget.currentHp <= 0) {
        newState.players[playerId].vp += newTarget.vp
        if (newTarget.position) {
            const key = hexKey(newTarget.position)
            if (newState.board[key]) newState.board[key].occupiedBy = null
            newTarget.position = null
        }
        newState.timeline = advanceToken(newState.timeline, targetId, 2)
        newTarget.currentHp = newTarget.maxHp
    }

    newState.actionLog.push({ type: 'ATTACK', unitId, weaponIndex, targetId })

    return { success: true, newState }
}

// ─── DASH ────────────────────────────────────────────────────────────────────
export function applyDash(
    state: GameState,
    unitId: string,
    to: { q: number; r: number },
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const unit = state.units[unitId]
    if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }

    const destKey = hexKey(to)
    const obstacles = getMovementObstacles(state, unitId)
    const allied = getAlliedPositions(state, unitId)

    if (allied.has(destKey)) return { success: false, error: 'Ese hex está ocupado por una unidad aliada' }

    const path = findPath(unit.position, to, state.board, obstacles, 2)
    if (!path) return { success: false, error: 'Dash no válido o fuera de rango' }

    const newState = cloneState(state)
    const newUnit = newState.units[unitId]

    if (newState.board[hexKey(unit.position)]) {
        newState.board[hexKey(unit.position)].occupiedBy = null
    }

    newUnit.position = to
    if (newState.board[destKey]) {
        newState.board[destKey].occupiedBy = unitId
    }

    // Recoger upgrade token al hacer Dash
    const destHex = newState.board[destKey]
    if (destHex?.upgradeToken && !destHex.upgradeToken.revealed) {
        destHex.upgradeToken.revealed = true
        if (destHex.upgradeToken.type === 'energy') {
            newUnit.energy += destHex.upgradeToken.value
        } else {
            newUnit.upgrades.push({
                type: destHex.upgradeToken.type as 'attack' | 'movement' | 'shield',
                value: destHex.upgradeToken.value,
            })
        }
    }

    newState.timeline = advanceToken(newState.timeline, unitId, 2)
    newState.actionLog.push({ type: 'DASH', unitId, to })

    return { success: true, newState }
}
// ─── ENERGIZE ────────────────────────────────────────────────────────────────
export function applyEnergize(
    state: GameState,
    unitId: string,
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const newState = cloneState(state)
    newState.units[unitId].energy += 1
    newState.timeline = advanceToken(newState.timeline, unitId, 2)
    newState.actionLog.push({ type: 'ENERGIZE', unitId })

    return { success: true, newState }
}

// ─── RESCUE ──────────────────────────────────────────────────────────────────
export function applyRescue(
    state: GameState,
    unitId: string,
    garrisonId: string,
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const unit = state.units[unitId]
    if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }

    const garrisonHexEntry = Object.entries(state.board).find(
        ([_, hex]) => hex.garrisonToken?.id === garrisonId
    )
    if (!garrisonHexEntry) return { success: false, error: 'Garrison no encontrada' }

    const [garrisonKey, garrisonHex] = garrisonHexEntry
    const garrison = garrisonHex.garrisonToken!

    if (garrison.owner !== playerId) {
        return { success: false, error: 'Solo puedes rescatar garrisons aliadas' }
    }

    const dist = gridDistance(unit.position, garrisonHex.coord)
    if (dist > 1) {
        return { success: false, error: 'La garrison no está adyacente' }
    }

    const newState = cloneState(state)
    newState.board[garrisonKey].garrisonToken = null
    newState.players[playerId].vp += 2
    newState.timeline = advanceToken(newState.timeline, unitId, 2)
    newState.actionLog.push({ type: 'RESCUE', unitId, garrisonId })

    return { success: true, newState }
}

// ─── END ACTIVATION ──────────────────────────────────────────────────────────
export function applyEndActivation(
    state: GameState,
    unitId: string,
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const newState = cloneState(state)
    newState.timeline = advanceToken(newState.timeline, unitId, 1)
    const updated = advanceToNextActivation(newState)
    newState.actionLog.push({ type: 'END_ACTIVATION', unitId })

    return { success: true, newState: updated }
}

// ─── DISPATCHER ──────────────────────────────────────────────────────────────
export function applyAction(
    state: GameState,
    action: GameAction,
    playerId: PlayerId,
    diceRolls?: number[]
): ActionResult {
    // Spawn de la unidad activa si no tiene posición
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
        case 'END_ACTIVATION':
            result = applyEndActivation(state, action.unitId, playerId); break
        default:
            return { success: false, error: 'Acción desconocida' }
    }

    // Spawn de la siguiente unidad activa si no tiene posición
    // Spawn de la siguiente unidad activa si no tiene posición
    if (result.success && result.newState?.activeUnitId) {
        const nextUnit = result.newState.units[result.newState.activeUnitId]
        console.log('NEXT UNIT:', result.newState.activeUnitId, 'position:', nextUnit?.position)
        if (nextUnit && nextUnit.position === null) {
            console.log('SPAWNING next unit...')
            result.newState = spawnUnitIfNeeded(result.newState, result.newState.activeUnitId)
            console.log('After spawn:', result.newState.units[result.newState.activeUnitId!]?.position)
        }
    }

    return result

    return result
}