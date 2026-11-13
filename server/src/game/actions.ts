// Acciones de una activación (Core Rulebook v1.2, "Activating your Units").
// Cada apply* valida, trabaja sobre UNA copia del estado y la devuelve.
// El paso a la siguiente activación, las fases y el fin de partida los
// gestiona engine.ts.
import type { GameState, GameAction, PlayerId, HexCoord } from '../types'
import { hexKey, findPath, gridDistance, getNeighbors } from './hexGrid'
import { advanceToken } from './timeline'
import {
    moveOptionsFor, checkAttackTarget, checkAttackTargetWith, targetAt, baseOwnerAt, reachableFor,
} from './queries'
import { cloneState, pushLog } from './damage'
import {
    startAttack, rollD10, closeResponseWindow, isAttackResponse, canPlayAttackResponse, applyAttackResponse, type Rng,
} from './combat'
import {
    applyCommandAbility, applyCardEffect, applyResponseCardEffect, collectTokens,
    triggerAfterDash, triggerAfterMove, adjacentEnemyKeys, rescueGarrison,
} from './effects'
import { contestObjectives } from './victory'
import { endActivation } from './activation'

export interface ActionResult {
    success: boolean
    newState?: GameState
    error?: string
}
const fail = (error: string): ActionResult => ({ success: false, error })

function validateTurn(state: GameState, unitId: string, playerId: PlayerId): string | null {
    if (state.phase !== 'phase1' && state.phase !== 'phase2') return 'La partida no está en juego'
    if (state.pendingResponse) return 'Esperando la respuesta del rival'
    if (state.activePlayerId !== playerId) return 'No es tu turno'
    if (state.activeUnitId !== unitId) return 'No es el turno de esta unidad'
    const unit = state.units[unitId]
    if (!unit) return 'Unidad no encontrada'
    if (unit.playerId !== playerId) return 'Esta unidad no es tuya'
    if (!state.activation || state.activation.unitId !== unitId) return 'La activación no ha empezado'
    return null
}

function requireOnBoard(state: GameState, unitId: string): string | null {
    return state.units[unitId].position ? null : 'La unidad está en la Reserva'
}

// La acción primaria (Attack, Dash, Energize, Rescue) es obligatoria y única.
function takePrimary(state: GameState): string | null {
    if (state.hasUsedPrimaryAction) return 'Ya usaste tu acción primaria en esta activación'
    state.hasUsedPrimaryAction = true
    return null
}

// ─── MOVIMIENTO ───────────────────────────────────────────────────────────────

function moveAlongPath(state: GameState, unitId: string, to: HexCoord, verb: string, playerId: PlayerId): void {
    const unit = state.units[unitId]
    const from = unit.position!
    const before = adjacentEnemyKeys(state, unitId)
    state.board[hexKey(from)].occupiedBy = null
    state.board[hexKey(to)].occupiedBy = unitId
    unit.position = to
    state.activation!.moved = true
    collectTokens(state, unitId)
    pushLog(state, playerId, `${unit.name} ${verb} de (${from.q},${from.r}) a (${to.q},${to.r})`, 'move',
        [hexKey(from), hexKey(to)])
    triggerAfterMove(state, unitId, before)
}

export function applyAdvance(state: GameState, unitId: string, to: HexCoord, playerId: PlayerId): ActionResult {
    const err = validateTurn(state, unitId, playerId) ?? requireOnBoard(state, unitId)
    if (err) return fail(err)
    if (state.activation!.advanced) return fail('Ya hiciste tu Advance en esta activación')

    const s = cloneState(state)
    const unit = s.units[unitId]
    s.activation!.advanced = true

    // Slow: el próximo Advance no mueve y se retira el estado.
    if (unit.statusEffects.some(e => e.type === 'slow')) {
        unit.statusEffects = unit.statusEffects.filter(e => e.type !== 'slow')
        pushLog(s, playerId, `${unit.name} está Slowed: su Advance no le mueve`, 'move')
        return { success: true, newState: s }
    }

    const path = findPath(unit.position!, to, s.board, moveOptionsFor(s, unitId, { kind: 'advance' }))
    if (!path) return fail('Movimiento no válido o fuera de alcance')
    moveAlongPath(s, unitId, to, 'avanzó', playerId)
    s.actionLog.push({ type: 'ADVANCE', unitId, to })
    openAdvanceResponseWindow(s, unitId, playerId)
    return { success: true, newState: s }
}

