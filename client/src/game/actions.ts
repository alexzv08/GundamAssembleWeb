import type { GameState, GameAction, PlayerId } from '../types'
import type { AbilityEffect } from '../types/units'
import { hexKey, hexDistance, findPath, checkLineOfSight, gridDistance, getNeighbors } from './hexGrid'
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
    if (!next) return { ...state, activeUnitId: null, activePlayerId: state.activePlayerId, hasUsedPrimaryAction: false }
    return { ...state, activeUnitId: next.unitId, activePlayerId: next.playerId, hasUsedPrimaryAction: false }
}

function markPrimaryUsed(state: GameState): GameState | null {
    if (state.hasUsedPrimaryAction) return null
    return { ...state, hasUsedPrimaryAction: true }
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
    const hasHover = unit.traits.includes('Hover')

    const path = findPath(unit.position, to, state.board, obstacles, maxMove, hasHover)
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

    // Ventana de respuesta post-advance (cartas after_enemy_advance del oponente)
    const advOpponent: PlayerId = playerId === 'player1' ? 'player2' : 'player1'
    const advOppHand = newState.players[advOpponent].tactics.hand
    const hasAdvanceTrigger = advOppHand.some(c =>
        c.type === 'response' && c.effectData?.trigger === 'after_enemy_advance'
    )
    if (hasAdvanceTrigger) {
        const adjacentToOpponent = getNeighbors(to).some(n => {
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

    // Comprobar energía si la requiere
    if (weapon.energyCost && attacker.energy < weapon.energyCost) {
        return { success: false, error: 'No hay suficiente energía' }
    }

    // Comprobar rango
    const dist = gridDistance(attacker.position, target.position)
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
    const resolvedRolls = [...diceRolls]

    for (const roll of resolvedRolls) {
        if (roll === 1) continue
        if (roll >= 9) {
            if (!hasDisarm) hits++
        } else if (roll >= hitThreshold) {
            hits++
        }
    }

    // Calcular daño final
    const shieldUpgrade = target.upgrades.find(u => u.type === 'shield')?.value ?? 0
    let damage = Math.max(0, hits - shieldUpgrade)

    // Fracture: si daño >= 3 en un solo ataque, +3 daño adicional
    const hasFracture = target.statusEffects.some(e => e.type === 'fracture')
    if (hasFracture && damage >= 3) damage += 3

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

    // Ventana de respuesta post-ataque solo si el defensor sobrevivió (position !== null)
    const targetSurvived = newState.units[targetId]?.position !== null
    const atkDefenderPlayerId = newState.units[targetId]?.playerId
    if (targetSurvived && atkDefenderPlayerId && atkDefenderPlayerId !== playerId) {
        const defHand = newState.players[atkDefenderPlayerId].tactics.hand
        const hasResponseCard = defHand.some(c =>
            c.type === 'response' && c.effectData?.trigger === 'after_combat_damage'
        )
        if (hasResponseCard) {
            newState.pendingResponse = {
                trigger: 'after_combat_damage',
                forPlayerId: atkDefenderPlayerId,
                attackerUnitId: unitId,
                defenderUnitId: targetId,
            }
        }
    }

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

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }
    state = primaryState

    const obstacles = getMovementObstacles(state, unitId)
    const hasHover = state.units[unitId].traits.includes('Hover')
    const dashRange = 2  // Dash siempre mueve exactamente 2 hexes adicionales

    const path = findPath(unit.position, to, state.board, obstacles, dashRange, hasHover)
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

    const primaryState = markPrimaryUsed(state)
    if (!primaryState) return { success: false, error: 'Ya usaste tu acción primaria este turno' }
    state = primaryState

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
        ([, hex]) => hex.garrisonToken?.id === garrisonId
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

    // Ventana de respuesta post-rescue (cartas after_rescue)
    const rescueHand = newState.players[playerId].tactics.hand
    const hasRescueTrigger = rescueHand.some(c =>
        c.type === 'response' && c.effectData?.trigger === 'after_rescue'
    )
    if (hasRescueTrigger) {
        newState.pendingResponse = {
            trigger: 'after_rescue',
            forPlayerId: playerId,
            rescuerUnitId: unitId,
        }
    }

    return { success: true, newState }
}

// ─── END ACTIVATION ───────────────────────────────────────────────────────────
export function applyEndActivation(
    state: GameState,
    unitId: string,
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    if (!state.hasUsedPrimaryAction) {
        return { success: false, error: 'Debes realizar una acción primaria antes de terminar' }
    }

    const newState = cloneState(state)

    // Avanzar TL mínimo 1 (fin de activación sin Primary Action)
    newState.timeline = advanceToken(newState.timeline, unitId, 1)

    // Pasar al siguiente token
    const updated = advanceToNextActivation(newState)

    newState.actionLog.push({ type: 'END_ACTIVATION', unitId })

    return { success: true, newState: updated }
}

// ─── ATTACK_GARRISON ──────────────────────────────────────────────────────────
export function applyAttackGarrison(
    state: GameState,
    unitId: string,
    weaponIndex: number,
    garrisonId: string,
    playerId: PlayerId
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const attacker = state.units[unitId]
    if (!attacker.position) return { success: false, error: 'El atacante no está en el tablero' }

    const weapon = attacker.weapons[weaponIndex]
    if (!weapon) return { success: false, error: 'Arma no encontrada' }

    const garrisonEntry = Object.entries(state.board).find(([, hex]) => hex.garrisonToken?.id === garrisonId)
    if (!garrisonEntry) return { success: false, error: 'Garrison no encontrada' }

    const [, garrisonHex] = garrisonEntry
    if (garrisonHex.garrisonToken!.owner === playerId) return { success: false, error: 'No puedes atacar tus propias garrisons' }

    const dist = gridDistance(attacker.position, garrisonHex.coord)
    if (dist > weapon.range) return { success: false, error: 'Garrison fuera de rango' }

    if (state.hasUsedPrimaryAction) return { success: false, error: 'Ya usaste tu acción primaria este turno' }

    return { success: true }
}

// ─── PLAY CARD ────────────────────────────────────────────────────────────────
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
    const card = playerState.tactics.hand.find(c => c.id === cardId)
    if (!card) return { success: false, error: 'Carta no está en tu mano' }
    if (card.type !== 'command') return { success: false, error: 'Solo puedes jugar cartas de comando durante tu turno' }
    if (!card.effectData) return { success: false, error: `"${card.name}" no está implementada aún` }

    if (state.hasUsedPrimaryAction) return { success: false, error: 'Ya usaste tu acción primaria este turno' }

    const needsTarget = card.effectData.type === 'destroy_upgrade_and_slow' ||
                        card.effectData.type === 'destroy_upgrade_and_fracture'
    if (needsTarget && !targetId) return { success: false, error: 'Esta carta necesita un objetivo' }

    return { success: true }
}

// ─── USE ABILITY ──────────────────────────────────────────────────────────────
export function applyUseAbility(
    state: GameState,
    unitId: string,
    abilityIndex: number,
    playerId: PlayerId,
    targetId?: string
): ActionResult {
    const error = validateTurn(state, unitId, playerId)
    if (error) return { success: false, error }

    const unit = state.units[unitId]
    const ability = unit.abilities[abilityIndex]
    if (!ability) return { success: false, error: 'Habilidad no encontrada' }
    if (ability.type !== 'CMD') return { success: false, error: 'Solo se pueden activar habilidades CMD' }

    const energyCost = ability.energyCost ?? 0
    if (energyCost > 0 && unit.energy < energyCost) return { success: false, error: 'Energía insuficiente' }

    const data = ability.abilityData as AbilityEffect | null | undefined
    if (!data) return { success: false, error: `"${ability.name}" no está implementada aún` }

    if (state.hasUsedPrimaryAction) return { success: false, error: 'Ya usaste tu acción primaria este turno' }

    if (data.type === 'fracture_enemy') {
        if (!targetId) return { success: false, error: 'Necesita un objetivo' }
        const target = state.units[targetId]
        if (!target || target.currentHp <= 0) return { success: false, error: 'Objetivo inválido' }
        if (target.playerId === playerId) return { success: false, error: 'No puedes usar esta habilidad en aliados' }
        if (!unit.position || !target.position) return { success: false, error: 'Unidad fuera del tablero' }
        if (gridDistance(unit.position, target.position) > (data.range ?? 3)) {
            return { success: false, error: `Objetivo fuera de rango (${data.range ?? 3})` }
        }
    }

    return { success: true }
}

// ─── PLAY_RESPONSE ────────────────────────────────────────────────────────────
export function applyPlayResponse(
    state: GameState,
    cardId: string,
    playerId: PlayerId
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

    const newState = cloneState(state)
    newState.players[playerId].tactics.hand.splice(cardIndex, 1)
    newState.players[playerId].tactics.discarded.push(card)
    newState.pendingResponse = null
    newState.actionLog.push({ type: 'PLAY_RESPONSE', cardId })

    return { success: true, newState }
}

// ─── PASS_RESPONSE ────────────────────────────────────────────────────────────
export function applyPassResponse(state: GameState, playerId: PlayerId): ActionResult {
    if (!state.pendingResponse || state.pendingResponse.forPlayerId !== playerId) {
        return { success: false, error: 'No hay ventana de respuesta para ti' }
    }
    const newState = cloneState(state)
    newState.pendingResponse = null
    return { success: true, newState }
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

        case 'ATTACK_GARRISON':
            return applyAttackGarrison(state, action.unitId, action.weaponIndex, action.garrisonId, playerId)

        case 'USE_ABILITY':
            return applyUseAbility(state, action.unitId, action.abilityIndex, playerId, action.targetId)

        case 'PLAY_CARD':
            return applyPlayCard(state, action.unitId, action.cardId, playerId, action.targetId)

        case 'END_ACTIVATION':
            return applyEndActivation(state, action.unitId, playerId)

        case 'PLAY_RESPONSE':
            return applyPlayResponse(state, action.cardId, playerId)

        case 'PASS_RESPONSE':
            return applyPassResponse(state, playerId)

        default:
            return { success: false, error: 'Acción desconocida' }
    }
}