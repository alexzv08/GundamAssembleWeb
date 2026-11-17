// Tests del motor autoritativo (server/src/game). Cada bloque cita la regla
// del Core Rulebook v1.2 que comprueba.
import { describe, it, expect } from 'vitest'
import type { BoardMap, GameState, Unit, Weapon, Ability } from '../../types'
import { hexDistance, getNeighbors, hexKey, keyToHex, checkLineOfSight, getReachableHexes, coneHexes, patternHexes, gridDistance } from '../hexGrid'
import {
  createEmptyTimeline, placeInitialToken, getNextActivation, advanceToken, getUnitRound, reorderSlotForTie, retreatToken,
} from '../timeline'
import { reachableFor, checkAttackTarget, checkAttackTargetWith, isEngaged, baseOwnerAt } from '../queries'
import { applyAction, applyAdvance, applyAttack, applyAttackGarrison, applyEndActivation, applyUseAbility, applyDash } from '../actions'
import { processAction } from '../engine'
import { beginActivation, newActivation, startGame } from '../activation'
import { contestObjectives, scoreObjectives, decideWinner } from '../victory'
import { forceMove , drawTactics } from '../damage'
import { previewAttack } from '../combat'
import { validateSquad, validateDeck, loadUnitCatalog, loadTacticsCatalog, requiredDeckSize, eligibleCards } from '../catalog'
import { createServerGame } from '../createServerGame'
import { RoomManager } from '../../rooms/roomManager'
import { FileGameStore, MemoryReplayStore, FileReplayStore } from '../../rooms/gameStore'
import { startRecording, recordedAction, recordForfeit, replayFrames } from '../replay'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { listMaps, randomMapId } from '../maps'
import { randomSquad, randomDeck, chooseBotAction, actingPlayer, botFallback } from '../bot'
import { planActivation, suggestPlays, toSuggestion } from '../planner'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function makeBoard(cols = 8, rows = 8): BoardMap {
  const board: BoardMap = {}
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      board[`${q},${r}`] = {
        coord: { q, r }, terrain: 'normal', elevation: 0,
        occupiedBy: null, upgradeToken: null, garrisonToken: null, objectiveToken: null, deployZone: null,
      }
    }
  }
  return board
}

const weapon = (over: Partial<Weapon> = {}): Weapon =>
  ({ name: 'Rifle', range: 4, strength: 3, tlCost: 3, effectData: null, critData: null, ...over })

function makeUnit(id: string, playerId: 'player1' | 'player2', pos: { q: number; r: number } | null, over: Partial<Unit> = {}): Unit {
  return {
    id, name: id, unitType: 'Mobile Suit', traits: [], maxHp: 10, vp: 5, startingTl: 1,
    currentHp: 10, energy: 0, position: pos, weapons: [weapon(), weapon({ name: 'Saber', range: 1, strength: 4, tlCost: 2 })],
    abilities: [], statusEffects: [], upgrades: [], playerId, activated: false, ...over,
  }
}

// Partida en curso con la activación de units[0] ya empezada.
function makeGame(units: Unit[], board = makeBoard()): GameState {
  let tl = createEmptyTimeline()
  for (const u of units) tl = placeInitialToken(tl, { unitId: u.id, playerId: u.playerId }, u.startingTl)
  for (const u of units) if (u.position) board[hexKey(u.position)].occupiedBy = u.id
  const first = units[0]
  return {
    gameId: 't', phase: 'phase1', activePlayerId: first.playerId, activeUnitId: first.id,
    lastActivePlayer: null, roundNumber: 1, hasUsedPrimaryAction: false, activation: newActivation(first.id),
    board, units: Object.fromEntries(units.map(u => [u.id, u])), timeline: tl,
    players: {
      player1: { id: 'player1', name: 'P1', vp: 0, garrisonsRescued: 0, squadUnitIds: [], deployHex: { q: 0, r: 7 }, tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false } },
      player2: { id: 'player2', name: 'P2', vp: 0, garrisonsRescued: 0, squadUnitIds: [], deployHex: { q: 7, r: 7 }, tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false } },
    },
    actionLog: [], log: [], lastAttack: null, winner: null, pendingResponse: null, pendingAttack: null, rws: {},
  }
}

// Dados predefinidos (por defecto 1 = fallo)
const dice = (...seq: number[]) => { let i = 0; return () => seq[i++] ?? 1 }

// Fila 2 (par): (2,2) y (3,2) son adyacentes; (2,2)-(5,2) a distancia 3.
const A = { q: 2, r: 2 }
const B = { q: 3, r: 2 }

// ─── HEXGRID ──────────────────────────────────────────────────────────────────

describe('hexGrid básico', () => {
  it('distancia y vecinos', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0)
    expect(getNeighbors({ q: 2, r: 2 })).toHaveLength(6)
    getNeighbors({ q: 2, r: 3 }).forEach(n => expect(hexDistance({ q: 2, r: 3 }, n)).toBe(1))
  })
})

describe('Línea de visión', () => {
  it('despejada en terreno llano', () => {
    expect(checkLineOfSight({ q: 1, r: 2 }, { q: 5, r: 2 }, makeBoard()).clear).toBe(true)
  })
  it('bloquea el terreno más alto que atacante y objetivo', () => {
    const b = makeBoard()
    b['3,2'].elevation = 1
    expect(checkLineOfSight({ q: 1, r: 2 }, { q: 5, r: 2 }, b).clear).toBe(false)
  })
  it('bloquea un enemigo intermedio a la misma elevación', () => {
    expect(checkLineOfSight({ q: 1, r: 2 }, { q: 5, r: 2 }, makeBoard(), new Set(['3,2'])).clear).toBe(false)
  })
  it('desde arriba se dispara por encima de un enemigo más bajo', () => {
    const b = makeBoard()
    b['1,2'].elevation = 1
    expect(checkLineOfSight({ q: 1, r: 2 }, { q: 5, r: 2 }, b, new Set(['3,2'])).clear).toBe(true)
  })
  it('con distinta elevación bloquea el terreno a la altura del más alto', () => {
    const b = makeBoard()
    b['1,2'].elevation = 1
    b['3,2'].elevation = 1
    expect(checkLineOfSight({ q: 1, r: 2 }, { q: 5, r: 2 }, b).clear).toBe(false)
  })
  it('Q&A 3: entre dos hexes el atacante elige en cada punto por separado', () => {
    // (1,1)→(1,5) pasa justo entre (1,2)/(2,2) y entre (1,4)/(2,4)
    const b = makeBoard()
    b['1,2'].elevation = 1
    b['2,4'].elevation = 1
    expect(checkLineOfSight({ q: 1, r: 1 }, { q: 1, r: 5 }, b).clear).toBe(true)
    b['2,2'].elevation = 1   // ahora los dos candidatos del primer punto bloquean
    expect(checkLineOfSight({ q: 1, r: 1 }, { q: 1, r: 5 }, b).clear).toBe(false)
  })
  it('los aliados nunca bloquean (no están en la lista de enemigos)', () => {
    const ally = makeUnit('ally', 'player1', { q: 3, r: 2 })
    const g = makeGame([makeUnit('a', 'player1', { q: 1, r: 2 }), ally, makeUnit('e', 'player2', { q: 5, r: 2 })])
    expect(checkAttackTarget(g, 'a', 0, '5,2').ok).toBe(true)
  })
})

describe('Movimiento', () => {
  const opts = (budget: number, extra: Partial<Parameters<typeof getReachableHexes>[2]> = {}) =>
    ({ budget, enemyHexes: new Set<string>(), occupiedHexes: new Set<string>(), ...extra })

  it('Advance llega a 3 hexes en llano y no a 4', () => {
    const r = getReachableHexes({ q: 1, r: 2 }, makeBoard(), opts(3))
    expect(r.has('4,2')).toBe(true)
    expect(r.has('5,2')).toBe(false)
  })
  it('subir cuesta +1 por nivel (suelo → altura 2 cuesta 3)', () => {
    const b = makeBoard()
    b['2,2'].elevation = 2
    expect(getReachableHexes({ q: 1, r: 2 }, b, opts(2)).has('2,2')).toBe(false)
    expect(getReachableHexes({ q: 1, r: 2 }, b, opts(3)).get('2,2')).toBe(3)
  })
  it('bajar no cuesta', () => {
    const b = makeBoard()
    b['1,2'].elevation = 2
    expect(getReachableHexes({ q: 1, r: 2 }, b, opts(1)).get('2,2')).toBe(1)
  })
  it('no se atraviesa a un enemigo en el suelo', () => {
    const b = makeBoard(5, 1)
    const r = getReachableHexes({ q: 0, r: 0 }, b, opts(3, { enemyHexes: new Set(['1,0']), occupiedHexes: new Set(['1,0']) }))
    expect(r.has('2,0')).toBe(false)
  })
  it('saltando desde terreno elevado se pasa por encima de un enemigo más bajo', () => {
    const b = makeBoard(5, 1)
    b['0,0'].elevation = 1
    b['2,0'].elevation = 1
    const r = getReachableHexes({ q: 0, r: 0 }, b, opts(2, { enemyHexes: new Set(['1,0']), occupiedHexes: new Set(['1,0']) }))
    expect(r.get('2,0')).toBe(2)
  })
  it('Impassable: no se entra sin Hover; con Hover se cruza pero no se termina', () => {
    const b = makeBoard(4, 1)
    b['1,0'].terrain = 'impassable'
    expect(getReachableHexes({ q: 0, r: 0 }, b, opts(3)).has('2,0')).toBe(false)
    const hover = getReachableHexes({ q: 0, r: 0 }, b, opts(3, { hover: true }))
    expect(hover.has('2,0')).toBe(true)
    expect(hover.has('1,0')).toBe(false)
  })
  it('empezar en agua resta 1 al movimiento; Hover lo ignora', () => {
    const b = makeBoard()
    b['1,2'].terrain = 'water'
    const g = makeGame([makeUnit('a', 'player1', { q: 1, r: 2 })], b)
    expect(reachableFor(g, 'a', { kind: 'advance' }).has('4,2')).toBe(false)
    expect(reachableFor(g, 'a', { kind: 'advance' }).has('3,2')).toBe(true)
    g.units.a.traits = ['Hover']
    expect(reachableFor(g, 'a', { kind: 'advance' }).has('4,2')).toBe(true)
  })
  it('Engaged: −1 al movimiento', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', B)])
    expect(isEngaged(g, 'a')).toBe(true)
    const r = reachableFor(g, 'a', { kind: 'advance' })
    expect([...r.values()].every(c => c <= 2)).toBe(true)
  })
  it('una unidad a distinta elevación no causa Engagement', () => {
    const b = makeBoard()
    b['3,2'].elevation = 1
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', B)], b)
    expect(isEngaged(g, 'a')).toBe(false)
  })
})

// ─── TIMELINE ─────────────────────────────────────────────────────────────────

describe('Timeline', () => {
  it('20 slots, apila debajo, activa el round más bajo', () => {
    let tl = createEmptyTimeline()
    expect(tl.slots).toHaveLength(20)
    tl = placeInitialToken(tl, { unitId: 'x', playerId: 'player1' }, 3)
    tl = placeInitialToken(tl, { unitId: 'y', playerId: 'player2' }, 3)
    expect(tl.slots[2].tokens.map(t => t.unitId)).toEqual(['x', 'y'])
    tl = placeInitialToken(tl, { unitId: 'z', playerId: 'player2' }, 2)
    expect(getNextActivation(tl)?.unitId).toBe('z')
  })
  it('round 9 + 3 TL → round 12 (Fase 2); más allá de 20 sale del Timeline', () => {
    let tl = placeInitialToken(createEmptyTimeline(), { unitId: 'x', playerId: 'player1' }, 9)
    tl = advanceToken(tl, 'x', 3)
    expect(getUnitRound(tl, 'x')).toBe(12)
    tl = advanceToken(tl, 'x', 9)
    expect(getUnitRound(tl, 'x')).toBeNull()
  })
  it('empate: activa primero quien NO actuó el último', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'x', playerId: 'player1' }, 3)
    tl = placeInitialToken(tl, { unitId: 'y', playerId: 'player2' }, 3)
    expect(reorderSlotForTie(tl, 3, 'player1').slots[2].tokens[0].playerId).toBe('player2')
  })
})

// ─── ACCIONES ─────────────────────────────────────────────────────────────────

