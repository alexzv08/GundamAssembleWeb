import type { Timeline, TimelineSlot, TimelineToken, GameState, PlayerId } from '../types'

// ─── CREAR TIMELINE VACÍO ─────────────────────────────────────────────────────
export function createEmptyTimeline(): Timeline {
    const slots: TimelineSlot[] = []
    for (let i = 1; i <= 10; i++) {
        slots.push({ round: i, tokens: [] })
    }
    return { slots, currentRound: 1 }
}

// ─── COLOCAR TOKEN INICIAL ────────────────────────────────────────────────────
// Al inicio del juego cada unidad se coloca en su startingTl
// Si ya hay tokens en ese slot, el nuevo va DEBAJO (al final del array)
export function placeInitialToken(
    timeline: Timeline,
    token: TimelineToken,
    round: number
): Timeline {
    const slots = timeline.slots.map(slot => {
        if (slot.round !== round) return slot
        return { ...slot, tokens: [...slot.tokens, token] }
    })
    return { ...timeline, slots }
}

// ─── QUIÉN ACTIVA AHORA ───────────────────────────────────────────────────────
// Busca el slot con round más bajo que tenga tokens
// Devuelve el token que está en la cima (índice 0) de ese slot
export function getNextActivation(timeline: Timeline): TimelineToken | null {
    for (const slot of timeline.slots) {
        if (slot.tokens.length > 0) {
            return slot.tokens[0]
        }
    }
    return null  // no quedan tokens → fase terminada
}

// Devuelve el round del próximo token activo
export function getCurrentRound(timeline: Timeline): number | null {
    for (const slot of timeline.slots) {
        if (slot.tokens.length > 0) return slot.round
    }
    return null
}

// ─── AVANZAR TOKEN ────────────────────────────────────────────────────────────
// Cuando una unidad usa Attack / Dash / Energize / Rescue,
// su token avanza tlCost posiciones en el Timeline.
// Si el slot destino ya tiene tokens, el nuevo va DEBAJO de los existentes.
// Si pasa de round 10 → se descarta (la unidad no activa más esta fase)
export function advanceToken(
    timeline: Timeline,
    unitId: string,
    tlCost: number
): Timeline {
    // 1. Encontrar el slot actual del token
    let currentSlot: TimelineSlot | null = null
    let tokenIndex = -1

    for (const slot of timeline.slots) {
        const idx = slot.tokens.findIndex(t => t.unitId === unitId)
        if (idx !== -1) {
            currentSlot = slot
            tokenIndex = idx
            break
        }
    }

    if (!currentSlot || tokenIndex === -1) return timeline  // token no encontrado

    const token = currentSlot.tokens[tokenIndex]
    const newRound = currentSlot.round + tlCost

    // 2. Quitar el token del slot actual
    const slots = timeline.slots.map(slot => {
        if (slot.round !== currentSlot!.round) return slot
        return {
            ...slot,
            tokens: slot.tokens.filter((_, i) => i !== tokenIndex)
        }
    })

    // 3. Si newRound > 10, el token sale del tablero esta fase
    if (newRound > 10) {
        return { ...timeline, slots }
    }

    // 4. Colocar el token en el nuevo slot (debajo de los existentes)
    const finalSlots = slots.map(slot => {
        if (slot.round !== newRound) return slot
        return { ...slot, tokens: [...slot.tokens, token] }
    })

    return { ...timeline, slots: finalSlots }
}

// ─── AVANZAR TOKEN AL SER DERROTADO ──────────────────────────────────────────
// Cuando una unidad es derrotada su token avanza +2
export function advanceTokenOnDefeat(
    timeline: Timeline,
    unitId: string
): Timeline {
    return advanceToken(timeline, unitId, 2)
}

// ─── RESOLVER DESEMPATE ───────────────────────────────────────────────────────
// Si dos tokens del mismo round son de jugadores distintos,
// activa primero el jugador que NO actuó en el turno anterior.
// Devuelve el playerId que debe activar primero.
export function resolveInitiativeTie(
    slot: TimelineSlot,
    lastActivePlayer: PlayerId | null
): PlayerId {
    const players = slot.tokens.map(t => t.playerId)
    const bothPresent = players.includes('player1') && players.includes('player2')

    if (!bothPresent) {
        return slot.tokens[0].playerId
    }

    // El que NO actuó último va primero
    if (lastActivePlayer === 'player1') return 'player2'
    if (lastActivePlayer === 'player2') return 'player1'

    // Si nadie ha actuado aún, player1 va primero
    return 'player1'
}

// ─── REORDENAR SLOT POR DESEMPATE ─────────────────────────────────────────────
// Reorganiza los tokens de un slot para que el jugador correcto esté arriba
export function reorderSlotForTie(
    timeline: Timeline,
    round: number,
    lastActivePlayer: PlayerId | null
): Timeline {
    const slots = timeline.slots.map(slot => {
        if (slot.round !== round) return slot

        const hasP1 = slot.tokens.some(t => t.playerId === 'player1')
        const hasP2 = slot.tokens.some(t => t.playerId === 'player2')

        if (!hasP1 || !hasP2) return slot  // no hay empate, no reordenar

        const firstPlayer = resolveInitiativeTie(slot, lastActivePlayer)

        // Poner los tokens del firstPlayer primero, manteniendo orden interno
        const first = slot.tokens.filter(t => t.playerId === firstPlayer)
        const second = slot.tokens.filter(t => t.playerId !== firstPlayer)

        return { ...slot, tokens: [...first, ...second] }
    })

    return { ...timeline, slots }
}

// ─── RESET DE FASE ────────────────────────────────────────────────────────────
// Al acabar la Fase 1 (round 10), los tokens que quedaron fuera
// no vuelven — el reset solo limpia el currentRound.
// Las unidades que no llegaron a actuar en la fase no tienen token.
// En la Fase 2, las unidades colocan sus tokens según su startingTl de nuevo.
export function resetForPhase2(
    timeline: Timeline,
    units: { unitId: string; playerId: PlayerId; startingTl: number }[]
): Timeline {
    // Crear timeline limpio
    let newTimeline = createEmptyTimeline()

    // Recolocar todos los tokens con sus startingTl originales
    for (const unit of units) {
        const token: TimelineToken = { unitId: unit.unitId, playerId: unit.playerId }
        newTimeline = placeInitialToken(newTimeline, token, unit.startingTl)
    }

    return newTimeline
}

// ─── HELPERS DE CONSULTA ──────────────────────────────────────────────────────

// ¿En qué round está el token de una unidad?
export function getUnitRound(timeline: Timeline, unitId: string): number | null {
    for (const slot of timeline.slots) {
        if (slot.tokens.some(t => t.unitId === unitId)) {
            return slot.round
        }
    }
    return null  // unidad derrotada o fuera de la fase
}

// ¿Tiene una unidad token en el Timeline? (si no, está derrotada o esperando fase 2)
export function unitHasToken(timeline: Timeline, unitId: string): boolean {
    return getUnitRound(timeline, unitId) !== null
}

// Todos los tokens de un jugador en el Timeline
export function getPlayerTokens(
    timeline: Timeline,
    playerId: PlayerId
): { unitId: string; round: number }[] {
    const result: { unitId: string; round: number }[] = []
    for (const slot of timeline.slots) {
        for (const token of slot.tokens) {
            if (token.playerId === playerId) {
                result.push({ unitId: token.unitId, round: slot.round })
            }
        }
    }
    return result
}