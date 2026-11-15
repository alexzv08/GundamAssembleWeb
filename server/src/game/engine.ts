// Punto de entrada del motor: valida quién puede actuar, aplica la acción y
// resuelve lo que ocurre después (fin de activación si la unidad activa cae,
// cambio de fase y fin de partida, que viven en activation.ts).
//
// Push / Pull a elegir (Q&A 7): con `choosePushes`, cuando un movimiento forzado
// necesita que el jugador elija hex, la acción se descarta y el estado queda con
// `pendingForcedMove`. Con cada CHOOSE_FORCED_MOVE la acción original se vuelve a
// resolver desde el mismo estado, con los mismos dados ya tirados y las elecciones
// hechas hasta ahora, hasta que no falte ninguna.
import type { GameState, GameAction, PlayerId, HexCoord } from '../types'
import { applyAction } from './actions'
import { endActivation } from './activation'
import { cloneState, pushLog, withForcedChoices, NeedForcedChoice } from './damage'
import { rollD10, type Rng } from './combat'
import { forfeit } from './victory'

export interface ProcessResult {
    success: boolean
    error?: string
    state?: GameState
    phaseChanged: boolean
    gameOver: boolean
}

export interface ProcessOptions {
    /** El jugador elige cada hex de los Push / Pull (producción). Sin él, se elige solo. */
    choosePushes?: boolean
}

const no = (error: string): ProcessResult => ({ success: false, error, phaseChanged: false, gameOver: false })

export function processAction(
    state: GameState, action: GameAction, playerId: PlayerId, rng: Rng = rollD10, opts: ProcessOptions = {},
): ProcessResult {
    if (state.phase === 'setup') return no('La partida aún está en fase de preparación')
    if (state.phase === 'finished') return no('La partida ha terminado')

    // Rendirse se puede en cualquier momento, también fuera de turno
    if (action.type === 'SURRENDER') {
        const s = cloneState(state)
        forfeit(s, playerId, `${s.players[playerId].name} se rinde`)
        return { success: true, state: s, phaseChanged: false, gameOver: true }
    }

    const pf = state.pendingForcedMove
    if (action.type === 'CHOOSE_FORCED_MOVE') {
        if (!pf) return no('No hay ningún movimiento forzado pendiente')
        if (pf.forPlayerId !== playerId) return no('Le toca elegir al rival')
        const to = action.to
        if (to && !pf.request.options.some(o => o.q === to.q && o.r === to.r)) return no('Ese hex no es válido para el movimiento')
        const plans: (HexCoord | null)[][] = []
        for (let i = 0; i <= Math.max(pf.planIndex, pf.plans.length - 1); i++) plans.push([...(pf.plans[i] ?? [])])
        plans[pf.planIndex].push(to)
        let i = 0
        const replay: Rng = () => (i < pf.rolls.length ? pf.rolls[i++] : rng())
        return resolve({ ...state, pendingForcedMove: null }, pf.action, pf.actorId, replay, plans)
    }
    if (pf) return no('Esperando a que se elija el movimiento forzado')
    return resolve(state, action, playerId, rng, opts.choosePushes ? [] : null)
}

function resolve(state: GameState, action: GameAction, playerId: PlayerId, rng: Rng, plans: (HexCoord | null)[][] | null): ProcessResult {
    const rolls: number[] = []
    const recording: Rng = () => { const v = rng(); rolls.push(v); return v }
    try {
        return withForcedChoices(plans, () => run(state, action, playerId, recording))
    } catch (e) {
        if (!(e instanceof NeedForcedChoice)) throw e
        // Mismo lastAttack: el cliente no debe volver a mostrar los dados del ataque anterior
        const s = { ...cloneState(state), lastAttack: state.lastAttack }
        s.pendingForcedMove = {
            forPlayerId: e.forPlayerId, action, actorId: playerId, rolls,
            plans: plans ?? [], planIndex: e.planIndex, request: e.request,
        }
        return { success: true, state: s, phaseChanged: false, gameOver: false }
    }
}

function run(state: GameState, action: GameAction, playerId: PlayerId, rng: Rng): ProcessResult {
    const isResponse = action.type === 'PLAY_RESPONSE' || action.type === 'PASS_RESPONSE' ||
        action.type === 'USE_RESPONSE_ABILITY' || action.type === 'SET_AUTO_RESPONSES'
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
