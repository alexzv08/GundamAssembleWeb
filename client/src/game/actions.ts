import type { GameState, GameAction, PlayerId, Unit } from '../types'
import  { hexKey, hexDistance, findPath, getReachableHexes, checkLineOfSight } from './hexGrid'
import { advanceToken, getNextActivation } from './timeline'

// ─── RESULTADO DE UNA ACCIÓN ──────────────────────────────────────────────────
export interface ActionResult {
    success: boolean
    newState?: GameState
    error?: string
}

// ─── VALIDACIÓN GENERAL ───────────────────────────────────────────────────────
// Comprueba que la acción viene del jugador correcto y la unidad es suya
function validateTurn(state: GameState, unitId: string, playerId: PlayerId): string | null {
    if (state.activePlayerId !== playerId) return 'No es tu turno'
    if (state.activeUnitId !== unitId) return 'No es el turno de esta unidad'
    const unit = state.units[unitId]
    if (!unit) return 'Unidad no encontrada'
    if (unit.playerId !== playerId) return 'Esta unidad no es tuya'
    if (unit.currentHp <= 0) return 'La unidad está derrotada'
    return null
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Set de hexes bloqueados para movimiento (unidades enemigas)
function getMovementObstacles(state: GameState, movingUnitId: string): Set<string> {
    const obstacles = new Set<string>()
    for (const unit of Object.values(state.units)) {
        if (unit.id === movingUnitId) continue
        if (unit.currentHp <= 0) continue
        if (!unit.position) continue
        // Las unidades aliadas se pueden atravesar pero no ocupar
        // Las enemigas bloquean completamente
        if (unit.playerId !== state.units[movingUnitId].playerId) {
            obstacles.add(hexKey(unit.position))
        }
        // Garrisons y objetivos también bloquean (se añaden desde el board)
    }

    // Añadir garrisons y objetivos como obstáculos
    for (const hex of Object.values(state.board)) {
        if (hex.garrisonToken) obstacles.add(hexKey(hex.coord))
        if (hex.objectiveToken) obstacles.add(hexKey(hex.coord))
    }

    return obstacles
}

// Set de posiciones de unidades enemigas (para LOS check)
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

// Clonar el estado de forma segura (inmutable)
function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state))
}

// Avanzar el turno al siguiente token del Timeline
function advanceToNextActivation(state: GameState): GameState {
    const next = getNextActivation(state.timeline)
    if (!next) {
        // No quedan tokens → fin de fase
        return { ...state, activeUnitId: null, activePlayerId: state.activePlayerId }
    }
    return {
        ...state,
        activeUnitId: next.unitId,
        activePlayerId: next.playerId,
    }
}

// ─── ADVANCE (MOVER) ──────────────────────────────────────────────────────────
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

    const obstacles = getMovementObstacles(state, unitId)

    // Slow: no puede usar Advance este turno
    const hasSlow = unit.statusEffects.some(e => e.type === 'slow')
    if (hasSlow) return { success: false, error: 'La unidad tiene Slow y no puede moverse' }

    // Comprobar que el hex destino existe en el tablero
    const destKey = hexKey(to)
    if (!state.board[destKey]) return { success: false, error: 'Hex destino no existe en el tablero' }

    // Movimiento base: 3 hexes
    const maxMove = 3 + (unit.upgrades.find(u => u.type === 'movement')?.value ?? 0)

    const path = findPath(unit.position, to, state.board, obstacles, maxMove)
    if (!path) return { success: false, error: 'Movimiento no válido o fuera de rango' }

    const newState = cloneState(state)
    const newUnit = newState.units[unitId]

    // Quitar unidad de hex anterior
    const oldKey = hexKey(unit.position)
    if (newState.board[oldKey]) newState.board[oldKey].occupiedBy = null

    // Colocar unidad en hex nuevo
    const newKey = hexKey(to)
    newUnit.position = to
    if (newState.board[newKey]) newState.board[newKey].occupiedBy = unitId

    // Recoger upgrade token si hay
    const destHex = newState.board[newKey]
    if (destHex?.upgradeToken && destHex.upgradeToken.revealed === false) {
        destHex.upgradeToken.revealed = true
        newUnit.upgrades.push({
            type: destHex.upgradeToken.type,
            value: destHex.upgradeToken.value,
        })
    }

    // Quitar Slow si lo tenía (se consume al intentar moverse — aunque falle ya se validó antes)
    newUnit.statusEffects = newUnit.statusEffects.filter(e => e.type !== 'slow')

    // Log
    newState.actionLog.push({ type: 'ADVANCE', unitId, to })

    return { success: true, newState }
}

