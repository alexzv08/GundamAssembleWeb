// Objetivos y victoria (Core Rulebook v1.2, "Controlling Objectives" y "Victory Points").
// Las funciones MUTAN el estado recibido (el llamador clona).
import type { GameState, PlayerId } from '../types'
import { hexKey, getNeighbors } from './hexGrid'
import { otherPlayer } from './queries'
import { pushLog } from './damage'

function unitsAround(state: GameState, key: string): { player1: number; player2: number } {
    const counts = { player1: 0, player2: 0 }
    const hex = state.board[key]
    if (!hex) return counts
    for (const k of [key, ...getNeighbors(hex.coord).map(hexKey)]) {
        const occ = state.board[k]?.occupiedBy
        const unit = occ ? state.units[occ] : null
        if (unit?.position) counts[unit.playerId]++
    }
    return counts
}

export function captureObjective(state: GameState, key: string, player: PlayerId): void {
    const obj = state.board[key]?.objectiveToken
    if (!obj) return
    obj.controlledBy = player
    pushLog(state, player, `Objetivo ${obj.id} capturado`, 'objective', [key])
}

// Al terminar la activación de una unidad que está en o junto a un Objetivo,
// lo disputa: si hay más unidades aliadas que enemigas alrededor, un Objetivo
// neutral pasa a ser suyo y uno del rival vuelve a neutral. El control se
// mantiene aunque la unidad se vaya.
export function contestObjectives(state: GameState, unitId: string): void {
    const unit = state.units[unitId]
    if (!unit?.position) return
    const myKey = hexKey(unit.position)
    const nearby = new Set([myKey, ...getNeighbors(unit.position).map(hexKey)])

    for (const key of nearby) {
        const obj = state.board[key]?.objectiveToken
        if (!obj) continue
        const counts = unitsAround(state, key)
        const mine = counts[unit.playerId]
        const theirs = counts[otherPlayer(unit.playerId)]
        if (mine <= theirs) continue
        if (obj.controlledBy === null) {
            captureObjective(state, key, unit.playerId)
        } else if (obj.controlledBy !== unit.playerId) {
            obj.controlledBy = null
            pushLog(state, unit.playerId, `Objetivo ${obj.id} neutralizado`, 'objective', [key])
        }
    }
}

// Al final de cada Fase: VP por cada Objetivo controlado.
export function scoreObjectives(state: GameState): { player1: number; player2: number } {
    const gained = { player1: 0, player2: 0 }
    for (const [key, hex] of Object.entries(state.board)) {
        const obj = hex.objectiveToken
        if (!obj?.controlledBy) continue
        gained[obj.controlledBy] += obj.vpValue
        pushLog(state, obj.controlledBy, `Objetivo ${obj.id}: +${obj.vpValue} VP`, 'objective', [key])
    }
    state.players.player1.vp += gained.player1
    state.players.player2.vp += gained.player2
    return gained
}

// Ganador al final de la partida. Empate → gana el último jugador que actuó.
export function decideWinner(state: GameState): { winner: PlayerId; reason: string } {
    const vp1 = state.players.player1.vp
    const vp2 = state.players.player2.vp
    if (vp1 !== vp2) {
        const winner: PlayerId = vp1 > vp2 ? 'player1' : 'player2'
        return { winner, reason: `Fin de la partida — ${vp1} VP contra ${vp2} VP` }
    }
    const winner = state.lastActivePlayer ?? state.activePlayerId
    return { winner, reason: `Empate a ${vp1} VP — gana quien actuó en último lugar` }
}