describe('Activación', () => {
  it('solo un Advance por activación', () => {
    const g = makeGame([makeUnit('a', 'player1', { q: 1, r: 2 })])
    const r1 = applyAdvance(g, 'a', { q: 2, r: 2 }, 'player1')
    expect(r1.success).toBe(true)
    expect(applyAdvance(r1.newState!, 'a', { q: 3, r: 2 }, 'player1').success).toBe(false)
  })
  it('Slow: el Advance no mueve y se retira el estado', () => {
    const g = makeGame([makeUnit('a', 'player1', A, { statusEffects: [{ type: 'slow' }] })])
    const r = applyAdvance(g, 'a', { q: 4, r: 2 }, 'player1')
    expect(r.success).toBe(true)
    expect(r.newState!.units.a.position).toEqual(A)
    expect(r.newState!.units.a.statusEffects).toHaveLength(0)
  })
  it('acción primaria obligatoria y sin coste extra de TL al terminar', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 6, r: 6 }, { startingTl: 5 })])
    expect(applyEndActivation(g, 'a', 'player1').success).toBe(false)
    const en = applyAction(g, { type: 'ENERGIZE', unitId: 'a' }, 'player1')
    expect(getUnitRound(en.newState!.timeline, 'a')).toBe(3)
    const end = applyEndActivation(en.newState!, 'a', 'player1')
    expect(end.success).toBe(true)
    expect(getUnitRound(end.newState!.timeline, 'a')).toBe(3)
  })
  it('no se puede hacer una segunda acción primaria', () => {
    const g = makeGame([makeUnit('a', 'player1', A)])
    const en = applyAction(g, { type: 'ENERGIZE', unitId: 'a' }, 'player1')
    expect(applyDash(en.newState!, 'a', { q: 4, r: 2 }, 'player1').success).toBe(false)
  })
  it('las habilidades Command no gastan la acción primaria y se usan una vez', () => {
    const full: Ability = { name: 'Full Power', type: 'CMD', description: '', energyCost: 1, abilityData: { type: 'buff_activation', strength: 3 } }
    const g = makeGame([makeUnit('a', 'player1', A, { abilities: [full], energy: 2 })])
    const r = applyUseAbility(g, 'a', 0, 'player1')
    expect(r.success).toBe(true)
    expect(r.newState!.hasUsedPrimaryAction).toBe(false)
    expect(r.newState!.activation!.strengthBonus).toBe(3)
    expect(r.newState!.units.a.energy).toBe(1)
    expect(applyUseAbility(r.newState!, 'a', 0, 'player1').success).toBe(false)
  })
  it('no se puede actuar mientras hay una respuesta pendiente', () => {
    const g = makeGame([makeUnit('a', 'player1', A)])
    g.pendingResponse = { trigger: 'after_combat_damage', forPlayerId: 'player2' }
    expect(applyAction(g, { type: 'ENERGIZE', unitId: 'a' }, 'player1').success).toBe(false)
  })
})

describe('Ataque', () => {
  it('tira strength + Strength Upgrades (antes se perdían los dados extra)', () => {
    const g = makeGame([
      makeUnit('a', 'player1', A, { upgrades: [{ type: 'attack', value: 1 }] }),
      makeUnit('e', 'player2', { q: 5, r: 2 }),
    ])
    const r = applyAttack(g, 'a', 0, 'e', 'player1', dice(5, 5, 5, 5))
    expect(r.newState!.lastAttack!.rolls).toHaveLength(4)
    expect(r.newState!.units.e.currentHp).toBe(6)
  })
  it('paga el TL del arma', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })])
    const r = applyAttack(g, 'a', 0, 'e', 'player1', dice())
    expect(getUnitRound(r.newState!.timeline, 'a')).toBe(4)
  })
  it('Accuracy: objetivo más alto −1 (un 4 falla, un 5 impacta); el 1 siempre falla', () => {
    const b = makeBoard()
    b['5,2'].elevation = 1
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })], b)
    const r = applyAttack(g, 'a', 0, 'e', 'player1', dice(4, 5, 1))
    expect(r.newState!.lastAttack!.targets[0].hits).toBe(1)
  })
  it('agua: −1 si el objetivo está en el agua', () => {
    const b = makeBoard()
    b['5,2'].terrain = 'water'
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })], b)
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(4, 4, 4)).newState!.lastAttack!.targets[0].hits).toBe(0)
  })
  it('un 9 es crítico y siempre impacta aunque la Accuracy sea muy baja', () => {
    const b = makeBoard()
    b['5,2'].terrain = 'minovsky'
    b['5,2'].elevation = 1
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })], b)
    // Accuracy −3 (más alto −1, Minovsky −2): un 6 se queda en 3 y falla
    const t = applyAttack(g, 'a', 0, 'e', 'player1', dice(9, 6, 6)).newState!.lastAttack!.targets[0]
    expect(t.hits).toBe(1)
    expect(t.crits).toBe(1)
  })
  it('Zero System: 7 y 8 cuentan como crítico', () => {
    const zero: Ability = { name: 'Zero System', type: 'ONG', description: '', abilityData: { type: 'extended_crit_threshold', threshold: 7 } }
    const g = makeGame([makeUnit('a', 'player1', A, { abilities: [zero] }), makeUnit('e', 'player2', { q: 5, r: 2 })])
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(7, 2, 2)).newState!.lastAttack!.targets[0].crits).toBe(1)
  })
  it('crítico "Roll 2 additional dice"', () => {
    const w = weapon({ critData: { trigger: 'after_attack_roll', type: 'extra_dice', amount: 2 } })
    const g = makeGame([makeUnit('a', 'player1', A, { weapons: [w] }), makeUnit('e', 'player2', { q: 5, r: 2 })])
    const r = applyAttack(g, 'a', 0, 'e', 'player1', dice(9, 1, 1, 5, 5))
    expect(r.newState!.lastAttack!.rolls).toHaveLength(5)
    expect(r.newState!.lastAttack!.targets[0].hits).toBe(3)
  })
  it('Shields: evitan daño, se ponen boca abajo y se reactivan en la siguiente activación', () => {
    const g = makeGame([
      makeUnit('a', 'player1', A),
      makeUnit('e', 'player2', { q: 5, r: 2 }, { upgrades: [{ type: 'shield', value: 1, active: true }] }),
    ])
    const r = applyAttack(g, 'a', 0, 'e', 'player1', dice(5, 5, 5))
    expect(r.newState!.units.e.currentHp).toBe(8)
    expect(r.newState!.units.e.upgrades[0].active).toBe(false)
    const r2 = applyAttack({ ...r.newState!, hasUsedPrimaryAction: false }, 'a', 0, 'e', 'player1', dice(5, 5, 5))
    expect(r2.newState!.units.e.currentHp).toBe(5)   // ya no hay escudo activo
    const s = structuredClone(r2.newState!)
    s.activeUnitId = 'e'; s.activePlayerId = 'player2'
    expect(beginActivation(s).units.e.upgrades[0].active).toBe(true)
  })
  it('los Shields se aplican después del daño extra por crítico', () => {
    const w = weapon({ critData: { trigger: 'after_attack_roll', type: 'bonus_damage', amount: 2 } })
    const g = makeGame([
      makeUnit('a', 'player1', A, { weapons: [w] }),
      makeUnit('e', 'player2', { q: 5, r: 2 }, { upgrades: [{ type: 'shield', value: 1, active: true }] }),
    ])
    // 1 impacto (crit) + 2 = 3, menos 1 de Shield = 2
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(9, 1, 1)).newState!.units.e.currentHp).toBe(8)
  })
  it('Fracture: +3 si recibe 3 o más de daño de combate, y se retira', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 }, { statusEffects: [{ type: 'fracture' }] })])
    const r = applyAttack(g, 'a', 0, 'e', 'player1', dice(5, 5, 5))
    expect(r.newState!.units.e.currentHp).toBe(4)
    expect(r.newState!.units.e.statusEffects).toHaveLength(0)
  })
  it('Disarm: repite los impactos y no hay efectos de crítico', () => {
    const w = weapon({ critData: { trigger: 'after_attack_roll', type: 'bonus_damage', amount: 2 } })
    const g = makeGame([
      makeUnit('a', 'player1', A, { weapons: [w], statusEffects: [{ type: 'disarm' }] }),
      makeUnit('e', 'player2', { q: 5, r: 2 }),
    ])
    // tiradas 9,5,2 → se repiten 9 y 5 → salen 9 y 2: 1 impacto, sin +2 de crit
    const r = applyAttack(g, 'a', 0, 'e', 'player1', dice(9, 5, 2, 9, 2))
    expect(r.newState!.units.e.currentHp).toBe(9)
    expect(r.newState!.units.a.statusEffects).toHaveLength(0)
  })
  it('Engaged: debe atacar a un enemigo con el que está trabado', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e1', 'player2', B), makeUnit('e2', 'player2', { q: 2, r: 5 })])
    expect(applyAttack(g, 'a', 0, 'e2', 'player1', dice()).success).toBe(false)
    expect(applyAttack(g, 'a', 0, 'e1', 'player1', dice()).success).toBe(true)
  })
  it('derrota: VP al rival, a la Reserva, +2 TL, HP al máximo, sin estados, conserva Upgrades', () => {
    const g = makeGame([
      makeUnit('a', 'player1', A),
      makeUnit('e', 'player2', { q: 5, r: 2 }, { currentHp: 2, startingTl: 4, statusEffects: [{ type: 'slow' }], upgrades: [{ type: 'attack', value: 1 }] }),
    ])
    const s = applyAttack(g, 'a', 0, 'e', 'player1', dice(5, 5, 5)).newState!
    expect(s.players.player1.vp).toBe(5)
    expect(s.units.e.position).toBeNull()
    expect(s.units.e.currentHp).toBe(10)
    expect(s.units.e.statusEffects).toHaveLength(0)
    expect(s.units.e.upgrades).toHaveLength(1)
    expect(getUnitRound(s.timeline, 'e')).toBe(6)
    expect(s.board['5,2'].occupiedBy).toBeNull()
  })
  it('atacar una Garrison enemiga: 1 impacto la destruye y da 2 VP', () => {
    const b = makeBoard()
    b['5,2'].garrisonToken = { id: 'g1', owner: 'player2', hp: 1 }
    const g = makeGame([makeUnit('a', 'player1', A)], b)
    const s = applyAttackGarrison(g, 'a', 0, 'g1', 'player1', dice(5)).newState!
    expect(s.board['5,2'].garrisonToken).toBeNull()
    expect(s.players.player1.vp).toBe(2)
  })
  it('arma que también ataca a los adyacentes al objetivo: una sola tirada', () => {
    const w = weapon({ effectData: { trigger: 'always', type: 'also_target_adjacent' } })
    const g = makeGame([makeUnit('a', 'player1', A, { weapons: [w] }), makeUnit('e1', 'player2', { q: 5, r: 2 }), makeUnit('e2', 'player2', { q: 6, r: 2 })])
    const s = applyAttack(g, 'a', 0, 'e1', 'player1', dice(5, 5, 5)).newState!
    expect(s.lastAttack!.rolls).toHaveLength(3)
    expect(s.units.e1.currentHp).toBe(7)
    expect(s.units.e2.currentHp).toBe(7)
  })
})

describe('Push / Pull a elegir (Q&A 7)', () => {
  const PICK = { choosePushes: true }
  const pushWeapon = weapon({ range: 1, effectData: { trigger: 'before_attack_roll', type: 'push', amount: 2 } })
  const game = () => makeGame([makeUnit('a', 'player1', A, { weapons: [pushWeapon] }), makeUnit('e', 'player2', B)])
  const attack = { type: 'ATTACK' as const, unitId: 'a', weaponIndex: 0, targetId: 'e' }

  it('el ataque se pausa y quien empuja elige cada hex', () => {
    const r1 = processAction(game(), attack, 'player1', dice(), PICK)
    const pf = r1.state!.pendingForcedMove!
    expect(pf.forPlayerId).toBe('player1')
    expect(pf.request).toMatchObject({ unitId: 'e', mode: 'push', step: 1, total: 2 })
    expect(r1.state!.units.e.position).toEqual(B)
    pf.request.options.forEach(o => expect(hexDistance(o, A)).toBe(2))

    const to = pf.request.options[pf.request.options.length - 1]
    const r2 = processAction(r1.state!, { type: 'CHOOSE_FORCED_MOVE', to }, 'player1', dice(), PICK)
    expect(r2.state!.pendingForcedMove!.request.step).toBe(2)

    // Mover menos: parar tras el primer hex
    const r3 = processAction(r2.state!, { type: 'CHOOSE_FORCED_MOVE', to: null }, 'player1', dice(), PICK)
    expect(r3.state!.pendingForcedMove).toBeNull()
    expect(r3.state!.units.e.position).toEqual(to)
    expect(r3.state!.hasUsedPrimaryAction).toBe(true)
  })

  it('se puede no mover nada (0 hexes)', () => {
    const r1 = processAction(game(), attack, 'player1', dice(), PICK)
    const r2 = processAction(r1.state!, { type: 'CHOOSE_FORCED_MOVE', to: null }, 'player1', dice(), PICK)
    expect(r2.state!.units.e.position).toEqual(B)
    expect(r2.state!.pendingForcedMove).toBeNull()
  })

  it('reutiliza los dados ya tirados al volver a resolver el ataque', () => {
    // El crítico (9) empuja tras la tirada; si se volviera a tirar saldría 1 y no habría crítico
    const w = weapon({ range: 1, critData: { trigger: 'after_attack_roll', type: 'push', amount: 1 } })
    const g = makeGame([makeUnit('a', 'player1', A, { weapons: [w] }), makeUnit('e', 'player2', B)])
    const r1 = processAction(g, attack, 'player1', dice(9, 1, 1), PICK)
    const pf = r1.state!.pendingForcedMove!
    expect(pf).toBeTruthy()
    const r2 = processAction(r1.state!, { type: 'CHOOSE_FORCED_MOVE', to: pf.request.options[0] }, 'player1', dice(), PICK)
    expect(r2.state!.pendingForcedMove).toBeNull()
    expect(r2.state!.units.e.position).toEqual(pf.request.options[0])
    expect(r2.state!.lastAttack!.targets[0].crits).toBe(1)
    expect(r2.state!.units.e.currentHp).toBe(9)
  })

  it('rechaza hexes no válidos, al rival y otras acciones mientras se elige', () => {
    const s = processAction(game(), attack, 'player1', dice(), PICK).state!
    expect(processAction(s, { type: 'CHOOSE_FORCED_MOVE', to: A }, 'player1', dice(), PICK).success).toBe(false)
    expect(processAction(s, { type: 'CHOOSE_FORCED_MOVE', to: null }, 'player2', dice(), PICK).success).toBe(false)
    expect(processAction(s, { type: 'ENERGIZE', unitId: 'a' }, 'player1', dice(), PICK).success).toBe(false)
    expect(processAction(game(), { type: 'CHOOSE_FORCED_MOVE', to: null }, 'player1', dice(), PICK).success).toBe(false)
  })

  it('sin hexes libres no pregunta: hay colisión', () => {
    const b = makeBoard(5, 1)
    b['2,0'].elevation = 1
    const g = makeGame([makeUnit('a', 'player1', { q: 0, r: 0 }, { weapons: [pushWeapon] }), makeUnit('e', 'player2', { q: 1, r: 0 })], b)
    const r = processAction(g, attack, 'player1', dice(), PICK)
    expect(r.state!.pendingForcedMove ?? null).toBeNull()
    expect(r.state!.units.e.currentHp).toBe(8)
  })
})

