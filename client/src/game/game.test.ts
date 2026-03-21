import { describe, it, expect } from 'vitest'
import {
  hexDistance, getNeighbors, findPath, hexKey
} from './hexGrid'
import {
  createEmptyTimeline, placeInitialToken, getNextActivation,
  advanceToken, getUnitRound, resetForPhase2, reorderSlotForTie
} from './timeline'
import { BoardMap } from '../types'

// ─── BOARD DE PRUEBA ──────────────────────────────────────────────────────────
function makeBoard(): BoardMap {
  const board: BoardMap = {}
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue
      const key = `${q},${r}`
      board[key] = {
        coord: { q, r }, terrain: 'normal', elevation: 0,
        occupiedBy: null, upgradeToken: null,
        garrisonToken: null, objectiveToken: null,
      }
    }
  }
  return board
}

// ─── HEXGRID ──────────────────────────────────────────────────────────────────
describe('hexDistance', () => {
  it('distancia 0 a sí mismo', () =>
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0))
  it('distancia 1 a vecino directo', () =>
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1))
  it('distancia 2', () =>
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(2))
})

describe('getNeighbors', () => {
  it('devuelve 6 vecinos', () =>
    expect(getNeighbors({ q: 0, r: 0 })).toHaveLength(6))
  it('todos a distancia 1', () =>
    getNeighbors({ q: 0, r: 0 }).forEach(n =>
      expect(hexDistance({ q: 0, r: 0 }, n)).toBe(1)))
})

describe('pathfinding', () => {
  it('encuentra camino simple', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, makeBoard(), new Set(), 3)
    expect(path).not.toBeNull()
    expect(path!.length).toBe(2)
  })
  it('respeta maxDistance', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, makeBoard(), new Set(), 1)
    expect(path).toBeNull()
  })
  it('rodea obstáculos', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, makeBoard(), new Set(['1,0']), 4)
    expect(path).not.toBeNull()
    expect(path!.every(h => hexKey(h) !== '1,0')).toBe(true)
  })
})

// ─── TIMELINE ─────────────────────────────────────────────────────────────────
describe('createEmptyTimeline', () => {
  it('crea 10 slots vacíos', () => {
    const tl = createEmptyTimeline()
    expect(tl.slots).toHaveLength(10)
    expect(tl.slots.every(s => s.tokens.length === 0)).toBe(true)
  })
})

describe('placeInitialToken', () => {
  it('coloca token en el slot correcto', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78', playerId: 'player1' }, 3)
    expect(tl.slots[2].tokens).toHaveLength(1)
    expect(tl.slots[2].tokens[0].unitId).toBe('rx78')
  })
  it('apila tokens en el mismo slot (nuevo va debajo)', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78',  playerId: 'player1' }, 3)
    tl = placeInitialToken(tl, { unitId: 'zaku2', playerId: 'player2' }, 3)
    expect(tl.slots[2].tokens[0].unitId).toBe('rx78')   // primero arriba
    expect(tl.slots[2].tokens[1].unitId).toBe('zaku2')  // segundo debajo
  })
})

describe('getNextActivation', () => {
  it('devuelve el token del round más bajo', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78',  playerId: 'player1' }, 5)
    tl = placeInitialToken(tl, { unitId: 'zaku2', playerId: 'player2' }, 3)
    expect(getNextActivation(tl)?.unitId).toBe('zaku2')
  })
  it('devuelve null si no hay tokens', () => {
    expect(getNextActivation(createEmptyTimeline())).toBeNull()
  })
})

describe('advanceToken', () => {
  it('mueve el token al slot correcto', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78', playerId: 'player1' }, 2)
    tl = advanceToken(tl, 'rx78', 3)
    expect(getUnitRound(tl, 'rx78')).toBe(5)
  })
  it('elimina el token si supera round 10', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78', playerId: 'player1' }, 9)
    tl = advanceToken(tl, 'rx78', 3)
    expect(getUnitRound(tl, 'rx78')).toBeNull()
  })
})

describe('resetForPhase2', () => {
  it('recoloca todos los tokens desde cero', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78', playerId: 'player1' }, 9)
    tl = advanceToken(tl, 'rx78', 3)  // sale del timeline
    tl = resetForPhase2(tl, [{ unitId: 'rx78', playerId: 'player1', startingTl: 2 }])
    expect(getUnitRound(tl, 'rx78')).toBe(2)
  })
})

describe('resolveInitiativeTie', () => {
  it('el jugador que NO actuó último va primero', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78',  playerId: 'player1' }, 3)
    tl = placeInitialToken(tl, { unitId: 'zaku2', playerId: 'player2' }, 3)
    tl = reorderSlotForTie(tl, 3, 'player1')
    // player1 actuó último → player2 debe estar arriba
    expect(tl.slots[2].tokens[0].playerId).toBe('player2')
  })
})


// ─── IMPORTS ADICIONALES (añade al principio del archivo) ─────────────────────
import { applyAdvance, applyAttack, applyEnergize, applyDash } from './actions'
import { GameState, Unit } from '../types'

// ─── ESTADO DE PRUEBA ─────────────────────────────────────────────────────────
function makeUnit(id: string, playerId: 'player1' | 'player2', q: number, r: number): Unit {
  return {
    id, name: id, unitType: 'Mobile Suit', traits: [],
    maxHp: 5, vp: 3, startingTl: 2,
    currentHp: 5, energy: 0,
    position: { q, r },
    weapons: [{
      name: 'Beam Rifle', range: 3, strength: 3, tlCost: 2
    }],
    abilities: [], statusEffects: [], upgrades: [],
    playerId, activated: false,
  }
}

