// Un token en el Timeline
export interface TimelineToken {
    unitId: string
    playerId: 'player1' | 'player2'
}

// Un slot del Timeline (round 1-20)
export interface TimelineSlot {
    round: number
    tokens: TimelineToken[]  // apilados, el primero activa antes
}

// El Timeline completo — 20 slots continuos (rounds 1–20)
// Fase 1 = rounds 1–10  |  Fase 2 = rounds 11–20
// Los tokens fluyen sin reset: un token en round 9 con coste 3 va al round 12 (fase 2)
export interface Timeline {
    slots: TimelineSlot[]   // siempre 20 slots
    currentRound: number    // round activo ahora mismo
}