// Carta Response "Iron Grip" (después de que un enemigo termine su movimiento adyacente)
function openAdvanceResponseWindow(s: GameState, unitId: string, playerId: PlayerId): void {
    const opponent: PlayerId = playerId === 'player1' ? 'player2' : 'player1'
    const hasCard = s.players[opponent].tactics.hand.some(c =>
        c.type === 'response' && c.effectData?.trigger === 'after_enemy_advance')
    const pos = s.units[unitId].position
    if (!hasCard || !pos) return
    const adjacentToOpponent = getNeighbors(pos).some(n => {
        const occ = s.board[hexKey(n)]?.occupiedBy
        return occ && s.units[occ]?.playerId === opponent
    })
    if (adjacentToOpponent) s.pendingResponse = { trigger: 'after_enemy_advance', forPlayerId: opponent, movedUnitId: unitId }
}

export function applyDash(state: GameState, unitId: string, to: HexCoord, playerId: PlayerId): ActionResult {
    const err = validateTurn(state, unitId, playerId) ?? requireOnBoard(state, unitId)
    if (err) return fail(err)

    const s = cloneState(state)
    // Un Dash a TL 0 concedido por un efecto es una acción adicional (no gasta la primaria).
    const free = s.activation!.freeDashes > 0
    if (free) s.activation!.freeDashes -= 1
    else {
        const e = takePrimary(s)
        if (e) return fail(e)
    }

    const unit = s.units[unitId]
    const path = findPath(unit.position!, to, s.board, moveOptionsFor(s, unitId, { kind: 'dash' }))
    if (!path) return fail('Dash no válido o fuera de alcance')
    if (!free) s.timeline = advanceToken(s.timeline, unitId, 2)
    moveAlongPath(s, unitId, to, free ? 'hizo un Dash adicional' : 'hizo Dash', playerId)
    triggerAfterDash(s, unitId)
    s.actionLog.push({ type: 'DASH', unitId, to })
    return { success: true, newState: s }
}

// ─── ENERGIZE ─────────────────────────────────────────────────────────────────

export function applyEnergize(state: GameState, unitId: string, playerId: PlayerId): ActionResult {
    const err = validateTurn(state, unitId, playerId)
    if (err) return fail(err)
    const s = cloneState(state)
    const e = takePrimary(s)
    if (e) return fail(e)
    s.units[unitId].energy += 1
    s.timeline = advanceToken(s.timeline, unitId, 2)
    s.actionLog.push({ type: 'ENERGIZE', unitId })
    pushLog(s, playerId, `${s.units[unitId].name} se energizó (+1 Energy)`, 'ability')
    return { success: true, newState: s }
}

// ─── RESCUE ───────────────────────────────────────────────────────────────────

export function applyRescue(state: GameState, unitId: string, garrisonId: string, playerId: PlayerId): ActionResult {
    const err = validateTurn(state, unitId, playerId) ?? requireOnBoard(state, unitId)
    if (err) return fail(err)
    const entry = Object.entries(state.board).find(([, h]) => h.garrisonToken?.id === garrisonId)
    if (!entry) return fail('Garrison no encontrada')
    const [key, hex] = entry
    if (hex.garrisonToken!.owner !== playerId) return fail('Solo puedes rescatar Garrisons aliadas')
    if (gridDistance(state.units[unitId].position!, hex.coord) > 1) return fail('La Garrison no está adyacente')

    const s = cloneState(state)
    const e = takePrimary(s)
    if (e) return fail(e)
    s.timeline = advanceToken(s.timeline, unitId, 2)
    rescueGarrison(s, unitId, key)
    s.actionLog.push({ type: 'RESCUE', unitId, garrisonId })

    const hasCard = s.players[playerId].tactics.hand.some(c =>
        c.type === 'response' && c.effectData?.trigger === 'after_rescue')
    if (hasCard) s.pendingResponse = { trigger: 'after_rescue', forPlayerId: playerId, rescuerUnitId: unitId }
    return { success: true, newState: s }
}

