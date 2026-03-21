// Un token en el Timeline
export interface TimelineToken {
    unitId: string
    playerId: 'player1' | 'player2'
}

// Un slot del Timeline (round 1-10)
export interface TimelineSlot {
    round: number
    tokens: TimelineToken[]  // apilados, el primero activa antes
}

// El Timeline completo de una fase
export interface Timeline {
    slots: TimelineSlot[]   // siempre 10 slots (índice 0 = round 1)
    currentRound: number    // round activo ahora mismo
}