describe('Push / Pull', () => {
  it('Push aleja al objetivo', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', B)])
    const s = structuredClone(g)
    forceMove(s, '2,2', 'e', 2, 'push', 'player1')
    expect(hexDistance(s.units.e.position!, A)).toBe(3)
  })
  it('chocar con terreno más alto hace 2 de daño y detiene el Push', () => {
    const b = makeBoard(5, 1)
    b['2,0'].elevation = 1
    const g = makeGame([makeUnit('a', 'player1', { q: 0, r: 0 }), makeUnit('e', 'player2', { q: 1, r: 0 })], b)
    const s = structuredClone(g)
    forceMove(s, '0,0', 'e', 2, 'push', 'player1')
    expect(s.units.e.position).toEqual({ q: 1, r: 0 })
    expect(s.units.e.currentHp).toBe(8)
  })
})

// ─── OBJETIVOS Y VICTORIA ─────────────────────────────────────────────────────

describe('Objetivos', () => {
  function withObjective() {
    const b = makeBoard()
    b['3,3'].objectiveToken = { id: 'o1', vpValue: 5, controlledBy: null }
    return b
  }
  it('al terminar la activación junto a un Objetivo neutral con mayoría, se captura', () => {
    const g = makeGame([makeUnit('a', 'player1', { q: 3, r: 2 })], withObjective())
    const s = structuredClone(g)
    contestObjectives(s, 'a')
    expect(s.board['3,3'].objectiveToken!.controlledBy).toBe('player1')
  })
  it('sin mayoría no hay cambio; contra un Objetivo del rival lo neutraliza', () => {
    const b = withObjective()
    b['3,3'].objectiveToken!.controlledBy = 'player2'
    const tie = makeGame([makeUnit('a', 'player1', { q: 3, r: 2 }), makeUnit('e', 'player2', { q: 4, r: 3 })], structuredClone(b))
    const s1 = structuredClone(tie)
    contestObjectives(s1, 'a')
    expect(s1.board['3,3'].objectiveToken!.controlledBy).toBe('player2')
    const win = makeGame([makeUnit('a', 'player1', { q: 3, r: 2 })], b)
    const s2 = structuredClone(win)
    contestObjectives(s2, 'a')
    expect(s2.board['3,3'].objectiveToken!.controlledBy).toBeNull()
  })
  it('el control se mantiene aunque la unidad se vaya, y puntúa al final de la fase', () => {
    const b = withObjective()
    b['3,3'].objectiveToken!.controlledBy = 'player1'
    const s = structuredClone(makeGame([makeUnit('a', 'player1', { q: 7, r: 7 })], b))
    scoreObjectives(s)
    expect(s.players.player1.vp).toBe(5)
  })
  it('empate a VP: gana el último jugador que actuó', () => {
    const s = makeGame([makeUnit('a', 'player1', A)])
    s.lastActivePlayer = 'player2'
    expect(decideWinner(s).winner).toBe('player2')
  })
})

// ─── MOTOR: CICLO DE ACTIVACIONES ─────────────────────────────────────────────

describe('Motor', () => {
  it('despliega desde la Reserva en la Base y no deja terminar sobre ella', () => {
    const g = makeGame([makeUnit('a', 'player1', null), makeUnit('e', 'player2', null, { startingTl: 5 })])
    g.phase = 'setup'
    const s = startGame(structuredClone(g))
    expect(s.units.a.position).toEqual({ q: 0, r: 7 })
    const en = processAction(s, { type: 'ENERGIZE', unitId: 'a' }, 'player1')
    const end = processAction(en.state!, { type: 'END_ACTIVATION', unitId: 'a' }, 'player1')
    expect(end.success).toBe(false)
  })
  it('si la unidad activa es derrotada, su activación termina', () => {
    const exertion: Ability = { name: 'Exertion', type: 'CMD', description: '', abilityData: { type: 'self_damage_move', amount: 3, range: 2 } }
    const g = makeGame([makeUnit('a', 'player1', A, { currentHp: 3, abilities: [exertion] }), makeUnit('e', 'player2', { q: 6, r: 6 }, { startingTl: 2 })])
    const r = processAction(g, { type: 'USE_ABILITY', unitId: 'a', abilityIndex: 0, targetHex: { q: 4, r: 2 } }, 'player1')
    expect(r.success).toBe(true)
    expect(r.state!.units.a.position).toBeNull()
    expect(r.state!.activeUnitId).toBe('e')
    expect(r.state!.players.player2.vp).toBe(5)
  })
  it('al pasar del round 10 empieza la Fase 2 y se roban 3 cartas', () => {
    const card = (id: string) => ({ id, name: id, type: 'command' as const, faction: '', effect: '' })
    const g = makeGame([makeUnit('a', 'player1', A, { startingTl: 9 }), makeUnit('e', 'player2', { q: 6, r: 6 }, { startingTl: 12 })])
    g.players.player1.tactics.deck = [card('c1'), card('c2'), card('c3'), card('c4')]
    const en = processAction(g, { type: 'ENERGIZE', unitId: 'a' }, 'player1')
    const end = processAction(en.state!, { type: 'END_ACTIVATION', unitId: 'a' }, 'player1')
    expect(end.phaseChanged).toBe(true)
    expect(end.state!.phase).toBe('phase2')
    expect(end.state!.players.player1.tactics.hand).toHaveLength(3)
  })
  it('la partida termina cuando no quedan fichas en el Timeline', () => {
    const g = makeGame([makeUnit('a', 'player1', A, { startingTl: 19 })])
    g.phase = 'phase2'
    const en = processAction(g, { type: 'ENERGIZE', unitId: 'a' }, 'player1')
    const end = processAction(en.state!, { type: 'END_ACTIVATION', unitId: 'a' }, 'player1')
    expect(end.gameOver).toBe(true)
    expect(end.state!.winner).not.toBeNull()
  })
  it('rechaza acciones fuera de turno', () => {
    const g = makeGame([makeUnit('a', 'player1', A)])
    expect(processAction(g, { type: 'ENERGIZE', unitId: 'a' }, 'player2').success).toBe(false)
  })
})

// ─── CATÁLOGO, ESCUADRA Y MAZO ────────────────────────────────────────────────

describe('Construcción de escuadra y mazo', () => {
  const units = loadUnitCatalog()
  const tactics = loadTacticsCatalog()

  it('el catálogo incluye las 15 unidades oficiales', () => {
    const official = units.filter(u => !u.cardId.startsWith('DM01'))
    expect(official).toHaveLength(15)
    expect(units.find(u => u.cardId === 'ST01-U01')).toMatchObject({ hp: 15, vp: 8, tl: 2, signature: 'Legendary Hero' })
  })
  it('escuadra de 3 sin repetir salvo Mass Produced', () => {
    expect(validateSquad(['ST01-U01', 'ST01-U02', 'ST01-U04'], units)).toBeNull()
    expect(validateSquad(['ST01-U01', 'ST01-U01', 'ST01-U04'], units)).not.toBeNull()
    expect(validateSquad(['EX01-U02', 'EX01-U02', 'ST01-U04'], units)).toBeNull()   // Torohachi es Mass Produced
    expect(validateSquad(['ST01-U01', 'ST01-U02'], units)).not.toBeNull()
  })
  it('mazo: cartas con rasgo solo si la escuadra lo tiene', () => {
    const squad = ['ST01-U01', 'PA01-U02', 'PA01-U03']   // todo Earth Federation
    const fed = tactics.filter(c => c.faction === 'Earth Federation').map(c => c.id)
    const zeon = tactics.filter(c => c.faction === 'Zeon').map(c => c.id)
    expect(requiredDeckSize(squad, units, tactics)).toBe(9)
    expect(validateDeck(fed.slice(0, 9), squad, units, tactics)).toBeNull()
    expect(validateDeck([...fed.slice(0, 8), zeon[0]], squad, units, tactics)).not.toBeNull()
    expect(validateDeck(fed.slice(0, 8), squad, units, tactics)).not.toBeNull()
  })
  it('crear partida: unidades en la Reserva y copias Mass Produced con id único', () => {
    const g = createServerGame('A', 'B', ['EX01-U02', 'EX01-U02', 'ST01-U01'], ['ST01-U04', 'ST01-U02', 'ST01-U05'], [], [], { rng: dice(3, 7) })
    expect(Object.values(g.units).every(u => u.position === null)).toBe(true)
    expect(new Set(Object.keys(g.units)).size).toBe(6)
  })
})

describe('Salas', () => {
  it('solo el mismo usuario puede reconectarse a su plaza', () => {
    const rm = new RoomManager()
    const room = rm.createRoom('s1', 'Ana', 'user-ana')
    expect(rm.reconnect(room.id, 'player1', 's2', 'user-intruso')).toBeNull()
    expect(rm.reconnect(room.id, 'player1', 's3', 'user-ana')).not.toBeNull()
  })
  it('rechaza escuadras inválidas', () => {
    const rm = new RoomManager()
    const room = rm.createRoom('s1', 'Ana', 'u1')
    rm.joinRoom(room.id, 's2', 'Bea', 'u2')
    expect('error' in rm.submitSquad('s1', ['ST01-U01'], [])).toBe(true)
  })
})

describe('Código compartido', () => {
  it('las copias del cliente están sincronizadas (node scripts/sync-shared.mjs)', async () => {
    const { execFileSync } = await import('node:child_process')
    const path = await import('node:path')
    expect(() => execFileSync('node', [path.join(__dirname, '../../../../scripts/sync-shared.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow()
  })
})

// ─── RESPONSE DURANTE EL ATAQUE Y CARTAS OFICIALES ───────────────────────────

describe('Ventanas de Response durante el ataque', () => {
  const tactics = loadTacticsCatalog()
  const card = (name: string) => structuredClone(tactics.find(c => c.name === name)!)

  function duel(p1Hand: string[], p2Hand: string[]) {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })])
    g.players.player1.tactics.hand = p1Hand.map(card)
    g.players.player2.tactics.hand = p2Hand.map(card)
    return g
  }

  it('sin cartas jugables el ataque se resuelve de golpe', () => {
    const r = applyAttack(duel([], ['Strikethrough']), 'a', 0, 'e', 'player1', dice(5, 5, 5))  // Strikethrough es del atacante
    expect(r.newState!.pendingAttack).toBeNull()
    expect(r.newState!.units.e.currentHp).toBe(7)
  })
  it('Quick Block: el defensor reduce 3 de daño tras la tirada', () => {
    const r = applyAttack(duel([], ['Quick Block']), 'a', 0, 'e', 'player1', dice(5, 5, 5))
    const s = r.newState!
    expect(s.pendingAttack?.stage).toBe('after_roll')
    expect(s.pendingResponse).toMatchObject({ forPlayerId: 'player2', trigger: 'after_attack_roll', side: 'defender' })
    const qb = s.players.player2.tactics.hand[0].id
    const done = processAction(s, { type: 'PLAY_RESPONSE', cardId: qb }, 'player2', dice())
    expect(done.state!.pendingAttack).toBeNull()
    expect(done.state!.units.e.currentHp).toBe(10)
  })
  it('Limiter Release: el atacante añade 3 dados antes de tirar; primero responde el atacante', () => {
    const s = applyAttack(duel(['Limiter Release'], ['Quick Block']), 'a', 0, 'e', 'player1', dice()).newState!
    expect(s.pendingResponse).toMatchObject({ forPlayerId: 'player1', trigger: 'before_attack_roll' })
    const lr = s.players.player1.tactics.hand[0].id
    const s2 = processAction(s, { type: 'PLAY_RESPONSE', cardId: lr }, 'player1', dice(5, 5, 5, 5, 5, 5)).state!
    expect(s2.pendingAttack!.rolls).toHaveLength(6)
    expect(s2.pendingResponse).toMatchObject({ forPlayerId: 'player2', trigger: 'after_attack_roll' })
    const s3 = processAction(s2, { type: 'PASS_RESPONSE' }, 'player2').state!
    expect(s3.units.e.currentHp).toBe(4)
    expect(s3.activation!.cardPlayed).toBe(true)   // el atacante ya gastó su carta de la activación
  })
  it('no se puede actuar mientras el ataque espera una respuesta', () => {
    const s = applyAttack(duel([], ['Quick Block']), 'a', 0, 'e', 'player1', dice(5)).newState!
    expect(processAction(s, { type: 'END_ACTIVATION', unitId: 'a' }, 'player1').success).toBe(false)
  })
  it('Newtype Destroyer impide las Response de los enemigos', () => {
    const g = duel([], ['Quick Block'])
    g.units.a.abilities = [{ name: 'Newtype Destroyer', type: 'ONG', description: '', abilityData: { type: 'block_enemy_responses' } }]
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(5)).newState!.pendingResponse).toBeNull()
  })
  it('Formative Strength exige otro aliado a 3 hexes del atacante', () => {
    const g = duel(['Formative Strength'], [])
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(5)).newState!.pendingResponse).toBeNull()
    g.units.ally = makeUnit('ally', 'player1', { q: 2, r: 3 })
    g.board['2,3'].occupiedBy = 'ally'
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(5)).newState!.pendingResponse).toMatchObject({ forPlayerId: 'player1', trigger: 'before_attack_roll' })
  })
  it('tras el daño responde primero el atacante (Sacrificial Overload) y luego el defensor (Counter Attack)', () => {
    const g = duel(['Sacrificial Overload'], ['Counter Attack'])
    g.units.a.signature = 'Wing of Destruction'
    g.units.e.weapons = [weapon({ range: 4, strength: 2, tlCost: 3 })]
    g.units.e.startingTl = 6
    g.timeline = placeInitialToken(createEmptyTimeline(), { unitId: 'a', playerId: 'player1' }, 1)
    g.timeline = placeInitialToken(g.timeline, { unitId: 'e', playerId: 'player2' }, 6)
    const s1 = applyAttack(g, 'a', 0, 'e', 'player1', dice(5, 1, 1)).newState!
    expect(s1.pendingResponse).toMatchObject({ forPlayerId: 'player1', trigger: 'after_combat_damage' })
    const so = s1.players.player1.tactics.hand[0].id
    const s2 = processAction(s1, { type: 'PLAY_RESPONSE', cardId: so }, 'player1', dice()).state!
    expect(s2.units.a.currentHp).toBe(8)          // 2 a sí mismo
    expect(s2.units.e.currentHp).toBe(7)          // 1 impacto + 2
    expect(s2.pendingResponse).toMatchObject({ forPlayerId: 'player2' })
    const ca = s2.players.player2.tactics.hand[0].id
    const s3 = processAction(s2, { type: 'PLAY_RESPONSE', cardId: ca }, 'player2', dice(5, 5)).state!
    expect(s3.units.a.currentHp).toBe(6)          // contraataque de 2 impactos
    expect(getUnitRound(s3.timeline, 'e')).toBe(8) // TL 3 − 1
    expect(s3.pendingAttack).toBeNull()
  })
  it('Q&A 43: Newtype Destroyer también bloquea las Response tras el daño', () => {
    const g = duel([], ['Counter Attack'])
    g.units.a.abilities = [{ name: 'Newtype Destroyer', type: 'ONG', description: '', abilityData: { type: 'block_enemy_responses' } }]
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(5)).newState!.pendingResponse).toBeNull()
  })
})