// ─── ATTACK ───────────────────────────────────────────────────────────────────

function attackAt(
    state: GameState, unitId: string, weaponIndex: number, targetKey: string, playerId: PlayerId, rng: Rng,
): ActionResult {
    const err = validateTurn(state, unitId, playerId) ?? requireOnBoard(state, unitId)
    if (err) return fail(err)
    const unit = state.units[unitId]
    const weapon = unit.weapons[weaponIndex]
    if (!weapon) return fail('Arma no encontrada')
    if (weapon.energyCost && unit.energy < weapon.energyCost) return fail('No hay suficiente Energy')

    const check = checkAttackTarget(state, unitId, weaponIndex, targetKey)
    if (!check.ok) return fail(check.reason!)

    const s = cloneState(state)
    const act = s.activation!
    const freeIdx = act.freeAttacks.indexOf(weaponIndex)
    if (freeIdx !== -1) act.freeAttacks.splice(freeIdx, 1)
    else {
        const e = takePrimary(s)
        if (e) return fail(e)
        s.timeline = advanceToken(s.timeline, unitId, weapon.tlCost)   // el TL se paga al declarar
    }
    if (weapon.energyCost) s.units[unitId].energy -= weapon.energyCost

    const target = targetAt(s, targetKey, playerId)!
    act.attacksMade.push(weaponIndex)
    s.actionLog.push(target.kind === 'unit'
        ? { type: 'ATTACK', unitId, weaponIndex, targetId: target.id }
        : { type: 'ATTACK_GARRISON', unitId, weaponIndex, garrisonId: target.id })
    startAttack(s, unitId, weapon, targetKey, rng)
    return { success: true, newState: s }
}

export function applyAttack(
    state: GameState, unitId: string, weaponIndex: number, targetId: string, playerId: PlayerId, rng: Rng = rollD10,
): ActionResult {
    const target = state.units[targetId]
    if (!target) return fail('Objetivo no encontrado')
    if (!target.position) return fail('El objetivo está en la Reserva')
    if (target.playerId === playerId) return fail('No puedes atacar unidades aliadas')
    return attackAt(state, unitId, weaponIndex, hexKey(target.position), playerId, rng)
}

export function applyAttackGarrison(
    state: GameState, unitId: string, weaponIndex: number, garrisonId: string, playerId: PlayerId, rng: Rng = rollD10,
): ActionResult {
    const entry = Object.entries(state.board).find(([, h]) => h.garrisonToken?.id === garrisonId)
    if (!entry) return fail('Garrison no encontrada')
    if (entry[1].garrisonToken!.owner === playerId) return fail('No puedes atacar tus propias Garrisons')
    return attackAt(state, unitId, weaponIndex, entry[0], playerId, rng)
}

// ─── HABILIDADES COMMAND ──────────────────────────────────────────────────────
// Cada Command se usa como máximo una vez por activación. No gasta la acción
// primaria; paga Energy (y TL si la habilidad lo indica).

export function applyUseAbility(
    state: GameState, unitId: string, abilityIndex: number, playerId: PlayerId,
    targetId?: string, targetHex?: HexCoord, rng: Rng = rollD10,
): ActionResult {
    const err = validateTurn(state, unitId, playerId) ?? requireOnBoard(state, unitId)
    if (err) return fail(err)
    const unit = state.units[unitId]
    const ability = unit.abilities[abilityIndex]
    if (!ability) return fail('Habilidad no encontrada')
    if (ability.type !== 'CMD') return fail('Solo se pueden activar habilidades Command')
    if (!ability.abilityData) return fail(`"${ability.name}" aún no está implementada`)
    if (state.activation!.usedCommands.includes(abilityIndex)) return fail('Ya usaste esa habilidad en esta activación')
    const energyCost = ability.energyCost ?? 0
    if (unit.energy < energyCost) return fail('Energy insuficiente')

    const s = cloneState(state)
    const res = applyCommandAbility(s, unitId, abilityIndex, playerId, targetId, targetHex, rng)
    if (!res.success) return fail(res.error!)
    s.activation!.usedCommands.push(abilityIndex)
    s.units[unitId].energy -= energyCost
    if (ability.tlCost) s.timeline = advanceToken(s.timeline, unitId, ability.tlCost)
    s.actionLog.push({ type: 'USE_ABILITY', unitId, abilityIndex, targetId, targetHex })
    pushLog(s, playerId, `${unit.name} usó "${ability.name}"`, 'ability')
    return { success: true, newState: s }
}

