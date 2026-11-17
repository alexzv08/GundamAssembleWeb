// Dados del motor. Devuelve un d10 (1–10). En el modo mesa los dados los introduce
// el jugador: antes de cada tirada se llama a `need` con cuántos dados hacen falta y
// para qué, y si aún no los ha dado se lanza NeedDice (el motor guarda la acción y
// los pide; ver engine.ts).
import type { PlayerId } from '../types'

export type Rng = (() => number) & {
    need?: (n: number, reason: string, player?: PlayerId) => void
    supplied?: number[]     // modo mesa: todos los dados introducidos hasta ahora
}

export class NeedDice {
    constructor(public count: number, public reason: string, public forPlayerId: PlayerId | null = null) {}
}

// Tira n dados de golpe (avisando antes de cuántos hacen falta)
export function rollMany(rng: Rng, n: number, reason: string, player?: PlayerId): number[] {
    if (n <= 0) return []
    rng.need?.(n, reason, player)
    return Array.from({ length: n }, () => rng())
}

// Dados introducidos a mano: se consumen en orden; si faltan, NeedDice
export function manualDice(values: number[]): Rng {
    let i = 0
    const rng: Rng = () => {
        if (i >= values.length) throw new NeedDice(1, 'Tira 1 dado')
        return values[i++]
    }
    rng.need = (n, reason, player) => { if (values.length - i < n) throw new NeedDice(n - (values.length - i), reason, player ?? null) }
    rng.supplied = values
    return rng
}