describe('Cartas oficiales', () => {
  const tactics = loadTacticsCatalog()
  const card = (name: string) => structuredClone(tactics.find(c => c.name === name)!)

  it('Epic Shot: carta Attack de firma con +2 Strength por aliado a 3 hexes', () => {
    const g = makeGame([
      makeUnit('a', 'player1', A, { signature: 'Legendary Hero' }),
      makeUnit('ally', 'player1', { q: 2, r: 3 }),
      makeUnit('e', 'player2', { q: 6, r: 2 }),
    ])
    g.players.player1.tactics.hand = [card('Epic Shot')]
    const id = g.players.player1.tactics.hand[0].id
    const r = processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, targetId: 'e' }, 'player1', dice())
    expect(r.success).toBe(true)
    expect(r.state!.lastAttack!.rolls).toHaveLength(9)            // 7 + 2×1 aliado
    expect(r.state!.hasUsedPrimaryAction).toBe(true)
    expect(getUnitRound(r.state!.timeline, 'a')).toBe(4)        // TL 3
    g.units.a.signature = 'Elite Mobile Suit'
    expect(processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, targetId: 'e' }, 'player1').success).toBe(false)
  })
  it('Field Engineers repara 4 y no gasta la acción primaria', () => {
    const g = makeGame([makeUnit('a', 'player1', A, { currentHp: 3 })])
    g.players.player1.tactics.hand = [card('Field Engineers')]
    const r = processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: g.players.player1.tactics.hand[0].id }, 'player1')
    expect(r.state!.units.a.currentHp).toBe(7)
    expect(r.state!.hasUsedPrimaryAction).toBe(false)
  })
  it('Full System Burn: solo Londo Bell; +3 Speed y Hover esta activación', () => {
    const g = makeGame([makeUnit('a', 'player1', { q: 0, r: 2 })])
    g.players.player1.tactics.hand = [card('Full System Burn')]
    const id = g.players.player1.tactics.hand[0].id
    expect(processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id }, 'player1').success).toBe(false)
    g.units.a.traits = ['Londo Bell']
    const s = processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id }, 'player1').state!
    expect(reachableFor(s, 'a', { kind: 'advance' }).has('6,2')).toBe(true)
  })
})

describe('Cartas Command de la lista oficial', () => {
  const tactics = loadTacticsCatalog()
  const card = (name: string) => structuredClone(tactics.find(c => c.name === name)!)
  const play = (g: GameState, extra: object = {}) =>
    processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: g.players.player1.tactics.hand[0].id, ...extra } as never, 'player1')

  it('la lista oficial tiene 45 cartas con su código', () => {
    const off = tactics.filter(c => c.source === 'oficial')
    expect(off).toHaveLength(45)
    expect(off.find(c => c.id === 'ST01-T10')?.name).toBe('Crimson Execution')
  })
  it('Crimson Execution: Dash y Heat Hawk adicionales a TL 0', () => {
    const g = makeGame([makeUnit('a', 'player1', A, { signature: 'Fast Encounter', weapons: [weapon({ name: 'Heat Hawk', range: 1 })] })])
    g.players.player1.tactics.hand = [card('Crimson Execution')]
    const s = play(g).state!
    expect(s.activation!.freeDashes).toBe(1)
    expect(s.activation!.freeAttacks).toEqual([0])
  })
  it('Breaker Sweep destruye hasta 2 Upgrades de un enemigo a 2 hexes', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 4, r: 2 }, {
      upgrades: [{ type: 'attack', value: 1 }, { type: 'movement', value: 1 }, { type: 'attack', value: 1 }] })])
    g.players.player1.tactics.hand = [card('Breaker Sweep')]
    expect(play(g, { targetId: 'e' }).state!.units.e.upgrades).toHaveLength(1)
  })
  it('Systematic Elimination exige haber derrotado 3 Garrisons', () => {
    const g = makeGame([makeUnit('a', 'player1', A)])
    g.players.player1.tactics.hand = [card('Systematic Elimination')]
    expect(play(g).success).toBe(false)
    g.players.player1.garrisonsDefeated = 3
    expect(play(g).state!.activation!.strengthBonus).toBe(4)
  })
  it('Bulwark Siege: mueve 2 y aplica Fracture a los enemigos a 2 hexes', () => {
    const g = makeGame([makeUnit('a', 'player1', { q: 1, r: 2 }, { signature: 'Battlefield Bombarder' }), makeUnit('e', 'player2', { q: 5, r: 2 })])
    g.players.player1.tactics.hand = [card('Bulwark Siege')]
    const s = play(g, { targetHex: { q: 3, r: 2 } }).state!
    expect(s.units.a.position).toEqual({ q: 3, r: 2 })
    expect(s.units.e.statusEffects).toEqual([{ type: 'fracture' }])
  })
})

describe('Q&A', () => {
  it('Q16: empujar contra el borde del tablero no hace daño', () => {
    const g = makeGame([makeUnit('a', 'player1', { q: 1, r: 0 }), makeUnit('e', 'player2', { q: 0, r: 0 })], makeBoard(3, 1))
    const s = structuredClone(g)
    forceMove(s, '1,0', 'e', 2, 'push', 'player1')
    expect(s.units.e.position).toEqual({ q: 0, r: 0 })
    expect(s.units.e.currentHp).toBe(10)
  })
})

describe('Plantillas de área y Response con Energy', () => {
  it('cono: alcanza a los enemigos dentro del ángulo, no a los de detrás', () => {
    const cone = weapon({ name: 'Twin Buster Rifle', range: 3, strength: 3, area: 'cone' })
    const g = makeGame([
      makeUnit('a', 'player1', { q: 2, r: 2 }, { weapons: [cone] }),
      makeUnit('e1', 'player2', { q: 4, r: 2 }),
      makeUnit('e2', 'player2', { q: 5, r: 2 }),
      makeUnit('e3', 'player2', { q: 0, r: 2 }, { startingTl: 5 }),   // detrás del atacante
    ])
    const s = applyAttack(g, 'a', 0, 'e1', 'player1', dice(5, 5, 5)).newState!
    expect(s.units.e1.currentHp).toBe(7)
    expect(s.units.e2.currentHp).toBe(7)
    expect(s.units.e3.currentHp).toBe(10)
  })
  it('Coordinated Payload: +2 Strength por aliado solo si paga 1 Energy', () => {
    const payload: Ability = { name: 'Coordinated Payload', type: 'RSP', description: '', energyCost: 1, abilityData: { type: 'strength_per_ally_nearby', amount: 2, range: 3 } }
    const units = () => [
      makeUnit('a', 'player1', A, { abilities: [payload] }),
      makeUnit('ally', 'player1', { q: 2, r: 3 }),
      makeUnit('e', 'player2', { q: 5, r: 2 }),
    ]
    const sin = applyAttack(makeGame(units()), 'a', 0, 'e', 'player1', dice()).newState!
    expect(sin.lastAttack!.rolls).toHaveLength(3)
    const con = makeGame(units())
    con.units.a.energy = 1
    const s = applyAttack(con, 'a', 0, 'e', 'player1', dice()).newState!
    expect(s.lastAttack!.rolls).toHaveLength(5)
    expect(s.units.a.energy).toBe(0)
  })
})

describe('Datos actualizados', () => {
  it('stats de armas de la wiki aplicadas a las unidades oficiales', () => {
    const gundam = loadUnitCatalog().find(u => u.cardId === 'ST01-U01')!
    expect(gundam.provisionalStats).toBe(false)
    expect(gundam.weapons.find(w => w.name === 'Beam Saber')).toMatchObject({ tlCost: 3, range: 1, strength: 6 })
    expect(loadUnitCatalog().find(u => u.cardId === 'ST01-U02')!.weapons[1].area).toBe('cone')
  })
  it('las cartas oficiales tienen requisitos que la escuadra puede cumplir', () => {
    const units = loadUnitCatalog()
    const sigs = new Set(units.map(u => u.signature).filter(Boolean))
    for (const c of loadTacticsCatalog()) if (c.signature) expect(sigs.has(c.signature)).toBe(true)
  })
})

// ─── REMOTE WEAPON SYSTEMS ────────────────────────────────────────────────────

describe('Remote Weapon Systems (Q&A 110)', () => {
  const tactics = loadTacticsCatalog()
  const card = (name: string) => structuredClone(tactics.find(c => c.name === name)!)
  const direct = (rws: 'bit_stave' | 'corax' | 'isvara', range: number): Ability =>
    ({ name: `${rws} Direct`, type: 'CMD', description: '', abilityData: { type: 'deploy_rws', rws, range } })

  function withRws(kind: 'bit_stave' | 'corax' | 'isvara', owner: 'player1' | 'player2', ownerUnitId: string, pos: { q: number; r: number } | null, g: GameState) {
    const id = `${ownerUnitId}_${kind}`
    g.rws[id] = { id, kind, name: kind, owner, ownerUnitId, position: pos, vp: 2 }
    return id
  }

  it('se despliega con su habilidad Direct en un hex vacío a alcance y no se puede terminar encima', () => {
    const g = makeGame([makeUnit('a', 'player1', A, { abilities: [direct('corax', 4)] })])
    const id = withRws('corax', 'player1', 'a', null, g)
    expect(processAction(g, { type: 'USE_ABILITY', unitId: 'a', abilityIndex: 0, targetHex: { q: 7, r: 2 } }, 'player1').success).toBe(false)
    const s = processAction(g, { type: 'USE_ABILITY', unitId: 'a', abilityIndex: 0, targetHex: { q: 4, r: 2 } }, 'player1').state!
    expect(s.rws[id].position).toEqual({ q: 4, r: 2 })
    expect(reachableFor(s, 'a', { kind: 'advance' }).has('4,2')).toBe(false)
    expect(reachableFor(s, 'a', { kind: 'advance' }).has('5,2')).toBe(true)   // no bloquea el paso
  })
  it('no bloquea la línea de visión ni causa Engagement', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })])
    withRws('bit_stave', 'player2', 'e', { q: 3, r: 2 }, g)
    expect(isEngaged(g, 'a')).toBe(false)
    expect(checkAttackTarget(g, 'a', 0, '5,2').ok).toBe(true)
  })
  it('se puede atacar: un impacto la destruye, da 2 VP y vuelve a la reserva', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 6, r: 6 })])
    const id = withRws('corax', 'player2', 'e', { q: 4, r: 2 }, g)
    const s = processAction(g, { type: 'ATTACK_RWS', unitId: 'a', weaponIndex: 0, rwsId: id }, 'player1', dice(5)).state!
    expect(s.rws[id].position).toBeNull()
    expect(s.players.player1.vp).toBe(2)
  })
  it('vuelve a la reserva cuando cae su unidad', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 }, { currentHp: 1 })])
    const id = withRws('corax', 'player2', 'e', { q: 6, r: 4 }, g)
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(5)).newState!.rws[id].position).toBeNull()
  })
  it('Corax: +1 Accuracy contra enemigos adyacentes a ella', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })])
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(3, 3, 3)).newState!.units.e.currentHp).toBe(10)
    withRws('corax', 'player1', 'a', { q: 6, r: 2 }, g)
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(3, 3, 3)).newState!.units.e.currentHp).toBe(7)
  })
  it('BIT Stave: los aliados adyacentes reciben −1 de daño', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })])
    withRws('bit_stave', 'player2', 'e', { q: 6, r: 2 }, g)
    expect(applyAttack(g, 'a', 0, 'e', 'player1', dice(5, 5, 5)).newState!.units.e.currentHp).toBe(8)
  })
  it('Iśvara: al desplegarse hace 1 de daño a un enemigo adyacente', () => {
    const g = makeGame([makeUnit('a', 'player1', A, { abilities: [direct('isvara', 2)] }), makeUnit('e', 'player2', { q: 4, r: 3 })])
    withRws('isvara', 'player1', 'a', null, g)
    const s = processAction(g, { type: 'USE_ABILITY', unitId: 'a', abilityIndex: 0, targetHex: { q: 4, r: 2 } }, 'player1').state!
    expect(s.units.e.currentHp).toBe(9)
  })
  it('Linked Strike: +3 Strength y +1 por cada RWS aliada adyacente al objetivo', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 })])
    withRws('corax', 'player1', 'a', { q: 6, r: 2 }, g)
    g.players.player1.tactics.hand = [card('Linked Strike')]
    const s1 = applyAttack(g, 'a', 0, 'e', 'player1', dice()).newState!
    const s2 = processAction(s1, { type: 'PLAY_RESPONSE', cardId: s1.players.player1.tactics.hand[0].id }, 'player1', dice()).state!
    expect(s2.lastAttack!.rolls).toHaveLength(7)   // 3 + 3 + 1
  })
  it('Dismantle exige que el enemigo esté junto a una RWS aliada', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 }, { upgrades: [{ type: 'attack', value: 1 }] })])
    g.players.player1.tactics.hand = [card('Dismantle')]
    const id = g.players.player1.tactics.hand[0].id
    expect(processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, targetId: 'e' }, 'player1').success).toBe(false)
    withRws('bit_stave', 'player1', 'a', { q: 6, r: 2 }, g)
    expect(processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, targetId: 'e' }, 'player1').state!.units.e.upgrades).toHaveLength(0)
  })
  it('las unidades con habilidad Direct empiezan la partida con su RWS en la reserva', () => {
    const g = createServerGame('A', 'B', ['EX02-U01', 'EX02-U02', 'EX02-U03'], ['ST01-U01', 'ST01-U02', 'ST01-U04'], [], [], { rng: dice(3, 7) })
    expect(Object.values(g.rws).map(r => r.kind).sort()).toEqual(['bit_stave', 'corax', 'isvara'])
    expect(Object.values(g.rws).every(r => r.position === null)).toBe(true)
  })
})

