// Daño, derrota y movimiento forzado (Push / Pull).
// Todas las funciones MUTAN el estado que reciben: el llamador debe pasar una
// copia (cloneState) — así una acción entera se aplica sobre una sola copia.
import type { GameState, PlayerId, HexCoord, ForcedMoveRequest } from '../types'
import { hexKey, keyToHex, getNeighbors, gridDistance } from './hexGrid'
import { advanceToken, getCurrentRound } from './timeline'
import { otherPlayer, upgradeCount, rwsAt } from './queries'

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
    // Sus RWS vuelven a su reserva ("RWS Return")
    for (const r of Object.values(state.rws ?? {})) if (r.ownerUnitId === unitId) r.position = null
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
    if (unit.currentHp <= 0 && preventDefeat(state, unitId)) return { dealt, defeated: false }
    if (unit.currentHp <= 0) {
        defeatUnit(state, unitId)
        return { dealt, defeated: true }
    }
    return { dealt, defeated: false }
}

// Iron-Blooded Tenacity: "When Gundam Barbatos Lupus Rex would be defeated: Set
// its HP to 1 instead." Se juega sola si está en la mano (no se pierde nada).
// La parte "It Moves 2 and makes a Rex Claws attack" aún no se resuelve.
function preventDefeat(state: GameState, unitId: string): boolean {
    const unit = state.units[unitId]
    const tactics = state.players[unit.playerId].tactics
    const card = tactics.hand.find(c => c.effectData?.type === 'prevent_defeat' && (!c.signature || c.signature === unit.signature))
    if (!card) return false
    tactics.hand = tactics.hand.filter(c => c.id !== card.id)
    tactics.discarded.push(card)
    unit.currentHp = 1
    pushLog(state, unit.playerId, `${unit.name} resiste con "${card.name}" (queda a 1 HP)`, 'card')
    return true
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
        state.players[byPlayer].garrisonsDefeated = (state.players[byPlayer].garrisonsDefeated ?? 0) + 1
        pushLog(state, byPlayer, 'Garrison enemiga destruida (+2 VP)', 'objective', [key])
    }
    return true
}

// RWS (1 HP): al destruirla vuelve a la reserva de su unidad; el rival gana sus VP.
export function destroyRws(state: GameState, rwsId: string, byPlayer: PlayerId): boolean {
    const rws = state.rws?.[rwsId]
    if (!rws?.position) return false
    const key = hexKey(rws.position)
    rws.position = null
    if (rws.owner !== byPlayer) {
        state.players[byPlayer].vp += rws.vp
        pushLog(state, byPlayer, `${rws.name} destruido (+${rws.vp} VP)`, 'attack', [key])
    }
    return true
}

// Daño "directo" a lo que haya en un hex (habilidades, colisiones).
export function damageAt(state: GameState, key: string, amount: number, byPlayer: PlayerId): void {
    const hex = state.board[key]
    if (!hex || amount <= 0) return
    const rws = rwsAt(state, key)
    if (rws) destroyRws(state, rws.id, byPlayer)
    if (hex.occupiedBy) damageUnit(state, hex.occupiedBy, amount)
    else if (hex.garrisonToken) destroyGarrison(state, key, byPlayer)
}

// ─── PUSH / PULL ──────────────────────────────────────────────────────────────
// Core Rulebook "Push" / "Pull":
//  • Cada hex debe estar más lejos (Push) / más cerca (Pull) de la fuente.
//  • No se puede empujar a mayor elevación: choca con el terreno (2 de daño).
//  • Si choca con otra unidad o Garrison, todos los implicados reciben 2.
//  • Un enemigo ya adyacente a la misma elevación no puede ser atraído (Pull).
//  • Q&A 7: quien empuja elige cada hex y puede mover menos (incluso 0).
//
// Elección del jugador: si hay un contexto activo (lo pone engine.processAction
// con `choosePushes`), cada paso con hexes libres se toma de `plans`; si falta la
// elección, se lanza NeedForcedChoice y el motor pregunta al jugador. Sin
// contexto (tests, llamadas directas) se toma el primer hex libre a distancia máxima.

