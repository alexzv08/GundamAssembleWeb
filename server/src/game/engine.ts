// Punto de entrada del motor: valida quién puede actuar, aplica la acción y
// resuelve lo que ocurre después (fin de activación si la unidad activa cae,
// cambio de fase y fin de partida, que viven en activation.ts).
import type { GameState, GameAction, PlayerId } from '../types'
import { applyAction } from './actions'
import { endActivation } from './activation'
import { cloneState, pushLog } from './damage'
import { rollD10, type Rng } from './combat'

export interface ProcessResult {
    success: boolean
    error?: string
    state?: GameState
    phaseChanged: boolean
    gameOver: boolean
}

export function processAction(state: GameState, action: GameAction, playerId: PlayerId, rng: Rng = rollD10): ProcessResult {
    const no = (error: string): ProcessResult => ({ success: false, error, phaseChanged: false, gameOver: false })
    if (state.phase === 'setup') return no('La partida aún está en fase de preparación')
    if (state.phase === 'finished') return no('La partida ha terminado')

    const isResponse = action.type === 'PLAY_RESPONSE' || action.type === 'PASS_RESPONSE'
    if (!isResponse && state.activePlayerId !== playerId) return no('No es tu turno')

    const result = applyAction(state, action, playerId, rng)
    if (!result.success || !result.newState) return no(result.error ?? 'Acción no válida')
    let s = result.newState

    // Si la unidad activa es derrotada durante su activación, esta termina ya
    // (una vez resueltas las ventanas de respuesta pendientes).
    const active = s.activeUnitId ? s.units[s.activeUnitId] : null
    if (!s.pendingResponse && s.activation && active && !active.position) {
        s = cloneState(s)
        pushLog(s, active.playerId, `La activación de ${active.name} termina al ser derrotado`, 'end')
        s = endActivation(s)
    }

    return { success: true, state: s, phaseChanged: s.phase !== state.phase, gameOver: s.phase === 'finished' }
}