// ─── ELECCIONES DEL JUGADOR Y RESPONSE ESPECIALES ────────────────────────────

describe('Elecciones del jugador', () => {
  const tactics = loadTacticsCatalog()
  const card = (name: string) => structuredClone(tactics.find(c => c.name === name)!)

  it('On-Site Integration: Upgrade a elegir (sin elección se rechaza)', () => {
    const g = makeGame([makeUnit('a', 'player1', A)])
    g.players.player1.tactics.hand = [card('On-Site Integration')]
    const id = g.players.player1.tactics.hand[0].id
    expect(processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id }, 'player1').success).toBe(false)
    const s = processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, choice: 'shield' }, 'player1').state!
    expect(s.units.a.upgrades).toEqual([{ type: 'shield', value: 1, active: true }])
  })
  it('Special OPs: hasta 3 Londo Bell, cada una con una Upgrade distinta', () => {
    const lb = { traits: ['Londo Bell'] }
    const g = makeGame([makeUnit('a', 'player1', A, lb), makeUnit('b', 'player1', { q: 2, r: 4 }, lb)])
    g.players.player1.tactics.hand = [card('Special OPs')]
    const id = g.players.player1.tactics.hand[0].id
    expect(processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, choices: ['a=attack', 'b=attack'] }, 'player1').success).toBe(false)
    const s = processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, choices: ['a=attack', 'b=movement'] }, 'player1').state!
    expect(s.units.b.upgrades[0].type).toBe('movement')
  })
  it('Material Transfer reparte las Upgrades y reactiva las Shields que cambian de unidad', () => {
    const mt: Ability = { name: 'Material Transfer', type: 'CMD', description: '', abilityData: { type: 'redistribute_upgrades', range: 3 } }
    const g = makeGame([
      makeUnit('a', 'player1', A, { abilities: [mt], upgrades: [{ type: 'shield', value: 1, active: false }, { type: 'attack', value: 1 }] }),
      makeUnit('b', 'player1', { q: 2, r: 4 }),
    ])
    const s = processAction(g, { type: 'USE_ABILITY', unitId: 'a', abilityIndex: 0, targetId: 'b', choices: ['ally', 'self'] }, 'player1').state!
    expect(s.units.a.upgrades).toEqual([{ type: 'attack', value: 1 }])
    expect(s.units.b.upgrades).toEqual([{ type: 'shield', value: 1, active: true }])
  })
  it('las Response con Energy se pueden desactivar por unidad, también fuera de turno', () => {
    const payload: Ability = { name: 'Coordinated Payload', type: 'RSP', description: '', energyCost: 1, abilityData: { type: 'strength_per_ally_nearby', amount: 2, range: 3 } }
    const g = makeGame([makeUnit('a', 'player1', A, { abilities: [payload], energy: 1 }), makeUnit('ally', 'player1', { q: 2, r: 3 }), makeUnit('e', 'player2', { q: 5, r: 2 })])
    expect(processAction(g, { type: 'SET_AUTO_RESPONSES', unitId: 'e', enabled: false }, 'player2').success).toBe(true)
    const off = processAction(g, { type: 'SET_AUTO_RESPONSES', unitId: 'a', enabled: false }, 'player1').state!
    const s = applyAttack(off, 'a', 0, 'e', 'player1', dice()).newState!
    expect(s.lastAttack!.rolls).toHaveLength(3)
    expect(s.units.a.energy).toBe(1)
  })
})

describe('Challenge, Protective Shot e Iron-Blooded Tenacity', () => {
  const tactics = loadTacticsCatalog()
  const card = (name: string) => structuredClone(tactics.find(c => c.name === name)!)
  const challenge: Ability = { name: 'Challenge', type: 'RSP', description: '', abilityData: { type: 'challenge', range: 2 } }

  it('Challenge: el aliado se cambia por el defensor y recibe el ataque', () => {
    const g = makeGame([
      makeUnit('a', 'player1', A),
      makeUnit('e', 'player2', { q: 5, r: 2 }),
      makeUnit('guard', 'player2', { q: 6, r: 3 }, { abilities: [challenge] }),
    ])
    const s1 = applyAttack(g, 'a', 0, 'e', 'player1', dice()).newState!
    expect(s1.pendingResponse).toMatchObject({ forPlayerId: 'player2', trigger: 'before_attack_roll' })
    const s2 = processAction(s1, { type: 'USE_RESPONSE_ABILITY', unitId: 'guard', abilityIndex: 0 }, 'player2', dice(5, 5, 5)).state!
    expect(s2.units.guard.position).toEqual({ q: 5, r: 2 })
    expect(s2.units.guard.currentHp).toBe(7)
    expect(s2.units.e.currentHp).toBe(10)
  })
  it('Interception da Challenge a un aliado sin la habilidad', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 5, r: 2 }), makeUnit('b', 'player2', { q: 6, r: 3 })])
    g.players.player2.tactics.hand = [card('Interception')]
    const s1 = applyAttack(g, 'a', 0, 'e', 'player1', dice()).newState!
    const s2 = processAction(s1, { type: 'PLAY_RESPONSE', cardId: s1.players.player2.tactics.hand[0].id }, 'player2', dice(5, 5, 5)).state!
    expect(s2.units.b.currentHp).toBe(7)
  })
  it('Protective Shot: el Gundam dispara al enemigo que termina su movimiento a 3 hexes (TL 1)', () => {
    const g = makeGame([
      makeUnit('a', 'player1', { q: 1, r: 2 }),
      makeUnit('g', 'player2', { q: 5, r: 2 }, { signature: 'Elite Mobile Suit', startingTl: 5, weapons: [weapon({ name: 'Beam Rifle', range: 3, strength: 3 })] }),
    ])
    g.players.player2.tactics.hand = [card('Protective Shot')]
    const s1 = processAction(g, { type: 'ADVANCE', unitId: 'a', to: { q: 3, r: 2 } }, 'player1').state!
    expect(s1.pendingResponse).toMatchObject({ forPlayerId: 'player2', movedUnitId: 'a' })
    const s2 = processAction(s1, { type: 'PLAY_RESPONSE', cardId: s1.players.player2.tactics.hand[0].id }, 'player2', dice(5, 5, 5)).state!
    expect(s2.units.a.currentHp).toBe(7)
    expect(getUnitRound(s2.timeline, 'g')).toBe(6)
  })
  it('Iron-Blooded Tenacity deja al Barbatos a 1 HP en vez de caer', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('b', 'player2', { q: 5, r: 2 }, { signature: 'Final Stand', currentHp: 2 })])
    g.players.player2.tactics.hand = [card('Iron-Blooded Tenacity')]
    const s = applyAttack(g, 'a', 0, 'b', 'player1', dice(5, 5, 5)).newState!
    expect(s.units.b.currentHp).toBe(1)
    expect(s.units.b.position).not.toBeNull()
    expect(s.players.player1.vp).toBe(0)
  })
  it('Iron-Blooded Tenacity: después mueve 2 y ataca con Rex Claws a Timeline 0', () => {
    const rex = weapon({ name: 'Rex Claws', range: 1, strength: 3, tlCost: 2 })
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('b', 'player2', { q: 5, r: 2 }, { signature: 'Final Stand', currentHp: 2, weapons: [rex] })])
    g.players.player2.tactics.hand = [card('Iron-Blooded Tenacity')]
    const s = processAction(g, { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'b' }, 'player1', dice(5, 5, 5)).state!
    expect(s.pendingFollowUp).toMatchObject({ unitId: 'b', playerId: 'player2', move: 2, weaponName: 'Rex Claws' })
    // Hasta que se resuelva, nadie más actúa
    expect(processAction(s, { type: 'END_ACTIVATION', unitId: 'a' }, 'player1').success).toBe(false)
    // Solo el dueño del Barbatos elige
    expect(processAction(s, { type: 'FOLLOW_UP', to: null, targetId: null }, 'player1').success).toBe(false)
    // Se acerca a 'a' (adyacente a (2,2)) y le ataca
    const tl = getUnitRound(s.timeline, 'b')
    const r = processAction(s, { type: 'FOLLOW_UP', to: { q: 3, r: 2 }, targetId: 'a' }, 'player2', dice(5, 5, 5))
    expect(r.success).toBe(true)
    const s2 = r.state!
    expect(s2.pendingFollowUp ?? null).toBeNull()
    expect(s2.units.b.position).toEqual({ q: 3, r: 2 })
    expect(s2.lastAttack?.attackerId).toBe('b')
    expect(s2.units.a.currentHp).toBe(7)
    expect(getUnitRound(s2.timeline, 'b')).toBe(tl)   // Timeline 0
  })
  it('Iron-Blooded Tenacity: no puede moverse más de 2', () => {
    const rex = weapon({ name: 'Rex Claws', range: 1 })
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('b', 'player2', { q: 6, r: 2 }, { signature: 'Final Stand', currentHp: 2, weapons: [rex] })])
    g.players.player2.tactics.hand = [card('Iron-Blooded Tenacity')]
    g.units.a.weapons = [weapon({ range: 5 })]
    const s = processAction(g, { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'b' }, 'player1', dice(5, 5, 5)).state!
    expect(processAction(s, { type: 'FOLLOW_UP', to: { q: 3, r: 2 }, targetId: null }, 'player2').success).toBe(false)
    expect(processAction(s, { type: 'FOLLOW_UP', to: null, targetId: null }, 'player2').success).toBe(true)
  })
  it('Bit Assault recoloca todas las RWS y cada una hace 1 de daño a un enemigo adyacente', () => {
    const g = makeGame([makeUnit('a', 'player1', A, { signature: 'Protective Heroine' }), makeUnit('e', 'player2', { q: 5, r: 5 })])
    g.rws.r1 = { id: 'r1', kind: 'bit_stave', name: 'BIT', owner: 'player1', ownerUnitId: 'a', position: { q: 0, r: 0 }, vp: 2 }
    g.players.player1.tactics.hand = [card('Bit Assault')]
    const id = g.players.player1.tactics.hand[0].id
    const s = processAction(g, { type: 'PLAY_CARD', unitId: 'a', cardId: id, choices: ['r1=6,5'] }, 'player1').state!
    expect(s.rws.r1.position).toEqual({ q: 6, r: 5 })
    expect(s.units.e.currentHp).toBe(9)
  })
})