export class NeedForcedChoice {
    constructor(public request: ForcedMoveRequest, public forPlayerId: PlayerId, public planIndex: number) {}
}

interface ForcedCtx { plans: (HexCoord | null)[][]; index: number }
let forcedCtx: ForcedCtx | null = null

export function withForcedChoices<T>(plans: (HexCoord | null)[][] | null, fn: () => T): T {
    const prev = forcedCtx
    forcedCtx = plans ? { plans, index: 0 } : null
    try { return fn() } finally { forcedCtx = prev }
}

function isFreeForForcedMove(state: GameState, k: string, fromElevation: number): boolean {
    const h = state.board[k]
    return !!h && !h.occupiedBy && !h.garrisonToken && !rwsAt(state, k) && h.terrain !== 'impassable' && h.elevation <= fromElevation
}

// Hexes a los que puede ir la unidad en el siguiente paso (vacío si no puede moverse)
export function forcedMoveCandidates(state: GameState, sourceKey: string, unitId: string, mode: 'push' | 'pull'): { candidates: HexCoord[]; free: HexCoord[] } {
    const unit = state.units[unitId]
    if (!unit?.position) return { candidates: [], free: [] }
    const curHex = state.board[hexKey(unit.position)]
    const source = keyToHex(sourceKey)
    const curDist = gridDistance(source, unit.position)
    const srcHex = state.board[sourceKey]
    if (mode === 'pull' && curDist <= 1 && srcHex && srcHex.elevation === curHex.elevation) return { candidates: [], free: [] }
    // Q&A 16: nadie sale del tablero, y chocar con el borde no hace daño
    const candidates = getNeighbors(unit.position).filter(n => {
        if (!state.board[hexKey(n)]) return false
        const d = gridDistance(source, n)
        return mode === 'push' ? d > curDist : d < curDist && hexKey(n) !== sourceKey
    })
    return { candidates, free: candidates.filter(n => isFreeForForcedMove(state, hexKey(n), curHex.elevation)) }
}

export function forceMove(
    state: GameState, sourceKey: string, unitId: string, hexes: number, mode: 'push' | 'pull', byPlayer: PlayerId,
): void {
    const ctx = forcedCtx
    const planIndex = ctx ? ctx.index++ : -1
    for (let i = 0; i < hexes; i++) {
        const unit = state.units[unitId]
        if (!unit?.position) return
        const curKey = hexKey(unit.position)
        const curHex = state.board[curKey]
        const { candidates, free } = forcedMoveCandidates(state, sourceKey, unitId, mode)
        if (candidates.length === 0) return

        if (free.length) {
            let to: HexCoord = free[0]
            if (ctx) {
                const plan = ctx.plans[planIndex] ?? []
                if (plan.length <= i) {
                    throw new NeedForcedChoice({ unitId, mode, sourceKey, step: i + 1, total: hexes, options: free }, byPlayer, planIndex)
                }
                const chosen = plan[i]
                if (chosen === null) return   // el jugador decide parar aquí
                to = free.find(n => n.q === chosen.q && n.r === chosen.r) ?? free[0]
            }
            const k = hexKey(to)
            curHex.occupiedBy = null
            state.board[k].occupiedBy = unitId
            unit.position = to
            continue
        }

        // Colisión
        const blockedKey = hexKey(candidates[0])
        const blocked = state.board[blockedKey]
        if (blocked && (blocked.occupiedBy || blocked.garrisonToken || rwsAt(state, blockedKey))) {
            damageAt(state, blockedKey, 2, byPlayer)
        }
        damageUnit(state, unitId, 2)
        pushLog(state, byPlayer, `${unit.name} colisiona (2 de daño)`, 'attack', [curKey])
        return
    }
}