// ─── ATTACK ───────────────────────────────────────────────────────────────────
export function applyAttack(
    state: GameState,
    unitId: string,
    weaponIndex: number,
    targetId: string,
    playerId: PlayerId,
    // Los dados se tiran fuera y se pasan aquí para que el engine sea determinista
    // En producción el servidor los genera; en tests los pasamos nosotros
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

    // Comprobar energía si la requiere
    if (weapon.energyCost && attacker.energy < weapon.energyCost) {
        return { success: false, error: 'No hay suficiente energía' }
    }

    // Comprobar rango
    const dist = hexDistance(attacker.position, target.position)
    if (dist > weapon.range) return { success: false, error: 'Objetivo fuera de rango' }

    // Comprobar LOS (solo si rango > 1)
    if (dist > 1) {
        const enemyPositions = getEnemyPositions(state, playerId)
        const los = checkLineOfSight(
            attacker.position,
            target.position,
            state.board,
            playerId,
            enemyPositions
        )
        if (!los.clear) return { success: false, error: `Sin línea de visión: ${los.reason}` }
    }

    // Comprobar Disarm (relanza los hits)
    const hasDisarm = attacker.statusEffects.some(e => e.type === 'disarm')

    // Calcular modificador de Accuracy
    const attackerHex = state.board[hexKey(attacker.position)]
    const targetHex = state.board[hexKey(target.position)]
    const elevDiff = (attackerHex?.elevation ?? 0) - (targetHex?.elevation ?? 0)

    let accuracyMod = 0
    if (elevDiff > 0) accuracyMod -= 1  // atacar desde arriba: -1 accuracy (más fácil)
    if (elevDiff < 0) accuracyMod += 1  // atacar desde abajo:  +1 accuracy (más difícil)
    if (targetHex?.terrain === 'water') accuracyMod += 1
    if (attackerHex?.terrain === 'water') accuracyMod += 1

    // El umbral de hit es 4, modificado por accuracy
    // -1 accuracy → umbral baja a 3 (más fácil acertar)
    // +1 accuracy → umbral sube a 5 (más difícil acertar)
    const hitThreshold = Math.max(2, Math.min(9, 4 + accuracyMod))

    // Resolver dados
    let hits = 0
    let critEffectTriggered = false
    const resolvedRolls = [...diceRolls]

    // Disarm: relanzar los dados que hubieran sido hit (se simula reemplazando)
    // En producción el servidor hace el reroll; aquí el caller pasa los rolls ya resueltos

    for (const roll of resolvedRolls) {
        if (roll === 1) continue  // fallo asegurado independientemente de accuracy
        if (roll >= 9) {
            // Crítico: 1 hit + efecto especial
            if (!hasDisarm) {
                hits++
                critEffectTriggered = true
            }
        } else if (roll >= hitThreshold) {
            hits++
        }
    }

    // Calcular daño final
    const shieldUpgrade = target.upgrades.find(u => u.type === 'shield')?.value ?? 0
    let damage = Math.max(0, hits - shieldUpgrade)

    // Fracture: si daño > 3 en un solo ataque, +3 daño adicional
    const hasFracture = target.statusEffects.some(e => e.type === 'fracture')
    if (hasFracture && damage > 3) damage += 3

    // Aplicar daño
    const newState = cloneState(state)
    const newTarget = newState.units[targetId]
    const newAttacker = newState.units[unitId]

    newTarget.currentHp = Math.max(0, newTarget.currentHp - damage)

    // Consumir energía si el arma la requería
    if (weapon.energyCost) {
        newAttacker.energy -= weapon.energyCost
    }

    // Consumir Disarm
    if (hasDisarm) {
        newAttacker.statusEffects = newAttacker.statusEffects.filter(e => e.type !== 'disarm')
    }

    // Consumir Fracture del objetivo
    if (hasFracture) {
        newTarget.statusEffects = newTarget.statusEffects.filter(e => e.type !== 'fracture')
    }

    // Avanzar token TL del atacante
    newState.timeline = advanceToken(newState.timeline, unitId, weapon.tlCost)

    // Si el objetivo fue derrotado
    if (newTarget.currentHp <= 0) {
        // Sumar VP al atacante
        const attackerPlayer = newState.players[playerId]
        attackerPlayer.vp += newTarget.vp

        // Limpiar posición del objetivo en el tablero
        if (newTarget.position) {
            const key = hexKey(newTarget.position)
            if (newState.board[key]) newState.board[key].occupiedBy = null
            newTarget.position = null
        }

        // Avanzar token del objetivo +2
        newState.timeline = advanceToken(newState.timeline, targetId, 2)
    }

    // Log
    newState.actionLog.push({
        type: 'ATTACK',
        unitId,
        weaponIndex,
        targetId,
    })

    return { success: true, newState }
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

    const unit = state.units[unitId]
    if (!unit.position) return { success: false, error: 'La unidad no está en el tablero' }

    const obstacles = getMovementObstacles(state, unitId)
    const dashRange = 2  // Dash siempre mueve exactamente 2 hexes adicionales

    const path = findPath(unit.position, to, state.board, obstacles, dashRange)
    if (!path) return { success: false, error: 'Dash no válido o fuera de rango' }

    const newState = cloneState(state)
    const newUnit = newState.units[unitId]

    // Quitar de hex anterior
    if (newState.board[hexKey(unit.position)]) {
        newState.board[hexKey(unit.position)].occupiedBy = null
    }

    // Colocar en hex nuevo
    newUnit.position = to
    if (newState.board[hexKey(to)]) {
        newState.board[hexKey(to)].occupiedBy = unitId
    }

    // Avanzar TL (Dash cuesta 2 TL)
    newState.timeline = advanceToken(newState.timeline, unitId, 2)

    newState.actionLog.push({ type: 'DASH', unitId, to })

    return { success: true, newState }
}