describe('Mapas y tamaño de escuadra', () => {
  it('los ids de mapa no admiten rutas', async () => {
    const { mapExists, listMaps } = await import('../maps')
    expect(mapExists('DemoMap')).toBe(true)
    expect(mapExists('../units/unit_library')).toBe(false)
    expect(listMaps().map(m => m.id)).toEqual(['DemoMap'])
  })
  it('Sleeping Leviathan: Objetivos 1 y 2 de 5 VP y 3 y 4 de 8 VP, 7 Garrisons por bando', () => {
    const g = createServerGame('A', 'B', ['ST01-U01', 'ST01-U02', 'ST01-U03'], ['ST01-U04', 'ST01-U05', 'ST01-U06'], [], [], { mapId: 'DemoMap' })
    const objectives = Object.values(g.board).filter(h => h.objectiveToken).map(h => h.objectiveToken!.vpValue).sort()
    expect(objectives).toEqual([5, 5, 8, 8])
    const garrisons = Object.values(g.board).filter(h => h.garrisonToken).map(h => h.garrisonToken!.owner)
    expect(garrisons.filter(o => o === 'player1')).toHaveLength(7)
    expect(garrisons.filter(o => o === 'player2')).toHaveLength(7)
  })
  it('una sala de 5 exige escuadras de 5 y usa su mapa', () => {
    const rm = new RoomManager()
    const room = rm.createRoom('s1', 'Ana', 'u1', { mapId: 'DemoMap', squadSize: 5 })
    expect(room.mapId).toBe('DemoMap')
    expect(room.squadSize).toBe(5)
    rm.joinRoom(room.id, 's2', 'Bea', 'u2')
    const three = ['ST01-U01', 'ST01-U02', 'ST01-U03']
    expect('error' in rm.submitSquad('s1', three, [])).toBe(true)
    expect(rm.createRoom('s3', 'X', 'u3', { mapId: '../../etc' }).mapId).toBe('DemoMap')
  })

  it('las partidas públicas usan un mapa al azar entre los oficiales', () => {
    const ids = new Set(listMaps().map(m => m.id))
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) seen.add(randomMapId())
    seen.forEach(id => expect(ids.has(id)).toBe(true))
    if (ids.size > 1) expect(randomMapId(() => 0)).not.toBe(randomMapId(() => 0.99))   // con un solo mapa siempre sale ese
    const rm = new RoomManager()
    rm.joinQueue('a', 'A', 'ua')
    const r = rm.joinQueue('b', 'B', 'ub') as { room?: { mapId: string } }
    expect(ids.has(r.room!.mapId)).toBe(true)
  })
})

// ─── DATOS OFICIALES ──────────────────────────────────────────────────────────
// Fija los valores leídos de las cartas impresas (fixtures/official_unit_cards.json)
// para que ningún cambio de datos los altere sin querer.
describe('Datos de unidades contra las cartas oficiales', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const official: Record<string, { hp: number; vp: number; tl: number; weapons: [string, number, number | 'SP', number][]; abilities: [string, string, number][] }> = require('./fixtures/official_unit_cards.json')
  const lib = loadUnitCatalog()
  for (const [id, card] of Object.entries(official)) {
    if (id.startsWith('_')) continue
    it(`${id} coincide con su carta`, () => {
      const u = lib.find(c => c.cardId === id)!
      expect({ hp: u.hp, vp: u.vp, tl: u.tl }).toEqual({ hp: card.hp, vp: card.vp, tl: card.tl })
      expect(u.weapons.map(w => [w.name, w.tlCost, w.area ? 'SP' : w.range, w.strength])).toEqual(card.weapons)
      expect(u.abilities.map(a => [a.name, a.type, a.energyCost ?? 0])).toEqual(card.abilities)
    })
  }
})

describe('Rendición', () => {
  it('cualquiera de los dos puede rendirse, también fuera de su turno', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 6, r: 6 })])
    const r = processAction(g, { type: 'SURRENDER' }, 'player2')
    expect(r.success).toBe(true)
    expect(r.gameOver).toBe(true)
    expect(r.state!.phase).toBe('finished')
    expect(r.state!.winner).toBe('player1')
    expect(r.state!.winReason).toContain('se rinde')
  })
  it('no se puede rendir en una partida terminada', () => {
    const g = makeGame([makeUnit('a', 'player1', A)])
    const done = processAction(g, { type: 'SURRENDER' }, 'player1').state!
    expect(processAction(done, { type: 'SURRENDER' }, 'player2').success).toBe(false)
  })
})

describe('Abandono', () => {
  const units = loadUnitCatalog(), tactics = loadTacticsCatalog()
  const squad = ['ST01-U01', 'ST01-U02', 'ST01-U03']
  const deck = (sq: string[]) => eligibleCards(sq, units, tactics).slice(0, requiredDeckSize(sq, units, tactics)).map(c => c.id)
  const fakeIo = () => {
    const sent: { ev: string; data: { winner?: string; reason?: string } }[] = []
    const io = { to: () => ({ emit: (ev: string, data: { winner?: string; reason?: string }) => sent.push({ ev, data }) }) }
    return { io: io as unknown as import('socket.io').Server, sent }
  }

  it('si un jugador no vuelve a tiempo en mitad de la partida, gana el otro', async () => {
    const rm = new RoomManager(20)
    const room = rm.createBotRoom('h', 'Humano', 'u1')
    expect('error' in rm.submitSquad('h', squad, deck(squad))).toBe(false)
    rm.confirmSetup('h')
    expect(room.status).toBe('playing')
    const { io, sent } = fakeIo()
    rm.handleDisconnect('h', io)
    await new Promise(r => setTimeout(r, 60))
    const over = sent.find(e => e.ev === 'GAME_OVER')
    expect(over?.data.winner).toBe('player2')
    expect(over?.data.reason).toContain('abandona')
  })

  it('si vuelve antes de tiempo, la partida sigue', async () => {
    const rm = new RoomManager(40)
    const room = rm.createBotRoom('h', 'Humano', 'u1')
    rm.submitSquad('h', squad, deck(squad))
    rm.confirmSetup('h')
    const { io, sent } = fakeIo()
    rm.handleDisconnect('h', io)
    expect(rm.reconnect(room.id, 'player1', 'h2', 'u1')).not.toBeNull()
    await new Promise(r => setTimeout(r, 80))
    expect(sent.find(e => e.ev === 'GAME_OVER')).toBeUndefined()
    expect(room.gameState!.phase).not.toBe('finished')
  })
})

describe('Partidas guardadas', () => {
  const units = loadUnitCatalog(), tactics = loadTacticsCatalog()
  const squad = ['ST01-U01', 'ST01-U02', 'ST01-U03']
  const deck = eligibleCards(squad, units, tactics).slice(0, requiredDeckSize(squad, units, tactics)).map(c => c.id)
  const io = { to: () => ({ emit: () => {} }) } as unknown as import('socket.io').Server

  it('una partida en curso sobrevive a un reinicio del servidor', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-rooms-'))
    const a = new RoomManager(10_000)
    a.useStore(new FileGameStore(dir))
    const room = a.createBotRoom('h', 'Humano', 'u1')
    a.submitSquad('h', squad, deck)
    a.confirmSetup('h')
    await a.persistNow(room)

    // "Reinicio": otro RoomManager lee el mismo almacén
    const b = new RoomManager(10_000)
    b.useStore(new FileGameStore(dir))
    expect(await b.restore(io)).toBe(1)
    const back = b.reconnect(room.id, 'player1', 'h2', 'u1')
    expect(back?.gameState?.gameId).toBe(room.gameState!.gameId)
    expect(back?.status).toBe('playing')
    // Otro usuario no puede quedarse la plaza
    expect(b.reconnect(room.id, 'player1', 'x', 'intruso')).toBeNull()
  })

  it('las partidas terminadas no se recuperan y se borran del almacén', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-rooms-'))
    const store = new FileGameStore(dir)
    const a = new RoomManager(10_000)
    a.useStore(store)
    const room = a.createBotRoom('h', 'Humano', 'u1')
    a.submitSquad('h', squad, deck)
    a.confirmSetup('h')
    room.status = 'finished'
    await a.persistNow(room)
    const b = new RoomManager(10_000)
    b.useStore(store)
    expect(await b.restore(io)).toBe(0)
    expect((await store.loadAll()).length).toBe(0)
  })
})

describe('Contenido de la demo', () => {
  it('el rival automático no usa unidades ni cartas de la demo si hay oficiales suficientes', () => {
    const tactics = loadTacticsCatalog()
    for (let i = 0; i < 20; i++) {
      const squad = randomSquad(3)
      expect(squad.some(id => id.startsWith('DM01'))).toBe(false)
      const deck = randomDeck(squad)
      const demo = deck.filter(id => tactics.find(c => c.id === id)?.source === 'demo')
      const official = eligibleCards(squad, loadUnitCatalog(), tactics).filter(c => c.source !== 'demo').length
      if (official >= deck.length) expect(demo).toEqual([])
    }
  })
})

describe('Setup y Timeline hacia atrás (previstos para unidades futuras)', () => {
  it('retreatToken adelanta la ficha sin pasar de la ronda actual y la pone debajo', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'x', playerId: 'player1' }, 2)
    tl = placeInitialToken(tl, { unitId: 'y', playerId: 'player2' }, 6)
    tl = retreatToken(tl, 'y', 4, 1)
    expect(getUnitRound(tl, 'y')).toBe(2)
    expect(tl.slots.find(s => s.round === 2)!.tokens.map(t => t.unitId)).toEqual(['x', 'y'])
    expect(getUnitRound(retreatToken(tl, 'y', 5, 2), 'y')).toBe(2)   // nunca antes de la ronda actual
  })
  it('las habilidades de Setup se aplican al empezar la partida', () => {
    const setup = (abilityData: Ability['abilityData']): Ability => ({ name: 'Prueba', type: 'SETUP', description: '', abilityData })
    const g = makeGame([
      makeUnit('a', 'player1', null, { abilities: [setup({ type: 'setup_upgrade', upgradeType: 'shield', amount: 1 })] }),
      makeUnit('b', 'player2', null, { startingTl: 4, abilities: [setup({ type: 'setup_energy', amount: 2 }), setup({ type: 'setup_timeline', amount: -2 })] }),
    ])
    g.phase = 'setup'
    const s = startGame(structuredClone(g))
    expect(s.units.a.upgrades.some(u => u.type === 'shield')).toBe(true)
    expect(s.units.b.energy).toBe(2)
    expect(getUnitRound(s.timeline, 'b')).toBe(2)
  })
})

describe('Previsión de ataque', () => {
  it('usa los mismos dados, Accuracy y Shields que el ataque real', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', B, { currentHp: 2, upgrades: [{ type: 'shield', value: 1, active: true }] })])
    g.units.a.upgrades = [{ type: 'attack', value: 1 }]
    const p = previewAttack(g, 'a', g.units.a.weapons[1], hexKey(B))!
    expect(p.dice).toBe(5)                 // Saber S4 + 1 Strength Upgrade
    expect(p.accuracy).toBe(0)
    expect(p.hitChance).toBeCloseTo(0.7)   // 4..10
    expect(p.expectedHits).toBeCloseTo(3.5)
    expect(p.shields).toBe(1)
    expect(p.critChance).toBeCloseTo(1 - 0.8 ** 5)
    // Derrotarlo exige 3+ impactos (2 HP + 1 Shield)
    const binom = (n: number, k: number) => { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - i + 1) / i; return c }
    let expected = 0
    for (let k = 3; k <= 5; k++) expected += binom(5, k) * 0.7 ** k * 0.3 ** (5 - k)
    expect(p.killChance).toBeCloseTo(expected)
  })
  it('no muta el estado ni da previsión sin objetivo', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', B)])
    const before = JSON.stringify(g)
    previewAttack(g, 'a', g.units.a.weapons[0], hexKey(B))
    expect(JSON.stringify(g)).toBe(before)
    expect(previewAttack(g, 'a', g.units.a.weapons[0], '6,6')).toBeNull()
  })
})

describe('Bot con niveles', () => {
  it('normal y difícil atacan al enemigo que pueden derrotar en vez de al sano', () => {
    for (const level of ['normal', 'dificil'] as const) {
      const g = makeGame([
        makeUnit('a', 'player1', A),
        makeUnit('sano', 'player2', { q: 2, r: 4 }),
        makeUnit('debil', 'player2', { q: 5, r: 2 }, { currentHp: 1 }),
      ])
      g.units.a.weapons = [weapon({ range: 5 })]
      const act = chooseBotAction(g, 'player1', () => 0.5, level)
      expect(act).toMatchObject({ type: 'ATTACK', targetId: 'debil' })
    }
  })
  it('sin objetivos no ataca', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 7, r: 7 })])
    g.units.a.weapons = [weapon({ range: 1 })]
    expect(chooseBotAction(g, 'player1', () => 0.5, 'dificil').type).not.toBe('ATTACK')
  })
})

