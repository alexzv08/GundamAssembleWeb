// Tests del motor autoritativo (server/src/game). Cada bloque cita la regla
// del Core Rulebook v1.2 que comprueba.
import { describe, it, expect } from 'vitest'
import type { BoardMap, GameState, Unit, Weapon, Ability } from '../../types'
import { hexDistance, getNeighbors, hexKey, checkLineOfSight, getReachableHexes } from '../hexGrid'
import {
  createEmptyTimeline, placeInitialToken, getNextActivation, advanceToken, getUnitRound, reorderSlotForTie,
} from '../timeline'
import { reachableFor, checkAttackTarget, isEngaged } from '../queries'
import { applyAction, applyAdvance, applyAttack, applyAttackGarrison, applyEndActivation, applyUseAbility, applyDash } from '../actions'
import { processAction } from '../engine'
import { beginActivation, newActivation, startGame } from '../activation'
import { contestObjectives, scoreObjectives, decideWinner } from '../victory'
import { forceMove } from '../damage'
import { validateSquad, validateDeck, loadUnitCatalog, loadTacticsCatalog, requiredDeckSize } from '../catalog'
import { createServerGame } from '../createServerGame'
import { RoomManager } from '../../rooms/roomManager'

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
    actionLog: [], log: [], lastAttack: null, winner: null, pendingResponse: null,
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
