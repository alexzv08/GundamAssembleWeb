// Repetición de partidas.
// Una partida se guarda como su estado inicial (tras el setup) más la lista de
// acciones aceptadas, cada una con los dados que se tiraron al resolverla. Para
// verla, el servidor vuelve a ejecutar el motor con esos mismos dados: así se
// guarda poco (unos KB en vez de un estado por paso) y la repetición es exacta.
import type { GameAction, GameState, PlayerId, ReplaySummary } from '../types'
export type { ReplaySummary }
import { processAction, type ProcessOptions, type ProcessResult } from './engine'
import { rollD10, type Rng } from './combat'
import { cloneState } from './damage'
import { forfeit } from './victory'

export interface ReplayStep {
    playerId: PlayerId
    action: GameAction
    rolls: number[]
    /** Derrota impuesta por el servidor (tiempo agotado, abandono) en vez de una acción */
    forfeit?: string
}

export interface ReplayRecord {
    initial: GameState
    steps: ReplayStep[]
}

export interface Replay extends ReplayRecord {
    summary: ReplaySummary
    userIds: string[]
}

export const REPLAY_OPTS: ProcessOptions = { choosePushes: true }

export function startRecording(initial: GameState): ReplayRecord {
    return { initial: cloneState(initial), steps: [] }
}

// Ejecuta una acción con el motor apuntando los dados que se tiran
export function recordedAction(
    rec: ReplayRecord | null | undefined, state: GameState, action: GameAction, playerId: PlayerId,
    rng: Rng = rollD10, opts: ProcessOptions = REPLAY_OPTS,
): ProcessResult {
    const rolls: number[] = []
    const result = processAction(state, action, playerId, () => { const v = rng(); rolls.push(v); return v }, opts)
    if (rec && result.success && result.state) rec.steps.push({ playerId, action, rolls })
    return result
}

export function recordForfeit(rec: ReplayRecord | null | undefined, playerId: PlayerId, reason: string): void {
    rec?.steps.push({ playerId, action: { type: 'SURRENDER' }, rolls: [], forfeit: reason })
}

// Reconstruye todos los estados: frames[0] es el inicial y frames[i] el estado tras el paso i.
export function replayFrames(rec: ReplayRecord): GameState[] {
    let state = cloneState(rec.initial)
    state.turnClock = null
    const frames: GameState[] = [state]
    for (const step of rec.steps) {
        let next: GameState
        if (step.forfeit) {
            next = cloneState(state)
            forfeit(next, step.playerId, step.forfeit)
        } else {
            let i = 0
            const rng: Rng = () => i < step.rolls.length ? step.rolls[i++] : rollD10()
            const r = processAction(state, step.action, step.playerId, rng, REPLAY_OPTS)
            if (!r.success || !r.state) break   // no debería pasar: el registro viene del propio motor
            next = r.state
        }
        next.turnClock = null
        frames.push(next)
        state = next
    }
    return frames
}

export function summarize(id: string, rec: ReplayRecord, final: GameState, mapId: string, vsBot: boolean): ReplaySummary {
    return {
        id, createdAt: new Date().toISOString(), mapId,
        players: { player1: final.players.player1.name, player2: final.players.player2.name },
        winner: final.winner, winReason: final.winReason ?? '',
        vp: { player1: final.players.player1.vp, player2: final.players.player2.vp },
        steps: rec.steps.length, vsBot,
    }
}
