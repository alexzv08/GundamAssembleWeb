// Daño, derrota y movimiento forzado (Push / Pull).
// Todas las funciones MUTAN el estado que reciben: el llamador debe pasar una
// copia (cloneState) — así una acción entera se aplica sobre una sola copia.
import type { GameState, PlayerId } from '../types'
import { hexKey, keyToHex, getNeighbors, gridDistance } from './hexGrid'
import { advanceToken, getCurrentRound } from './timeline'
import { otherPlayer, upgradeCount } from './queries'

export function cloneState(state: GameState): GameState {
    return structuredClone(state)
}

export function pushLog(state: GameState, playerId: PlayerId, message: string,
    category: GameState['log'][number]['category'], hexes: string[] = []): void {
    state.log.push({ message, playerId, round: getCurrentRound(state.timeline), category, hexes })
}

// ─── DERROTA ──────────────────────────────────────────────────────────────────
// Core Rulebook "Defeated Units": el rival gana los VP, la unidad vuelve a la
// Reserva, su token avanza 2 en el Timeline, recupera todo el HP y pierde los
// estados. Conserva Energy y Upgrades. Si era la unidad activa, su activación
// termina inmediatamente (lo gestiona el motor con activeUnitDefeated).
export function defeatUnit(state: GameState, unitId: string): void {
    const unit = state.units[unitId]
    if (!unit) return
    const scorer = otherPlayer(unit.playerId)
    state.players[scorer].vp += unit.vp
    if (unit.position) {
        const key = hexKey(unit.position)
        if (state.board[key]?.occupiedBy === unitId) state.board[key].occupiedBy = null
    }
    unit.position = null
    unit.currentHp = unit.maxHp
    unit.statusEffects = []
    state.timeline = advanceToken(state.timeline, unitId, 2)
    pushLog(state, scorer, `¡${unit.name} derrotado! (+${unit.vp} VP)`, 'attack')
}

// ─── SHIELDS ──────────────────────────────────────────────────────────────────
// Cada Shield activo evita 1 de daño y se pone boca abajo. Se reactivan al
// inicio de la siguiente activación de la unidad (ver engine.beginActivation).
function absorbWithShields(state: GameState, unitId: string, amount: number): number {
    const unit = state.units[unitId]
    let remaining = amount
    for (const up of unit.upgrades) {
        if (remaining <= 0) break
        if (up.type !== 'shield' || up.active === false) continue
        up.active = false
        remaining -= Math.max(1, up.value)
    }
    return Math.max(0, remaining)
}

export function reactivateShields(state: GameState, unitId: string): void {
    for (const up of state.units[unitId]?.upgrades ?? []) {
        if (up.type === 'shield') up.active = true
    }
}

export function activeShields(state: GameState, unitId: string): number {
    const unit = state.units[unitId]
    return unit ? upgradeCount(unit, 'shield', true) : 0
}

// ─── DAÑO A UNIDADES ──────────────────────────────────────────────────────────
// combat=true para daño de ataque (activa Fracture). Devuelve el daño final.
export interface DamageResult { dealt: number; defeated: boolean }

export function damageUnit(state: GameState, unitId: string, amount: number, opts: { combat?: boolean } = {}): DamageResult {
    const unit = state.units[unitId]
    if (!unit?.position || amount <= 0) return { dealt: 0, defeated: false }

    let dealt = absorbWithShields(state, unitId, amount)

    // Fracture: la próxima vez que reciba 3+ de daño de combate en un ataque,
    // recibe 3 adicionales. Solo daño de combate.
    if (opts.combat && dealt >= 3 && unit.statusEffects.some(e => e.type === 'fracture')) {
        dealt += 3
        unit.statusEffects = unit.statusEffects.filter(e => e.type !== 'fracture')
    }

    unit.currentHp = Math.max(0, unit.currentHp - dealt)
    if (unit.currentHp <= 0) {
        defeatUnit(state, unitId)
        return { dealt, defeated: true }
    }
    return { dealt, defeated: false }
}

// ─── DAÑO A GARRISONS ─────────────────────────────────────────────────────────
// Las Garrisons tienen 1 HP. Quien destruye una Garrison enemiga gana 2 VP.
export function destroyGarrison(state: GameState, key: string, byPlayer: PlayerId): boolean {
    const hex = state.board[key]
    const garrison = hex?.garrisonToken
    if (!garrison) return false
    hex.garrisonToken = null
    if (garrison.owner !== byPlayer) {
        state.players[byPlayer].vp += 2
        pushLog(state, byPlayer, 'Garrison enemiga destruida (+2 VP)', 'objective', [key])
    }
    return true
}

// Daño "directo" a lo que haya en un hex (habilidades, colisiones).
export function damageAt(state: GameState, key: string, amount: number, byPlayer: PlayerId): void {
    const hex = state.board[key]
    if (!hex || amount <= 0) return
    if (hex.occupiedBy) damageUnit(state, hex.occupiedBy, amount)
    else if (hex.garrisonToken) destroyGarrison(state, key, byPlayer)
}

// ─── PUSH / PULL ──────────────────────────────────────────────────────────────
// Core Rulebook "Push" / "Pull":
//  • Cada hex debe estar más lejos (Push) / más cerca (Pull) de la fuente.
//  • No se puede empujar a mayor elevación: choca con el terreno (2 de daño).
//  • Si choca con otra unidad o Garrison, todos los implicados reciben 2.
//  • Un enemigo ya adyacente a la misma elevación no puede ser atraído (Pull).
// La elección de hex (que en mesa hace el jugador) se resuelve tomando el
// primer hex libre válido; si no hay ninguno, se produce la colisión.
export function forceMove(
    state: GameState, sourceKey: string, unitId: string, hexes: number, mode: 'push' | 'pull', byPlayer: PlayerId,
): void {
    for (let i = 0; i < hexes; i++) {
        const unit = state.units[unitId]
        if (!unit?.position) return
        const curKey = hexKey(unit.position)
        const curHex = state.board[curKey]
        const source = keyToHex(sourceKey)
        const curDist = gridDistance(source, unit.position)
        const srcHex = state.board[sourceKey]
        if (mode === 'pull' && curDist <= 1 && srcHex && srcHex.elevation === curHex.elevation) return

        const candidates = getNeighbors(unit.position).filter(n => {
            const d = gridDistance(source, n)
            return mode === 'push' ? d > curDist : d < curDist && hexKey(n) !== sourceKey
        })
        if (candidates.length === 0) return

        const isFree = (k: string) => {
            const h = state.board[k]
            return h && !h.occupiedBy && !h.garrisonToken && h.terrain !== 'impassable' && h.elevation <= curHex.elevation
        }
        const free = candidates.find(n => isFree(hexKey(n)))
        if (free) {
            const k = hexKey(free)
            curHex.occupiedBy = null
            state.board[k].occupiedBy = unitId
            unit.position = free
            continue
        }

        // Colisión
        const blockedKey = hexKey(candidates[0])
        const blocked = state.board[blockedKey]
        if (blocked && (blocked.occupiedBy || blocked.garrisonToken)) {
            damageAt(state, blockedKey, 2, byPlayer)
        }
        damageUnit(state, unitId, 2)
        pushLog(state, byPlayer, `${unit.name} colisiona (2 de daño)`, 'attack', [curKey])
        return
    }
}