describe('Repeticiones', () => {
  it('el estado inicial más las acciones y sus dados reconstruyen la partida', () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', B)])
    const rec = startRecording(g)
    const r1 = recordedAction(rec, g, { type: 'ATTACK', unitId: 'a', weaponIndex: 1, targetId: 'e' }, 'player1', dice(9, 6, 4, 2), {})
    expect(r1.success).toBe(true)
    expect(rec.steps[0].rolls).toEqual([9, 6, 4, 2])
    // Una acción rechazada no se apunta
    expect(recordedAction(rec, r1.state!, { type: 'ATTACK', unitId: 'a', weaponIndex: 1, targetId: 'e' }, 'player1', dice(9), {}).success).toBe(false)
    expect(rec.steps).toHaveLength(1)
    const frames = replayFrames(rec)
    expect(frames).toHaveLength(2)
    expect(frames[1].units.e.currentHp).toBe(r1.state!.units.e.currentHp)
    expect(frames[0].units.e.currentHp).toBe(10)
  })

  it('una partida entera entre bots se reproduce igual, también con una derrota por abandono', () => {
    const units = loadUnitCatalog(), tactics = loadTacticsCatalog()
    let seed = 7
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const d10 = () => Math.floor(rand() * 10) + 1
    const sq1 = ['ST01-U01', 'ST01-U02', 'ST01-U03'], sq2 = ['ST01-U04', 'ST01-U05', 'ST01-U06']
    const deck = (sq: string[]) => eligibleCards(sq, units, tactics).slice(0, requiredDeckSize(sq, units, tactics)).map(c => c.id)
    let s = startGame(createServerGame('A', 'B', sq1, sq2, deck(sq1), deck(sq2), { rng: d10, random: rand }))
    const rec = startRecording(s)
    for (let n = 0; n < 60 && s.phase !== 'finished'; n++) {
      const p = actingPlayer(s)
      let r = recordedAction(rec, s, chooseBotAction(s, p, rand, 'normal'), p, d10)
      if (!r.success) r = recordedAction(rec, s, botFallback(s), p, d10)
      if (r.success) s = r.state!
    }
    recordForfeit(rec, 'player2', 'B abandona la partida')
    const frames = replayFrames(rec)
    expect(frames).toHaveLength(rec.steps.length + 1)
    const last = frames[frames.length - 1]
    expect(last.winner).toBe('player1')
    expect(last.winReason).toBe('B abandona la partida')
    expect(JSON.stringify(frames[frames.length - 2].units)).toBe(JSON.stringify(s.units))
    expect(JSON.stringify(frames[frames.length - 2].log)).toBe(JSON.stringify(s.log))
  })

  it('el almacén en disco guarda, lista por usuario y no admite ids con rutas', async () => {
    const store = new FileReplayStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ga-replays-')))
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', B)])
    const summary = { id: 'abc123', createdAt: '', mapId: 'DemoMap', players: { player1: 'P1', player2: 'P2' }, winner: null, winReason: '', vp: { player1: 0, player2: 0 }, steps: 0, vsBot: false }
    await store.save({ initial: g, steps: [], summary, userIds: ['u1', 'u2'] })
    expect((await store.load('abc123'))?.summary.id).toBe('abc123')
    expect(await store.listFor('u1')).toHaveLength(1)
    expect((await store.listFor('u2'))[0].mySide).toBe('player2')
    expect(await store.listFor('otro')).toHaveLength(0)
    expect(await store.load('../index')).toBeNull()
  })
})

describe('Revancha y espectadores', () => {
  const units = loadUnitCatalog(), tactics = loadTacticsCatalog()
  const squad = ['ST01-U01', 'ST01-U02', 'ST01-U03']
  const deck = eligibleCards(squad, units, tactics).slice(0, requiredDeckSize(squad, units, tactics)).map(c => c.id)
  const finish = (rm: RoomManager, sid: string) => {
    const room = rm.getRoomBySocket(sid)!
    room.gameState = { ...room.gameState!, phase: 'finished', winner: 'player1' }
    room.status = 'finished'
    return room
  }

  it('contra la máquina la revancha vuelve a la selección de escuadra y guarda la repetición', () => {
    const rm = new RoomManager()
    rm.useReplayStore(new MemoryReplayStore())
    rm.createBotRoom('h', 'Humano', 'u1')
    expect('error' in rm.requestRematch('h')).toBe(true)   // aún no ha terminado
    rm.submitSquad('h', squad, deck)
    rm.confirmSetup('h')
    const room = finish(rm, 'h')
    expect(rm.archiveReplay(room)).toMatch(/^[a-z0-9]{12}$/)
    const r = rm.requestRematch('h')
    expect('error' in r ? r.error : r.ready).toBe(true)
    expect(room.status).toBe('squad_selection')
    expect(room.gameState).toBeNull()
    expect(room.squadSelections.player2).not.toBeNull()   // el bot ya eligió
    expect(room.squadSelections.player1).toBeNull()
  })

  it('entre dos jugadores hace falta que la pidan los dos', () => {
    const rm = new RoomManager()
    const room = rm.createRoom('a', 'Ana', 'u1')
    rm.joinRoom(room.id, 'b', 'Beto', 'u2')
    rm.submitSquad('a', squad, deck)
    rm.submitSquad('b', squad, deck)
    rm.confirmSetup('a'); rm.confirmSetup('b')
    finish(rm, 'a')
    const first = rm.requestRematch('a')
    expect('error' in first ? first.error : first.ready).toBe(false)
    expect(room.status).toBe('finished')
    const second = rm.requestRematch('b')
    expect('error' in second ? second.error : second.ready).toBe(true)
    expect(room.status).toBe('squad_selection')
  })

  it('los espectadores entran en partidas empezadas y no pueden actuar', () => {
    const rm = new RoomManager()
    const room = rm.createBotRoom('h', 'Humano', 'u1')
    expect(rm.addSpectator('v', room.id)).toEqual({ error: 'La partida aún no ha empezado' })
    rm.submitSquad('h', squad, deck)
    rm.confirmSetup('h')
    expect(rm.addSpectator('v', room.id)).toBe(room)
    expect(rm.addSpectator('h', room.id)).toEqual({ error: 'Ya estás jugando en una sala' })
    expect(rm.addSpectator('v2', 'NOEXISTE')).toEqual({ error: 'Sala no encontrada' })
    expect(rm.spectatorCount(room.id)).toBe(1)
    expect(rm.getPlayerIdBySocket('v')).toBeNull()
    expect(rm.removeSpectator('v')).toBe(room.id)
    expect(rm.spectatorCount(room.id)).toBe(0)
  })
})

