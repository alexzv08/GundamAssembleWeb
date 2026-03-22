import type { GameState, PlayerId } from '../types'
import { hexKey } from './hexGrid'
import type { getCurrentRound, getNextActivation } from './timeline'
import { resetForPhase2 } from './timeline'

// ─── RESULTADO DE FIN DE PARTIDA ─────────────────────────────────────────────
export interface GameOverResult {
    isOver: boolean
    winner: PlayerId | null  // null = empate
    reason: string
}

// ─── COMPROBAR FIN DE PARTIDA ─────────────────────────────────────────────────
// Se llama después de cada acción. Comprueba todas las condiciones de victoria.
export function checkGameOver(state: GameState): GameOverResult {
    const notOver = { isOver: false, winner: null, reason: '' }

    // Solo comprobar si estamos en fase activa
    if (state.phase === 'setup' || state.phase === 'finished') return notOver

    // ── Condición 1: un jugador no tiene unidades vivas ──────────────────────
    const p1Units = Object.values(state.units).filter(
        u => u.playerId === 'player1' && u.currentHp > 0
    )
    const p2Units = Object.values(state.units).filter(
        u => u.playerId === 'player2' && u.currentHp > 0
    )

    if (p1Units.length === 0 && p2Units.length === 0) {
        return { isOver: true, winner: null, reason: 'Todas las unidades derrotadas — empate' }
    }
    if (p1Units.length === 0) {
        return { isOver: true, winner: 'player2', reason: 'Player 1 sin unidades' }
    }
    if (p2Units.length === 0) {
        return { isOver: true, winner: 'player1', reason: 'Player 2 sin unidades' }
    }

    // ── Condición 2: fin de Fase 2 (ambas fases completadas) ─────────────────
    if (state.phase === 'phase2') {
        const nextToken = getNextActivation(state.timeline)
        if (!nextToken) {
            // No quedan tokens en el timeline → la fase 2 terminó
            return resolveByVP(state, 'Fin de las dos fases')
        }
    }

    return notOver
}

// ─── RESOLVER POR VP ──────────────────────────────────────────────────────────
function resolveByVP(state: GameState, reason: string): GameOverResult {
    const vp1 = state.players.player1.vp
    const vp2 = state.players.player2.vp

    if (vp1 > vp2) return { isOver: true, winner: 'player1', reason: `${reason} — P1 ${vp1} VP vs P2 ${vp2} VP` }
    if (vp2 > vp1) return { isOver: true, winner: 'player2', reason: `${reason} — P2 ${vp2} VP vs P1 ${vp1} VP` }
    return { isOver: true, winner: null, reason: `${reason} — Empate a ${vp1} VP` }
}

// ─── CONTROL DE OBJETIVOS ─────────────────────────────────────────────────────
// Según las reglas: un objetivo está controlado si hay más unidades aliadas
// que enemigas en hexes adyacentes + el propio hex al final del round.
// Se llama al final de cada round (cuando currentRound avanza).

export interface ObjectiveControlResult {
    objectiveId: string
    controlledBy: PlayerId | null
    vpAwarded: number
    awardedTo: PlayerId | null
}

export function resolveObjectiveControl(state: GameState): {
    newState: GameState
    results: ObjectiveControlResult[]
} {
    const results: ObjectiveControlResult[] = []
    const newState = { ...state, board: { ...state.board } }

    for (const [key, hex] of Object.entries(state.board)) {
        if (!hex.objectiveToken) continue

        const obj = hex.objectiveToken

        // Contar unidades aliadas y enemigas en el hex y adyacentes
        const relevantKeys = [key, ...getAdjacentKeys(hex.coord)]

        let p1Count = 0
        let p2Count = 0

        for (const k of relevantKeys) {
            const h = state.board[k]
            if (!h?.occupiedBy) continue
            const unit = state.units[h.occupiedBy]
            if (!unit || unit.currentHp <= 0) continue
            if (unit.playerId === 'player1') p1Count++
            else p2Count++
        }

        // Determinar control
        let controlledBy: PlayerId | null = null
        if (p1Count > p2Count) controlledBy = 'player1'
        else if (p2Count > p1Count) controlledBy = 'player2'
        else controlledBy = null  // empate → nadie controla

        // Actualizar control en el tablero
        newState.board[key] = {
            ...hex,
            objectiveToken: { ...obj, controlledBy }
        }

        results.push({
            objectiveId: obj.id,
            controlledBy,
            vpAwarded: 0,
            awardedTo: null,
        })
    }

    return { newState, results }
}

// VP de objetivos se otorga al final de cada FASE (no cada round)
export function awardObjectiveVP(state: GameState): {
    newState: GameState
    vpAwarded: { player1: number; player2: number }
} {
    let p1VP = 0
    let p2VP = 0

    for (const hex of Object.values(state.board)) {
        if (!hex.objectiveToken) continue
        const { controlledBy, vpValue } = hex.objectiveToken
        if (controlledBy === 'player1') p1VP += vpValue
        if (controlledBy === 'player2') p2VP += vpValue
    }

    const newState = {
        ...state,
        players: {
            player1: { ...state.players.player1, vp: state.players.player1.vp + p1VP },
            player2: { ...state.players.player2, vp: state.players.player2.vp + p2VP },
        }
    }

    return { newState, vpAwarded: { player1: p1VP, player2: p2VP } }
}

// Helper: keys de los 6 hexes adyacentes
function getAdjacentKeys(coord: { q: number; r: number }): string[] {
    const dirs = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ]
    return dirs.map(d => hexKey({ q: coord.q + d.q, r: coord.r + d.r }))
}

// ─── TRANSICIÓN DE FASE ───────────────────────────────────────────────────────
// Se llama cuando getNextActivation devuelve null y phase === 'phase1'
// Otorga VP de objetivos, resetea el timeline y pasa a phase2

export function transitionToPhase2(state: GameState): GameState {
    // 1. Otorgar VP de objetivos de la fase 1
    const { newState: stateWithVP } = awardObjectiveVP(state)

    // 2. Resetear timeline con los startingTl de cada unidad viva
    const unitsForReset = Object.values(stateWithVP.units)
        .filter(u => u.currentHp > 0)
        .map(u => ({
            unitId: u.id,
            playerId: u.playerId,
            startingTl: u.startingTl,
        }))

    const newTimeline = resetForPhase2(stateWithVP.timeline, unitsForReset)

    return {
        ...stateWithVP,
        phase: 'phase2',
        timeline: newTimeline,
        roundNumber: 1,
    }
}

// ─── APLICAR FIN DE PARTIDA AL ESTADO ────────────────────────────────────────
export function applyGameOver(state: GameState, result: GameOverResult): GameState {
    // Otorgar VP de objetivos pendientes antes de cerrar
    const { newState } = awardObjectiveVP(state)

    return {
        ...newState,
        phase: 'finished',
        winner: result.winner,
    }
}