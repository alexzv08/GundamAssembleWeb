// Una carta de Tactics
export interface TacticsCard {
    id: string
    name: string
    requiredTrait: string    // trait que debe tener alguna unidad del squad
    effect: string           // descripción del efecto
    vpCondition?: string     // condición para ganar VP extra
}

// La mano y mazo de un jugador
export interface TacticsState {
    deck: TacticsCard[]      // boca abajo, no visible al rival
    hand: TacticsCard[]      // máximo 3 (+ 3 en fase 2)
    discarded: TacticsCard[] // ya jugadas
    usedResponseThisTurn: boolean  // restricción de la regla D
}