// Tipos de terreno del tablero
export type TerrainType = 'normal' | 'water' | 'elevation_1' | 'elevation_2' | 'elevation_3'

// Coordenadas en sistema axial (el mejor para hexágonos)
export interface HexCoord {
    q: number  // columna
    r: number  // fila
}

// Un arma de una unidad
export interface Weapon {
    name: string
    range: number        // en hexágonos
    strength: number     // número de dados a tirar
    tlCost: number       // coste en Timeline
    critEffect?: string  // descripción del efecto crítico
    energyCost?: number  // si requiere energía
}

// Tipos de habilidad
export type AbilityType = 'CMD' | 'ONG' | 'RSP'

// Una habilidad de una unidad
export interface Ability {
    name: string
    type: AbilityType
    description: string
    energyCost?: number
}

// Estado de una unidad en la partida
export interface Unit {
    id: string            // ej: "player1_rx78"
    name: string          // ej: "RX-78-2 Gundam"
    unitType: string      // ej: "Mobile Suit"
    traits: string[]      // ej: ["Federation", "Prototype"]

    // Stats base
    maxHp: number
    vp: number            // VP que da al rival al ser derrotado
    startingTl: number    // posición inicial en el Timeline

    // Estado actual
    currentHp: number
    energy: number        // tokens de energía actuales
    position: HexCoord | null  // null si aún no está en el tablero

    // Equipamiento
    weapons: Weapon[]
    abilities: Ability[]

    // Efectos activos
    statusEffects: StatusEffect[]
    upgrades: Upgrade[]

    // A qué jugador pertenece
    playerId: 'player1' | 'player2'

    // Si ya actuó este round
    activated: boolean
}

// Efectos de estado temporales
export interface StatusEffect {
    type: 'disarm' | 'fracture' | 'slow'
    // Todos duran "un uso" según las reglas
}

// Tokens de mejora recogidos del tablero
export interface Upgrade {
    type: 'attack' | 'movement' | 'shield' | 'energy'
    value: number
}