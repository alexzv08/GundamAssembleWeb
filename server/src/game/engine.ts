// Punto de entrada del motor: valida quién puede actuar, aplica la acción y
// resuelve lo que ocurre después (fin de activación si la unidad activa cae,
// cambio de fase y fin de partida, que viven en activation.ts).
//
// Push / Pull a elegir (Q&A 7): con `choosePushes`, cuando un movimiento forzado
// necesita que el jugador elija hex, la acción se descarta y el estado queda con
// `pendingForcedMove`. Con cada CHOOSE_FORCED_MOVE la acción original se vuelve a
// resolver desde el mismo estado, con los mismos dados ya tirados y las elecciones
// hechas hasta ahora, hasta que no falte ninguna.
//
// Dados a mano (modo mesa, `manualDice`): igual que lo anterior, cuando la acción
// necesita dados que el jugador aún no ha dado se descarta y el estado queda con
// `pendingDice` (cuántos y para qué). Con SUBMIT_DICE se vuelve a resolver desde
// el mismo estado con todos los dados introducidos.
import type { GameState, GameAction, PlayerId, HexCoord } from '../types'
import { applyAction } from './actions'
import { endActivation } from './activation'
import { cloneState, pushLog, withForcedChoices, NeedForcedChoice } from './damage'
import { rollD10, type Rng } from './combat'
import { NeedDice, manualDice } from './dice'
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
    /** Modo mesa: los dados los introduce el jugador (SUBMIT_DICE) */
    manualDice?: boolean
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

    // Iron-Blooded Tenacity: con el ataque ya resuelto, solo se espera su movimiento y ataque
    const fu = state.pendingFollowUp
    if (fu && !state.pendingAttack && !state.pendingResponse && !state.pendingForcedMove && action.type !== 'FOLLOW_UP') {
        return no(`Esperando a que se resuelva ${fu.source}`)
    }

    // Modo mesa: el jugador dice qué cartas ha robado en la mesa real (en cualquier momento)
    if (action.type === 'MESA_DRAW') {
        const t = state.players[playerId].tactics
        const ids = Array.isArray(action.cardIds) ? action.cardIds : []
        if (!state.mesa || !t.toPick) return no('No hay cartas robadas pendientes de elegir')
        if (!ids.length || ids.length > t.toPick || new Set(ids).size !== ids.length) return no(`Elige hasta ${t.toPick} cartas distintas`)
        if (ids.some(id => !t.deck.some(c => c.id === id))) return no('Esa carta no está en tu mazo')
        const s = cloneState(state)
        const ts = s.players[playerId].tactics
        for (const id of ids) ts.hand.push(...ts.deck.splice(ts.deck.findIndex(c => c.id === id), 1))
        ts.toPick = (ts.toPick ?? 0) - ids.length
        pushLog(s, playerId, `${s.players[playerId].name} roba ${ids.length} ${ids.length === 1 ? 'carta' : 'cartas'}`, 'end')
        return { success: true, state: s, phaseChanged: false, gameOver: false }
    }

    const pd = state.pendingDice
    if (action.type === 'SUBMIT_DICE') {
        if (!pd) return no('No hay ninguna tirada pendiente')
        const vals = Array.isArray(action.values) ? action.values.map(Number) : []
        if (vals.length !== pd.count || vals.some(v => !Number.isInteger(v) || v < 1 || v > 10)) {
            return no(`Introduce ${pd.count} ${pd.count === 1 ? 'dado' : 'dados'} con valores del 1 al 10`)
        }
        return resolve({ ...state, pendingDice: null }, pd.action, pd.actorId, manualDice([...pd.rolls, ...vals]), pd.plans)
    }
    if (pd) return no('Faltan los dados de la tirada')

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
        const replay: Rng = opts.manualDice ? manualDice([...pf.rolls]) : () => (i < pf.rolls.length ? pf.rolls[i++] : rng())
        return resolve({ ...state, pendingForcedMove: null }, pf.action, pf.actorId, replay, plans)
    }
    if (pf) return no('Esperando a que se elija el movimiento forzado')
    return resolve(state, action, playerId, opts.manualDice ? manualDice([]) : rng, opts.choosePushes ? [] : null)
}

function resolve(state: GameState, action: GameAction, playerId: PlayerId, rng: Rng, plans: (HexCoord | null)[][] | null): ProcessResult {
    const rolls: number[] = []
    const recording: Rng = () => { const v = rng(); rolls.push(v); return v }
    if (rng.need) recording.need = rng.need
    // Dados que hay que conservar si la acción se queda a medias: en el modo mesa,
    // todos los introducidos (aunque aún no se hayan usado); si no, los ya tirados
    const kept = () => [...(rng.supplied ?? rolls)]
    try {
        return withForcedChoices(plans, () => run(state, action, playerId, recording))
    } catch (e) {
        if (e instanceof NeedDice) {
            const s = { ...cloneState(state), lastAttack: state.lastAttack }
            s.pendingDice = { forPlayerId: e.forPlayerId ?? playerId, action, actorId: playerId, rolls: kept(), plans, count: e.count, reason: e.reason }
            return { success: true, state: s, phaseChanged: false, gameOver: false }
        }
        if (!(e instanceof NeedForcedChoice)) throw e
        // Mismo lastAttack: el cliente no debe volver a mostrar los dados del ataque anterior
        const s = { ...cloneState(state), lastAttack: state.lastAttack }
        s.pendingForcedMove = {
            forPlayerId: e.forPlayerId, action, actorId: playerId, rolls: kept(),
            plans: plans ?? [], planIndex: e.planIndex, request: e.request,
        }
        return { success: true, state: s, phaseChanged: false, gameOver: false }
    }
}

function run(state: GameState, action: GameAction, playerId: PlayerId, rng: Rng): ProcessResult {
    const isResponse = action.type === 'PLAY_RESPONSE' || action.type === 'PASS_RESPONSE' ||
        action.type === 'USE_RESPONSE_ABILITY' || action.type === 'SET_AUTO_RESPONSES' || action.type === 'FOLLOW_UP'
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