// ─── CARTAS DE TACTICS ────────────────────────────────────────────────────────
// Máximo una carta por activación. Las Command no gastan la acción primaria.

export function applyPlayCard(
    state: GameState, unitId: string, cardId: string, playerId: PlayerId,
    targetId?: string, targetHex?: HexCoord, rng: Rng = rollD10,
): ActionResult {
    const err = validateTurn(state, unitId, playerId)
    if (err) return fail(err)
    if (state.activation!.cardPlayed) return fail('Solo puedes jugar una carta por activación')
    const hand = state.players[playerId].tactics.hand
    const card = hand.find(c => c.id === cardId)
    if (!card) return fail('La carta no está en tu mano')
    if (card.type === 'response') return fail('Las cartas Response se juegan cuando se cumple su condición')
    if (card.signature && card.signature !== state.units[unitId].signature) {
        return fail(`Solo la unidad "${card.signature}" puede jugar esta carta`)
    }
    if (!card.effectData && card.type !== 'attack') return fail(`"${card.name}" aún no está implementada`)

    const s = cloneState(state)
    let attackKey: string | null = null
    if (card.type === 'attack') {
        // Carta Attack: sustituye al ataque primario y ataca con el arma de la carta.
        if (!card.weapon) return fail(`"${card.name}" no tiene arma definida`)
        const e = takePrimary(s)
        if (e) return fail(e)
        const unitPos = s.units[unitId].position
        if (!unitPos) return fail('La unidad está en la Reserva')
        const target = targetId ? s.units[targetId] : null
        attackKey = target?.position ? hexKey(target.position)
            : Object.entries(s.board).find(([, h]) => h.garrisonToken?.id === targetId)?.[0] ?? null
        if (!attackKey) return fail('Elige un objetivo para el ataque')
        const check = checkAttackTargetWith(s, unitId, card.weapon, attackKey)
        if (!check.ok) return fail(check.reason!)
        s.timeline = advanceToken(s.timeline, unitId, card.weapon.tlCost)
    } else {
        const res = applyCardEffect(s, playerId, unitId, card.effectData!, targetId, targetHex)
        if (!res.success) return fail(res.error!)
    }
    if (card.tlCost) s.timeline = advanceToken(s.timeline, unitId, card.tlCost)
    const tactics = s.players[playerId].tactics
    tactics.hand = tactics.hand.filter(c => c.id !== cardId)
    tactics.discarded.push(card)
    s.activation!.cardPlayed = true
    s.actionLog.push({ type: 'PLAY_CARD', unitId, cardId, targetId, targetHex })
    pushLog(s, playerId, `${s.players[playerId].name} jugó "${card.name}"`, 'card')
    if (attackKey && card.weapon) startAttack(s, unitId, card.weapon, attackKey, rng)
    return { success: true, newState: s }
}

// ─── FIN DE ACTIVACIÓN ────────────────────────────────────────────────────────

export function applyEndActivation(state: GameState, unitId: string, playerId: PlayerId): ActionResult {
    const err = validateTurn(state, unitId, playerId)
    if (err) return fail(err)
    if (!state.hasUsedPrimaryAction) {
        return fail('Debes hacer una acción primaria (Atacar, Dash, Energize o Rescue) antes de terminar')
    }
    const unit = state.units[unitId]
    // Ninguna unidad puede terminar su activación sobre una Base (si aún puede moverse).
    if (unit.position && baseOwnerAt(state, hexKey(unit.position)) !== null && !state.activation!.advanced &&
        reachableFor(state, unitId, { kind: 'advance' }).size > 0) {
        return fail('No puedes terminar la activación sobre la Base: haz Advance a otro hex')
    }

    const s = cloneState(state)
    s.actionLog.push({ type: 'END_ACTIVATION', unitId })
    pushLog(s, playerId, `${unit.name} terminó su activación`, 'end')
    contestObjectives(s, unitId)
    return { success: true, newState: endActivation(s) }
}

