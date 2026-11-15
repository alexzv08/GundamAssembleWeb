// Ciclo de activaciones, fases y fin de partida (Core Rulebook v1.2, "The
// Timeline (TL) System", "Ending a Phase", "Deploying your Units").
// Las funciones MUTAN el estado recibido y lo devuelven.
import type { GameState, ActivationState, PlayerId } from '../types'
import { hexKey, getNeighbors } from './hexGrid'
import { advanceToken, getNextActivation, getCurrentRound, reorderSlotForTie } from './timeline'
import { reactivateShields, pushLog } from './damage'
import { collectTokens, applySetupAbilities } from './effects'
import { scoreObjectives, decideWinner } from './victory'

export function newActivation(unitId: string): ActivationState {
    return {
        unitId, advanced: false, moved: false, usedCommands: [], cardPlayed: false,
        freeDashes: 0, freeAttacks: [], attacksMade: [], strengthBonus: 0, accuracyBonus: 0,
        weaponStrengthBonus: {}, destroyUpgradeOnHit: false, deployed: false,
        speedBonus: 0, hover: false, damageBonus: 0,
    }
}

function drawInPlace(state: GameState, playerId: PlayerId, count: number): void {
    const t = state.players[playerId].tactics
    t.hand.push(...t.deck.splice(0, Math.min(count, t.deck.length)))
}

// Despliegue: la primera vez que se activa (o tras ser derrotada) la unidad
// entra en el hex de su Base. Si está ocupado, en el primer hex libre adyacente.
// Si no hay sitio, hace Energize (2 TL) y sigue en la Reserva.
function deploy(state: GameState, unitId: string): boolean {
    const unit = state.units[unitId]
    const base = state.players[unit.playerId].deployHex
    if (!base) return false
    const candidates = [base, ...getNeighbors(base)]
    for (const c of candidates) {
        const key = hexKey(c)
        const hex = state.board[key]
        if (!hex || hex.occupiedBy || hex.garrisonToken || hex.terrain === 'impassable') continue
        hex.occupiedBy = unitId
        unit.position = c
        pushLog(state, unit.playerId, `${unit.name} se despliega`, 'move', [key])
        collectTokens(state, unitId)
        return true
    }
    return false
}

export function beginActivation(state: GameState): GameState {
    const unitId = state.activeUnitId
    if (!unitId) return state
    state.activation = newActivation(unitId)
    state.hasUsedPrimaryAction = false
    state.roundNumber = getCurrentRound(state.timeline) ?? state.roundNumber
    reactivateShields(state, unitId)

    const unit = state.units[unitId]
    if (!unit.position) {
        if (deploy(state, unitId)) {
            state.activation.deployed = true
        } else {
            unit.energy += 1
            state.timeline = advanceToken(state.timeline, unitId, 2)
            pushLog(state, unit.playerId, `${unit.name} no puede desplegarse: hace Energize y sigue en la Reserva`, 'move')
            return endActivation(state)
        }
    }
    return state
}

export function endActivation(state: GameState): GameState {
    state.lastActivePlayer = state.activePlayerId
    state.activation = null
    state.hasUsedPrimaryAction = false
    return advanceToNext(state)
}

function finishGame(state: GameState): GameState {
    scoreObjectives(state)
    const { winner, reason } = decideWinner(state)
    state.phase = 'finished'
    state.winner = winner
    state.winReason = reason
    state.activeUnitId = null
    pushLog(state, winner, reason, 'end')
    return state
}

function advanceToNext(state: GameState): GameState {
    const round = getCurrentRound(state.timeline)
    if (round !== null) state.timeline = reorderSlotForTie(state.timeline, round, state.lastActivePlayer)
    const next = getNextActivation(state.timeline)
    const nextRound = getCurrentRound(state.timeline)

    // Fin de la Fase 1: puntuar Objetivos, robar 3 cartas y empezar la Fase 2.
    if (state.phase === 'phase1' && (next === null || (nextRound ?? 0) > 10)) {
        scoreObjectives(state)
        drawInPlace(state, 'player1', 3)
        drawInPlace(state, 'player2', 3)
        state.phase = 'phase2'
        pushLog(state, state.activePlayerId, 'Fin de la Fase 1 — cada jugador roba 3 cartas', 'end')
    }

    if (next === null) return finishGame(state)

    state.activeUnitId = next.unitId
    state.activePlayerId = next.playerId
    return beginActivation(state)
}

// Al confirmar el setup: empieza la Fase 1 con la primera activación.
export function startGame(state: GameState): GameState {
    state.phase = 'phase1'
    applySetupAbilities(state)
    const first = getNextActivation(state.timeline)
    if (!first) return finishGame(state)
    state.activeUnitId = first.unitId
    state.activePlayerId = first.playerId
    return beginActivation(state)
}