// ─── ENERGIZE ─────────────────────────────────────────────────────────────────
export function applyEnergize(
    state: GameState,
    unitId: string,
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const newState = cloneState(state)
    newState.units[unitId].energy += 1

    // Avanzar TL (Energize cuesta 2 TL)
    newState.timeline = advanceToken(newState.timeline, unitId, 2)

    newState.actionLog.push({ type: 'ENERGIZE', unitId })

    return { success: true, newState }
}

// ─── RESCUE ───────────────────────────────────────────────────────────────────
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

    // Buscar la garrison en el tablero
    const garrisonHexEntry = Object.entries(state.board).find(
        ([_, hex]) => hex.garrisonToken?.id === garrisonId
    )
    if (!garrisonHexEntry) return { success: false, error: 'Garrison no encontrada' }

    const [garrisonKey, garrisonHex] = garrisonHexEntry
    const garrison = garrisonHex.garrisonToken!

    // Debe ser aliada
    if (garrison.owner !== playerId) {
        return { success: false, error: 'Solo puedes rescatar garrisons aliadas' }
    }

    // Debe estar adyacente (distancia 1)
    const garrisonCoord = garrisonHex.coord
    if (hexDistance(unit.position, garrisonCoord) > 1) {
        return { success: false, error: 'La garrison no está adyacente' }
    }

    const newState = cloneState(state)

    // Retirar garrison del tablero
    newState.board[garrisonKey].garrisonToken = null

    // Sumar 2 VP al jugador
    newState.players[playerId].vp += 2

    // Avanzar TL (Rescue cuesta 2 TL)
    newState.timeline = advanceToken(newState.timeline, unitId, 2)

    newState.actionLog.push({ type: 'RESCUE', unitId, garrisonId })

    return { success: true, newState }
}

// ─── END ACTIVATION ───────────────────────────────────────────────────────────
// El jugador termina el turno de su unidad sin usar Primary Action
// (solo usó Advance, Command o Tactics Card)
// IMPORTANTE: una unidad NO puede terminar sin avanzar su TL al menos 1
// — las reglas dicen que siempre debe avanzar. Lo forzamos con tlCost 1.
export function applyEndActivation(
    state: GameState,
    unitId: string,
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const newState = cloneState(state)

    // Avanzar TL mínimo 1 (fin de activación sin Primary Action)
    newState.timeline = advanceToken(newState.timeline, unitId, 1)

    // Pasar al siguiente token
    const updated = advanceToNextActivation(newState)

    newState.actionLog.push({ type: 'END_ACTIVATION', unitId })

    return { success: true, newState: updated }
}

// ─── DISPATCHER PRINCIPAL ─────────────────────────────────────────────────────
// Punto de entrada único: recibe cualquier GameAction y la aplica
export function applyAction(
    state: GameState,
    action: GameAction,
    playerId: PlayerId,
    diceRolls?: number[]  // solo para ATTACK
): ActionResult {
    switch (action.type) {
        case 'ADVANCE':
            return applyAdvance(state, action.unitId, action.to, playerId)

        case 'ATTACK':
            if (!diceRolls) return { success: false, error: 'Faltan los dados para el ataque' }
            return applyAttack(state, action.unitId, action.weaponIndex, action.targetId, playerId, diceRolls)

        case 'DASH':
            return applyDash(state, action.unitId, action.to, playerId)

        case 'ENERGIZE':
            return applyEnergize(state, action.unitId, playerId)

        case 'RESCUE':
            return applyRescue(state, action.unitId, action.garrisonId, playerId)

        case 'END_ACTIVATION':
            return applyEndActivation(state, action.unitId, playerId)

        default:
            return { success: false, error: 'Acción desconocida' }
    }
}