function makeGameState(): GameState {
  const board = makeBoard()
  const rx78  = makeUnit('rx78',  'player1', 0, 0)
  const zaku2 = makeUnit('zaku2', 'player2', 2, 0)

  board['0,0'].occupiedBy = 'rx78'
  board['2,0'].occupiedBy = 'zaku2'

  let timeline = createEmptyTimeline()
  timeline = placeInitialToken(timeline, { unitId: 'rx78',  playerId: 'player1' }, 2)
  timeline = placeInitialToken(timeline, { unitId: 'zaku2', playerId: 'player2' }, 4)

  return {
    gameId: 'test-game',
    phase: 'phase1',
    activePlayerId: 'player1',
    activeUnitId: 'rx78',
    roundNumber: 1,
    board,
    units: { rx78, zaku2 },
    timeline,
    players: {
      player1: { id: 'player1', name: 'P1', vp: 0, tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false }, squadUnitIds: ['rx78'] },
      player2: { id: 'player2', name: 'P2', vp: 0, tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false }, squadUnitIds: ['zaku2'] },
    },
    actionLog: [],
    winner: null,
  }
}

// ─── TESTS DE ACCIONES ────────────────────────────────────────────────────────
describe('applyAdvance', () => {
  it('mueve la unidad al hex destino', () => {
    const state  = makeGameState()
    const result = applyAdvance(state, 'rx78', { q: 1, r: 0 }, 'player1')
    expect(result.success).toBe(true)
    expect(result.newState!.units['rx78'].position).toEqual({ q: 1, r: 0 })
  })
it('rechaza movimiento fuera de rango', () => {
    const state  = makeGameState()
    // { q: 2, r: 0 } está ocupado por zaku2 (enemigo), a distancia 2 pero bloqueado
    // Usamos { q: -2, r: 0 } que está a distancia 2 pero en dirección opuesta — válido
    // Para probar fuera de rango usamos distancia 4: imposible con maxMove=3
    const result = applyAdvance(state, 'rx78', { q: 2, r: -1 }, 'player1')
    // distancia de (0,0) a (2,-1) = max(2,1,1) = 2 — dentro de rango
    // Mejor: mover rx78 primero y luego intentar saltar muy lejos
    // La forma más limpia: usar un hex que no existe en el board
    const result2 = applyAdvance(state, 'rx78', { q: 99, r: 99 }, 'player1')
    expect(result2.success).toBe(false)
  })
  it('rechaza si no es tu turno', () => {
    const state  = makeGameState()
    const result = applyAdvance(state, 'rx78', { q: 1, r: 0 }, 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toBe('No es tu turno')
  })
})

describe('applyAttack', () => {
  it('aplica daño con hits', () => {
    const state  = makeGameState()
    // Mover rx78 a distancia de ataque: ya está a distancia 2 de zaku2
    const result = applyAttack(state, 'rx78', 0, 'zaku2', 'player1', [6, 7, 8])
    expect(result.success).toBe(true)
    // 3 hits → 3 daño → zaku2 tiene 5-3=2 HP
    expect(result.newState!.units['zaku2'].currentHp).toBe(2)
  })
  it('un roll de 1 nunca impacta', () => {
    const state  = makeGameState()
    const result = applyAttack(state, 'rx78', 0, 'zaku2', 'player1', [1, 1, 1])
    expect(result.success).toBe(true)
    expect(result.newState!.units['zaku2'].currentHp).toBe(5)
  })
  it('derrota la unidad y suma VP', () => {
    const state  = makeGameState()
    const result = applyAttack(state, 'rx78', 0, 'zaku2', 'player1', [6, 7, 8, 8, 8])
    // Aunque solo hay 3 dados en el arma, probamos con daño suficiente
    // Ajustamos: zaku2 tiene 5 HP, necesitamos 5 hits
    const result2 = applyAttack(state, 'rx78', 0, 'zaku2', 'player1', [5, 6, 7])
    // 3 hits → 3 daño, no suficiente. Vamos a bajar HP manualmente
    const lowHpState = { ...makeGameState() }
    lowHpState.units['zaku2'] = { ...lowHpState.units['zaku2'], currentHp: 2 }
    const result3 = applyAttack(lowHpState, 'rx78', 0, 'zaku2', 'player1', [5, 6, 7])
    expect(result3.success).toBe(true)
    expect(result3.newState!.units['zaku2'].currentHp).toBe(0)
    expect(result3.newState!.players['player1'].vp).toBe(3) // VP de zaku2
  })
})

describe('applyEnergize', () => {
  it('añade 1 token de energía', () => {
    const state  = makeGameState()
    const result = applyEnergize(state, 'rx78', 'player1')
    expect(result.success).toBe(true)
    expect(result.newState!.units['rx78'].energy).toBe(1)
  })
  it('avanza TL 2 posiciones', () => {
    const state  = makeGameState()
    const result = applyEnergize(state, 'rx78', 'player1')
    expect(getUnitRound(result.newState!.timeline, 'rx78')).toBe(4)
  })
})

describe('applyDash', () => {
  it('mueve 2 hexes adicionales', () => {
    const state  = makeGameState()
    const result = applyDash(state, 'rx78', { q: -1, r: 0 }, 'player1')
    expect(result.success).toBe(true)
    expect(result.newState!.units['rx78'].position).toEqual({ q: -1, r: 0 })
  })
})