// ─── RESPONSE ─────────────────────────────────────────────────────────────────

export function applyPlayResponse(state: GameState, cardId: string, playerId: PlayerId, rng: Rng = rollD10): ActionResult {
    const pending = state.pendingResponse
    if (!pending || pending.forPlayerId !== playerId) return fail('No hay ventana de respuesta para ti')
    const card = state.players[playerId].tactics.hand.find(c => c.id === cardId)
    if (!card) return fail('La carta no está en tu mano')
    if (card.type !== 'response') return fail('Solo puedes usar cartas Response')
    if (!card.effectData || card.effectData.trigger !== pending.trigger) return fail('Esta carta no responde a lo que acaba de pasar')

    const s = cloneState(state)
    if (isAttackResponse(card.effectData, s)) {
        if (!canPlayAttackResponse(s, playerId, card, pending.trigger)) return fail('No cumples las condiciones de esta carta')
        const err = applyAttackResponse(s, playerId, card, rng)
        if (err) return fail(err)
    } else {
        const res = applyResponseCardEffect(s, playerId, card.effectData, pending, rng)
        if (!res.success) return fail(res.error!)
    }
    const tactics = s.players[playerId].tactics
    tactics.hand = tactics.hand.filter(c => c.id !== cardId)
    tactics.discarded.push(card)
    if (playerId === s.activePlayerId && s.activation) s.activation.cardPlayed = true
    s.actionLog.push({ type: 'PLAY_RESPONSE', cardId })
    pushLog(s, playerId, `${s.players[playerId].name} respondió con "${card.name}"`, 'card')
    closeResponseWindow(s, rng)
    return { success: true, newState: s }
}

export function applyPassResponse(state: GameState, playerId: PlayerId, rng: Rng = rollD10): ActionResult {
    if (!state.pendingResponse || state.pendingResponse.forPlayerId !== playerId) return fail('No hay ventana de respuesta para ti')
    const s = cloneState(state)
    pushLog(s, playerId, `${s.players[playerId].name} no responde`, 'card')
    closeResponseWindow(s, rng)
    return { success: true, newState: s }
}

// ─── DISPATCHER ───────────────────────────────────────────────────────────────

export function applyAction(state: GameState, action: GameAction, playerId: PlayerId, rng: Rng = rollD10): ActionResult {
    switch (action.type) {
        case 'ADVANCE': return applyAdvance(state, action.unitId, action.to, playerId)
        case 'ATTACK': return applyAttack(state, action.unitId, action.weaponIndex, action.targetId, playerId, rng)
        case 'ATTACK_GARRISON': return applyAttackGarrison(state, action.unitId, action.weaponIndex, action.garrisonId, playerId, rng)
        case 'DASH': return applyDash(state, action.unitId, action.to, playerId)
        case 'ENERGIZE': return applyEnergize(state, action.unitId, playerId)
        case 'RESCUE': return applyRescue(state, action.unitId, action.garrisonId, playerId)
        case 'USE_ABILITY': return applyUseAbility(state, action.unitId, action.abilityIndex, playerId, action.targetId, action.targetHex, rng)
        case 'PLAY_CARD': return applyPlayCard(state, action.unitId, action.cardId, playerId, action.targetId, action.targetHex, rng)
        case 'END_ACTIVATION': return applyEndActivation(state, action.unitId, playerId)
        case 'PLAY_RESPONSE': return applyPlayResponse(state, action.cardId, playerId, rng)
        case 'PASS_RESPONSE': return applyPassResponse(state, playerId, rng)
        default: return fail('Acción desconocida')
    }
}