describe('Plantillas de área colocadas a mano', () => {
  const cone = weapon({ name: 'Twin Buster Rifle', range: 3, strength: 3, area: 'cone' })
  const flower = weapon({ name: '240mm Low-Recoil Cannon', range: 3, strength: 3, area: 'flower' })

  it('la cuña tiene la forma del diagrama: 2 + 3 + 4 hexes, en 6 orientaciones distintas', () => {
    const o = { q: 4, r: 4 }
    const seen = new Set<string>()
    for (let f = 0; f < 6; f++) {
      const hexes = coneHexes(o, f, 3)
      expect(hexes).toHaveLength(9)
      expect([1, 2, 3].map(d => hexes.filter(h => gridDistance(o, h) === d).length)).toEqual([2, 3, 4])
      expect(new Set(hexes.map(hexKey)).size).toBe(9)
      seen.add(hexes.map(hexKey).sort().join('|'))
    }
    expect(seen.size).toBe(6)
    // War Edge (fondo 2): 5 hexes
    expect(coneHexes(o, 0, 2)).toHaveLength(5)
    // Las 6 cuñas de fondo 1 cubren los 6 vecinos, cada uno en dos cuñas
    const count = new Map<string, number>()
    for (let f = 0; f < 6; f++) for (const h of coneHexes(o, f, 1)) count.set(hexKey(h), (count.get(hexKey(h)) ?? 0) + 1)
    expect([...count.keys()].sort()).toEqual(getNeighbors(o).map(hexKey).sort())
    expect([...count.values()].every(n => n === 2)).toBe(true)
  })

  it('la orientación elegida decide a quién alcanza la cuña', () => {
    const units = () => [
      makeUnit('a', 'player1', { q: 3, r: 3 }, { weapons: [cone] }),
      makeUnit('e1', 'player2', { q: 4, r: 3 }),
      makeUnit('e2', 'player2', { q: 2, r: 3 }),
    ]
    const facings = [0, 1, 2, 3, 4, 5]
    const hit = (f: number) => {
      const r = applyAction(makeGame(units()), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e1', aim: { facing: f } }, 'player1', dice(5, 5, 5))
      return r.success ? (r.newState!.pendingAttack ? 'pausa' : 'ok') : r.error
    }
    const valid = facings.filter(f => hit(f) === 'ok')
    expect(valid).toHaveLength(2)   // E1 está en dos cuñas (las que comparten su dirección)
    for (const f of facings.filter(f => !valid.includes(f))) expect(hit(f)).toBe('El objetivo no está dentro de la plantilla')
    expect(hit(7)).toBe('Orientación de la plantilla no válida')
    // e2 está justo detrás: ninguna orientación válida para e1 lo alcanza
    for (const f of valid) {
      const s = applyAction(makeGame(units()), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e1', aim: { facing: f } }, 'player1', dice(5, 5, 5)).newState!
      expect(s.units.e1.currentHp).toBe(7)
      expect(s.units.e2.currentHp).toBe(10)
    }
  })

  it('sin orientación, el motor elige la que alcanza a más enemigos', () => {
    const g = makeGame([
      makeUnit('a', 'player1', { q: 3, r: 3 }, { weapons: [cone] }),
      makeUnit('e1', 'player2', { q: 4, r: 3 }),
      makeUnit('e2', 'player2', { q: 5, r: 2 }),
      makeUnit('e3', 'player2', { q: 5, r: 4 }),
    ])
    const counts = [0, 1, 2, 3, 4, 5].map(f => applyAction(g, { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e1', aim: { facing: f } }, 'player1', dice(5, 5, 5)))
      .map(r => r.success ? Object.values(r.newState!.units).filter(u => u.playerId === 'player2' && u.currentHp < 10).length : 0)
    const auto = applyAttack(g, 'a', 0, 'e1', 'player1', dice(5, 5, 5)).newState!
    expect(Object.values(auto.units).filter(u => u.playerId === 'player2' && u.currentHp < 10).length).toBe(Math.max(...counts))
  })

  it('la flor se puede centrar en un hex vacío a alcance para alcanzar a dos enemigos', () => {
    const units = () => [
      makeUnit('a', 'player1', { q: 1, r: 3 }, { weapons: [flower] }),
      makeUnit('e1', 'player2', { q: 3, r: 2 }),
      makeUnit('e2', 'player2', { q: 3, r: 4 }),
    ]
    // Centrada en (3,3), vacío y vecino de los dos
    const r = applyAction(makeGame(units()), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e1', aim: { center: { q: 3, r: 3 } } }, 'player1', dice(5, 5, 5, 5, 5, 5))
    expect(r.success).toBe(true)
    expect(r.newState!.units.e1.currentHp).toBe(7)
    expect(r.newState!.units.e2.currentHp).toBe(7)
    // Centrada en el propio e1 no llega a e2
    const solo = applyAttack(makeGame(units()), 'a', 0, 'e1', 'player1', dice(5, 5, 5, 5, 5, 5)).newState!
    expect(solo.units.e2.currentHp).toBe(10)
    // Rechazos: centro fuera de alcance y objetivo fuera de la flor
    const short = makeGame(units())
    short.units.a.weapons = [{ ...flower, range: 2 }]
    expect(applyAction(short, { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e1', aim: { center: { q: 4, r: 2 } } }, 'player1', dice()).error).toBe('Objetivo fuera de alcance')
    expect(applyAction(makeGame(units()), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e2', aim: { center: { q: 3, r: 1 } } }, 'player1', dice()).error).toBe('El objetivo no está dentro de la plantilla')
  })

  it('War Edge (carta Attack) tiene una cuña de fondo 2', () => {
    const card = loadTacticsCatalog().find(c => c.id === 'ST01-T11')!
    expect(card.weapon).toMatchObject({ area: 'cone', range: 2 })
  })
})

describe('Plantillas fijas del 240mm Low-Recoil Cannon y el Quadruple Bop Missile', () => {
  const units = loadUnitCatalog()
  const cells = (cardId: string, name: string) => units.find(u => u.cardId === cardId)!.weapons.find(w => w.name === name)!
  const o = { q: 4, r: 4 }

  it('240mm: un hex adyacente y los 3 que tiene detrás (diagrama de la carta), en 6 orientaciones', () => {
    const w = cells('PA01-U02', '240mm Low-Recoil Cannon')
    expect(w.area).toBe('pattern')
    for (let f = 0; f < 6; f++) {
      const hexes = patternHexes(o, f, w.areaCells!)
      const near = hexes.filter(h => gridDistance(o, h) === 1)
      const far = hexes.filter(h => gridDistance(o, h) === 2)
      expect(near).toHaveLength(1)
      expect(far).toHaveLength(3)
      for (const h of far) expect(gridDistance(near[0], h)).toBe(1)
    }
  })

  it('Bop Missile: flor de 7 con el centro a 2 hexes, dos pétalos tocando a la unidad', () => {
    const w = cells('PA01-U03', 'Quadruple Bop Missile')
    expect(w).toMatchObject({ area: 'pattern', tlCost: 3, strength: 5 })
    expect(w.effectData ?? null).toBeNull()   // la carta no tiene "also targets…" (eso es el Beam Rifle del Guncannon)
    for (let f = 0; f < 6; f++) {
      const hexes = patternHexes(o, f, w.areaCells!)
      expect(new Set(hexes.map(hexKey)).size).toBe(7)
      const center = hexes.find(c => hexes.every(h => h === c || gridDistance(c, h) === 1))!
      expect(center).toBeDefined()
      expect(gridDistance(o, center)).toBe(2)
      expect(hexes.filter(h => gridDistance(o, h) === 1)).toHaveLength(2)
    }
  })

  it('el 240mm alcanza a los dos enemigos de su forma y no a uno a distancia 3', () => {
    const cannon = cells('PA01-U02', '240mm Low-Recoil Cannon')
    const make = () => {
      const a = makeUnit('a', 'player1', o, { weapons: [{ ...cannon, strength: 3 }] })
      const [, d0] = patternHexes(o, 0, cannon.areaCells!)          // [2, 0]: detrás del adyacente
      const side = patternHexes(o, 0, cannon.areaCells!)[2]         // [1, 1]
      return makeGame([a, makeUnit('e1', 'player2', d0), makeUnit('e2', 'player2', side), makeUnit('far', 'player2', { q: 4, r: 1 })])
    }
    const s = applyAction(make(), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e1', aim: { facing: 0 } }, 'player1', dice(5, 5, 5, 5, 5, 5))
    expect(s.success).toBe(true)
    expect(s.newState!.units.e1.currentHp).toBe(7)
    expect(s.newState!.units.e2.currentHp).toBe(7)
    expect(gridDistance(o, { q: 4, r: 1 })).toBe(3)
    expect(checkAttackTargetWith(make(), 'a', cannon, '4,1').reason).toBe('El objetivo no está dentro de la plantilla')
  })

  it('el Beam Rifle del Guncannon sí alcanza a los enemigos adyacentes al objetivo', () => {
    expect(cells('PA01-U02', 'Beam Rifle')).toMatchObject({ tlCost: 4, range: 4, strength: 7, effectData: { type: 'also_target_adjacent' } })
  })
})

describe('Estrategias del bot', () => {
  const card = (name: string) => structuredClone(loadTacticsCatalog().find(c => c.name === name)!)
  // Ataque flojo a alcance y un Objetivo de 8 VP cerca: agresión dispara, control va a por el Objetivo
  const setup = () => {
    const g = makeGame([
      makeUnit('a', 'player1', A, { weapons: [weapon({ name: 'Rifle flojo', range: 4, strength: 2, tlCost: 3 })] }),
      makeUnit('e', 'player2', { q: 6, r: 2 }),
    ])
    g.board[hexKey({ q: 2, r: 4 })].objectiveToken = { id: 'o', vpValue: 8, controlledBy: null }
    return g
  }
  it('agresión ataca aunque el ataque sea flojo', () => {
    expect(chooseBotAction(setup(), 'player1', () => 0.5, 'dificil', 'agresion').type).toBe('ATTACK')
  })
  it('control prefiere ir al Objetivo antes que un ataque flojo', () => {
    const act = chooseBotAction(setup(), 'player1', () => 0.5, 'dificil', 'control')
    expect(act.type).toBe('ADVANCE')
    const to = (act as { to: { q: number; r: number } }).to
    expect(gridDistance(to, { q: 2, r: 4 })).toBeLessThanOrEqual(1)
  })
  it('velocidad elige el arma más barata si las dos alcanzan', () => {
    const g = makeGame([
      makeUnit('a', 'player1', A, { weapons: [weapon({ name: 'Cara', range: 3, strength: 5, tlCost: 4 }), weapon({ name: 'Barata', range: 3, strength: 4, tlCost: 2 })] }),
      makeUnit('e', 'player2', B),
    ])
    expect(chooseBotAction(g, 'player1', () => 0.5, 'dificil', 'velocidad')).toMatchObject({ type: 'ATTACK', weaponIndex: 1 })
  })
  it('no juega cartas cuya condición no se cumple (si no, el motor las rechaza y el bot pierde la activación)', () => {
    const g = setup()
    g.players.player1.tactics.hand = [card("Hero's Might")]
    expect(chooseBotAction(g, 'player1', () => 0.1, 'dificil', 'agresion').type).not.toBe('PLAY_CARD')
    g.players.player1.garrisonsRescued = 3
    expect(chooseBotAction(g, 'player1', () => 0.1, 'dificil', 'agresion')).toMatchObject({ type: 'PLAY_CARD' })
    g.players.player1.tactics.hand = [card('Full System Burn')]   // exige una unidad Londo Bell
    expect(chooseBotAction(g, 'player1', () => 0.1, 'dificil', 'agresion').type).not.toBe('PLAY_CARD')
  })
})

describe('Planificador (bot experto y consejero)', () => {
  it('concentra el fuego: con dos enemigos a tiro, ataca al que está tocado', () => {
    const g = makeGame([
      makeUnit('a', 'player1', { q: 2, r: 4 }, { weapons: [weapon({ range: 4, strength: 5, tlCost: 3 })] }),
      makeUnit('sano', 'player2', { q: 5, r: 4 }),
      makeUnit('tocado', 'player2', { q: 5, r: 3 }, { currentHp: 3 }),
    ])
    const best = planActivation(g, 'player1')[0]
    expect(best.steps.some(a => a.type === 'ATTACK' && a.targetId === 'tocado')).toBe(true)
    expect(chooseBotAction(g, 'player1', () => 0.9, 'experto')).toEqual(best.steps[0])
  })
  it('se aleja de un enemigo que puede derribarla antes de que vuelva a activar', () => {
    const g = makeGame([
      makeUnit('a', 'player1', { q: 4, r: 4 }, { currentHp: 4, weapons: [weapon({ name: 'Saber', range: 1, strength: 3, tlCost: 2 })] }),
      makeUnit('e', 'player2', { q: 7, r: 4 }, { weapons: [weapon({ name: 'Cañón', range: 2, strength: 10, tlCost: 3 })] }),
    ])
    const plans = planActivation(g, 'player1')
    expect(plans.some(p => p.parts.some(x => x.label.startsWith('Expuesta')))).toBe(true)
    // La mejor jugada termina donde ese enemigo ya no llega (moviéndose y disparando)
    expect(plans[0].parts.some(x => x.label.startsWith('Expuesta'))).toBe(false)
    expect(gridDistance(keyToHex(plans[0].end), { q: 7, r: 4 })).toBeGreaterThan(3)
  })
  it('va a capturar un Objetivo libre que tiene al alcance', () => {
    const g = makeGame([
      makeUnit('a', 'player1', { q: 1, r: 4 }, { weapons: [weapon({ name: 'Saber', range: 1, strength: 3, tlCost: 2 })] }),
      makeUnit('e', 'player2', { q: 7, r: 0 }, { weapons: [weapon({ name: 'Saber', range: 1, strength: 3, tlCost: 2 })] }),
    ])
    g.board['4,4'].objectiveToken = { id: 'obj_3', vpValue: 8, controlledBy: null }
    const best = planActivation(g, 'player1')[0]
    expect(gridDistance(keyToHex(best.end), { q: 4, r: 4 })).toBeLessThanOrEqual(1)
    expect(best.parts.some(x => x.label.includes('Captura el Objetivo 3'))).toBe(true)
  })
  it('el consejero da hasta 3 jugadas distintas, con sus pasos en texto, y nada si no es tu unidad', () => {
    const g = makeGame([
      makeUnit('a', 'player1', { q: 2, r: 4 }, { weapons: [weapon({ range: 4, strength: 5, tlCost: 3 })] }),
      makeUnit('e', 'player2', { q: 5, r: 4 }),
    ])
    const plays = suggestPlays(g, 'player1').map(p => toSuggestion(g, p))
    expect(plays.length).toBeGreaterThan(1)
    expect(plays.length).toBeLessThanOrEqual(3)
    expect(new Set(plays.map(p => JSON.stringify(p.actions[0]) + p.end)).size).toBe(plays.length)
    expect(plays[0].steps.every(t => typeof t === 'string' && t.length > 0)).toBe(true)
    expect(suggestPlays(g, 'player2')).toEqual([])
    // No toca el estado (mueve la unidad de forma virtual y la devuelve)
    expect(g.units.a.position).toEqual({ q: 2, r: 4 })
    expect(g.board['2,4'].occupiedBy).toBe('a')
  })
  it('nunca propone terminar sobre la Base', () => {
    const g = makeGame([
      makeUnit('a', 'player1', { q: 0, r: 6 }, { weapons: [weapon({ name: 'Saber', range: 1, strength: 3, tlCost: 2 })] }),
      makeUnit('e', 'player2', { q: 7, r: 0 }),
    ])
    for (const p of planActivation(g, 'player1')) expect(baseOwnerAt(g, p.end)).toBeNull()
  })
})

describe('Modo mesa: dados introducidos a mano', () => {
  const mesa = { choosePushes: true, manualDice: true }
  const setup = (over: Partial<Unit> = {}) => makeGame([
    makeUnit('a', 'player1', A, { weapons: [weapon({ name: 'Rifle', range: 4, strength: 4, tlCost: 3 })], ...over }),
    makeUnit('e', 'player2', { q: 5, r: 2 }),
  ])
  it('el ataque se para pidiendo tantos dados como su Strength y se resuelve con los que se introducen', () => {
    const r = processAction(setup(), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e' }, 'player1', undefined, mesa)
    expect(r.success).toBe(true)
    const pd = r.state!.pendingDice!
    expect(pd.count).toBe(4)
    expect(pd.reason).toContain('Rifle')
    expect(r.state!.units.e.currentHp).toBe(10)
    // Mientras falten los dados no se puede hacer otra cosa, y la cantidad tiene que cuadrar
    expect(processAction(r.state!, { type: 'END_ACTIVATION', unitId: 'a' }, 'player1', undefined, mesa).error).toBe('Faltan los dados de la tirada')
    expect(processAction(r.state!, { type: 'SUBMIT_DICE', values: [5, 5] }, 'player1', undefined, mesa).success).toBe(false)
    expect(processAction(r.state!, { type: 'SUBMIT_DICE', values: [5, 5, 5, 11] }, 'player1', undefined, mesa).success).toBe(false)
    const done = processAction(r.state!, { type: 'SUBMIT_DICE', values: [5, 5, 5, 1] }, 'player1', undefined, mesa)
    expect(done.success).toBe(true)
    expect(done.state!.pendingDice).toBeFalsy()
    expect(done.state!.units.e.currentHp).toBe(7)
    expect(done.state!.lastAttack!.rolls).toEqual([5, 5, 5, 1])
  })
  it('pide los dados extra cuando hacen falta (Disarm repite los impactos) y quién tira es quien decide', () => {
    const r = processAction(setup({ statusEffects: [{ type: 'disarm' }] }), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e' }, 'player1', undefined, mesa)
    expect(actingPlayer(r.state!)).toBe('player1')
    const more = processAction(r.state!, { type: 'SUBMIT_DICE', values: [5, 5, 1, 1] }, 'player1', undefined, mesa)
    expect(more.state!.pendingDice!.count).toBe(2)
    expect(more.state!.pendingDice!.reason).toContain('Disarmed')
    const done = processAction(more.state!, { type: 'SUBMIT_DICE', values: [1, 6] }, 'player1', undefined, mesa)
    expect(done.state!.units.e.currentHp).toBe(9)
  })
  it('si el ataque arranca al pasar el rival su Response, los dados los tira el atacante', () => {
    const g = setup()
    g.players.player2.tactics.hand = [structuredClone(loadTacticsCatalog().find(c => c.name === 'Interference')!)]
    const r = processAction(g, { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e' }, 'player1', undefined, mesa)
    expect(r.state!.pendingResponse?.forPlayerId).toBe('player2')
    const passed = processAction(r.state!, { type: 'PASS_RESPONSE' }, 'player2', undefined, mesa)
    expect(passed.state!.pendingDice!.count).toBe(4)
    expect(passed.state!.pendingDice!.forPlayerId).toBe('player1')
    expect(actingPlayer(passed.state!)).toBe('player1')
  })
  it('sin el modo mesa no se piden dados', () => {
    const r = processAction(setup(), { type: 'ATTACK', unitId: 'a', weaponIndex: 0, targetId: 'e' }, 'player1', dice(5, 5, 5, 5), { choosePushes: true })
    expect(r.state!.pendingDice).toBeFalsy()
    expect(r.state!.units.e.currentHp).toBe(6)
    expect(processAction(r.state!, { type: 'SUBMIT_DICE', values: [1] }, 'player1').error).toBe('No hay ninguna tirada pendiente')
  })
})

describe('Modo mesa: cartas robadas', () => {
  const card = (name: string) => structuredClone(loadTacticsCatalog().find(c => c.name === name)!)
  const setup = () => {
    const g = makeGame([makeUnit('a', 'player1', A), makeUnit('e', 'player2', { q: 6, r: 2 })])
    g.mesa = true
    g.players.player1.tactics.deck = [card('Interference'), card('Neutralize'), card('Limiter Release')]
    return g
  }
  it('al robar no se coge la carta de arriba: se apunta cuántas y el jugador dice cuáles', () => {
    const g = setup()
    drawTactics(g, 'player1', 2)
    expect(g.players.player1.tactics.hand).toEqual([])
    expect(g.players.player1.tactics.toPick).toBe(2)
    drawTactics(g, 'player1', 5)   // no se pueden robar más de las que quedan en el mazo
    expect(g.players.player1.tactics.toPick).toBe(3)
    const r = processAction(g, { type: 'MESA_DRAW', cardIds: [g.players.player1.tactics.deck[2].id] }, 'player1')
    expect(r.success).toBe(true)
    expect(r.state!.players.player1.tactics.hand.map(c => c.name)).toEqual(['Limiter Release'])
    expect(r.state!.players.player1.tactics.deck).toHaveLength(2)
    expect(r.state!.players.player1.tactics.toPick).toBe(2)
  })
  it('rechaza elegir sin robo pendiente, más de las robadas o cartas que no están en el mazo', () => {
    const g = setup()
    const id = g.players.player1.tactics.deck[0].id
    expect(processAction(g, { type: 'MESA_DRAW', cardIds: [id] }, 'player1').success).toBe(false)
    g.players.player1.tactics.toPick = 1
    expect(processAction(g, { type: 'MESA_DRAW', cardIds: [id, g.players.player1.tactics.deck[1].id] }, 'player1').success).toBe(false)
    expect(processAction(g, { type: 'MESA_DRAW', cardIds: ['no-existe'] }, 'player1').success).toBe(false)
    g.mesa = false
    drawTactics(g, 'player1', 1)    // fuera del modo mesa se roba como siempre
    expect(g.players.player1.tactics.hand).toHaveLength(1)
  })
})
