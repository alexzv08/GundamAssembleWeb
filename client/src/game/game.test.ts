import { describe, it, expect } from 'vitest'
import {
  hexDistance, getNeighbors, findPath, hexKey
} from './hexGrid'
import {
  createEmptyTimeline, placeInitialToken, getNextActivation,
  advanceToken, getUnitRound, resetForPhase2, reorderSlotForTie
} from './timeline'
import type { BoardMap } from '../types'
import {
  checkGameOver, resolveObjectiveControl,
  transitionToPhase2, awardObjectiveVP
} from './victory'
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
        garrisonToken: null, objectiveToken: null, deployZone: null,
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
  it('crea 20 slots vacíos', () => {
    const tl = createEmptyTimeline()
    expect(tl.slots).toHaveLength(20)
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
  it('token en round 9 con coste 3 avanza a round 12 (fase 2)', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78', playerId: 'player1' }, 9)
    tl = advanceToken(tl, 'rx78', 3)
    expect(getUnitRound(tl, 'rx78')).toBe(12)
  })
  it('elimina el token si supera round 20', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78', playerId: 'player1' }, 18)
    tl = advanceToken(tl, 'rx78', 3)
    expect(getUnitRound(tl, 'rx78')).toBeNull()
  })
})

describe('resetForPhase2', () => {
  it('recoloca todos los tokens desde cero', () => {
    let tl = createEmptyTimeline()
    tl = placeInitialToken(tl, { unitId: 'rx78', playerId: 'player1' }, 18)
    tl = advanceToken(tl, 'rx78', 3)  // 18+3=21 → sale del timeline
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
import { applyAdvance, applyAttack, applyEnergize, applyDash, applyUseAbility, applyPlayCard, applyAttackGarrison, applyPlayResponse, applyPassResponse } from './actions'
import type { GameState, Unit } from '../types'

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
    log: [],
    winner: null,
    pendingResponse: null,
    lastActivePlayer: null,
    hasUsedPrimaryAction: false,
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
    applyAdvance(state, 'rx78', { q: 2, r: -1 }, 'player1')
    const outOfBoard = applyAdvance(state, 'rx78', { q: 99, r: 99 }, 'player1')
    expect(outOfBoard.success).toBe(false)
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
    // Bajamos HP manualmente para probar derrota
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

// ─── USE_ABILITY ──────────────────────────────────────────────────────────────
describe('applyUseAbility', () => {
  function makeUnitWithAbility(id: string, playerId: 'player1' | 'player2', q: number, r: number) {
    return {
      ...makeUnit(id, playerId, q, r),
      abilities: [{
        name: 'Fractura Táctica',
        type: 'CMD' as const,
        description: 'Aplica fracture a un enemigo en rango 3',
        abilityData: { type: 'fracture_enemy' as const, range: 3 },
      }],
    }
  }

  it('valida turno incorrecto', () => {
    const state = makeGameState()
    const result = applyUseAbility(state, 'rx78', 0, 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toBe('No es tu turno')
  })

  it('rechaza habilidad no CMD', () => {
    const state = makeGameState()
    state.units['rx78'].abilities = [{
      name: 'Pasiva', type: 'ONG', description: '...', abilityData: null
    }]
    const result = applyUseAbility(state, 'rx78', 0, 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('CMD')
  })

  it('rechaza si energía insuficiente', () => {
    const state = makeGameState()
    state.units['rx78'].abilities = [{
      name: 'Habilidad cara', type: 'CMD', description: '...', energyCost: 2,
      abilityData: { type: 'fracture_enemy' as const, range: 3 },
    }]
    state.units['rx78'].energy = 1
    const result = applyUseAbility(state, 'rx78', 0, 'player1', 'zaku2')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Energía')
  })

  it('rechaza habilidad sin abilityData (no implementada)', () => {
    const state = makeGameState()
    state.units['rx78'].abilities = [{
      name: 'Sin implementar', type: 'CMD', description: '...', abilityData: null
    }]
    const result = applyUseAbility(state, 'rx78', 0, 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('no está implementada')
  })

  it('fracture_enemy: requiere targetId', () => {
    const state = makeGameState()
    state.units['rx78'] = makeUnitWithAbility('rx78', 'player1', 0, 0)
    const result = applyUseAbility(state, 'rx78', 0, 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('objetivo')
  })

  it('fracture_enemy: rechaza objetivo aliado', () => {
    const state = makeGameState()
    state.units['rx78'] = makeUnitWithAbility('rx78', 'player1', 0, 0)
    const result = applyUseAbility(state, 'rx78', 0, 'player1', 'rx78')
    expect(result.success).toBe(false)
  })

  it('fracture_enemy: rechaza objetivo fuera de rango', () => {
    const state = makeGameState()
    state.units['rx78'] = makeUnitWithAbility('rx78', 'player1', 0, 0)
    state.units['zaku2'].position = { q: 0, r: 4 }  // distancia 4 > rango 3
    const result = applyUseAbility(state, 'rx78', 0, 'player1', 'zaku2')
    expect(result.success).toBe(false)
    expect(result.error).toContain('rango')
  })

  it('fracture_enemy: acepta objetivo enemigo en rango', () => {
    const state = makeGameState()
    state.units['rx78'] = makeUnitWithAbility('rx78', 'player1', 0, 0)
    const result = applyUseAbility(state, 'rx78', 0, 'player1', 'zaku2')
    expect(result.success).toBe(true)
  })
})

// ─── ATTACK_GARRISON ──────────────────────────────────────────────────────────
describe('applyAttackGarrison', () => {
  function makeStateWithGarrison(): GameState {
    const state = makeGameState()
    // Garrison enemiga en (1,0) — adyacente a rx78 en (0,0), dentro de rango 3
    state.board['1,0'] = {
      coord: { q: 1, r: 0 }, terrain: 'normal', elevation: 0,
      occupiedBy: null, upgradeToken: null, objectiveToken: null, deployZone: null,
      garrisonToken: { id: 'gar1', owner: 'player2', hp: 1 },
    }
    return state
  }

  it('rechaza si no es tu turno', () => {
    const state = makeStateWithGarrison()
    const result = applyAttackGarrison(state, 'rx78', 0, 'gar1', 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toBe('No es tu turno')
  })

  it('rechaza garrison propia', () => {
    const state = makeStateWithGarrison()
    state.board['1,0'].garrisonToken!.owner = 'player1'
    const result = applyAttackGarrison(state, 'rx78', 0, 'gar1', 'player1')
    expect(result.success).toBe(false)
  })

  it('rechaza garrison fuera de rango', () => {
    const state = makeStateWithGarrison()
    state.board['1,0'].garrisonToken = null
    state.board['-2,0'] = {
      coord: { q: -2, r: 0 }, terrain: 'normal', elevation: 0,
      occupiedBy: null, upgradeToken: null, objectiveToken: null, deployZone: null,
      garrisonToken: { id: 'gar_far', owner: 'player2', hp: 1 },
    }
    // rx78 tiene rango 3, garrison a distancia 2 en (-2,0) sería ok, pero usamos un arma con rango 1
    state.units['rx78'].weapons[0].range = 1
    // garrison en (1,0) fue limpiada, ponemos la garrison en (2,0) que está a distancia 2 > rango 1
    state.board['2,0'].garrisonToken = { id: 'gar_far2', owner: 'player2', hp: 1 }
    const result = applyAttackGarrison(state, 'rx78', 0, 'gar_far2', 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('rango')
  })

  it('acepta ataque a garrison enemiga en rango', () => {
    const state = makeStateWithGarrison()
    const result = applyAttackGarrison(state, 'rx78', 0, 'gar1', 'player1')
    expect(result.success).toBe(true)
  })
})

// ─── PLAY_CARD ────────────────────────────────────────────────────────────────
describe('applyPlayCard', () => {
  function makeStateWithCard(): GameState {
    const state = makeGameState()
    state.players['player1'].tactics.hand = [
      {
        id: 'card-aoe', name: 'Barrage Tático', type: 'command', faction: 'federation',
        effect: 'Daño 2 a enemigos en rango 3',
        effectData: { type: 'aoe_damage', range: 3, amount: 2 },
      },
      {
        id: 'card-destroy', name: 'Sabotaje', type: 'command', faction: 'federation',
        effect: 'Destruye upgrade y aplica slow',
        effectData: { type: 'destroy_upgrade_and_slow', range: 3 },
      },
      {
        id: 'card-rsp', name: 'Contraataque', type: 'response', faction: 'federation',
        effect: 'Respuesta al ser atacado',
        effectData: null,
      },
    ]
    return state
  }

  it('rechaza si no es tu turno', () => {
    const state = makeStateWithCard()
    const result = applyPlayCard(state, 'rx78', 'card-aoe', 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toBe('No es tu turno')
  })

  it('rechaza carta que no está en la mano', () => {
    const state = makeStateWithCard()
    const result = applyPlayCard(state, 'rx78', 'card-inexistente', 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('mano')
  })

  it('rechaza carta de respuesta durante tu turno', () => {
    const state = makeStateWithCard()
    const result = applyPlayCard(state, 'rx78', 'card-rsp', 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('comando')
  })

  it('rechaza carta sin effectData (no implementada)', () => {
    const state = makeStateWithCard()
    state.players['player1'].tactics.hand[0].effectData = null
    const result = applyPlayCard(state, 'rx78', 'card-aoe', 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('no está implementada')
  })

  it('acepta carta aoe sin objetivo', () => {
    const state = makeStateWithCard()
    const result = applyPlayCard(state, 'rx78', 'card-aoe', 'player1')
    expect(result.success).toBe(true)
  })

  it('rechaza carta que necesita objetivo sin targetId', () => {
    const state = makeStateWithCard()
    const result = applyPlayCard(state, 'rx78', 'card-destroy', 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('objetivo')
  })

  it('acepta carta que necesita objetivo con targetId', () => {
    const state = makeStateWithCard()
    const result = applyPlayCard(state, 'rx78', 'card-destroy', 'player1', 'zaku2')
    expect(result.success).toBe(true)
  })
})

// ─── VICTORY ──────────────────────────────────────────────────────────────────
describe('checkGameOver', () => {
  it('no termina si ambos jugadores tienen unidades', () => {
    const state = makeGameState()
    expect(checkGameOver(state).isOver).toBe(false)
  })

  it('gana player1 si player2 no tiene unidades vivas', () => {
    const state = makeGameState()
    state.units['zaku2'].currentHp = 0
    const result = checkGameOver(state)
    expect(result.isOver).toBe(true)
    expect(result.winner).toBe('player1')
  })

  it('gana player2 si player1 no tiene unidades vivas', () => {
    const state = makeGameState()
    state.units['rx78'].currentHp = 0
    const result = checkGameOver(state)
    expect(result.isOver).toBe(true)
    expect(result.winner).toBe('player2')
  })

  it('empate si ambos sin unidades', () => {
    const state = makeGameState()
    state.units['rx78'].currentHp  = 0
    state.units['zaku2'].currentHp = 0
    const result = checkGameOver(state)
    expect(result.isOver).toBe(true)
    expect(result.winner).toBeNull()
  })

  it('gana por VP al acabar fase 2', () => {
    const state = makeGameState()
    state.phase = 'phase2'
    state.players.player1.vp = 6
    state.players.player2.vp = 3
    // Vaciar el timeline para simular fin de fase
    state.timeline = createEmptyTimeline()
    const result = checkGameOver(state)
    expect(result.isOver).toBe(true)
    expect(result.winner).toBe('player1')
  })

  it('empate por VP al acabar fase 2', () => {
    const state = makeGameState()
    state.phase = 'phase2'
    state.players.player1.vp = 5
    state.players.player2.vp = 5
    state.timeline = createEmptyTimeline()
    const result = checkGameOver(state)
    expect(result.isOver).toBe(true)
    expect(result.winner).toBeNull()
  })
})

describe('resolveObjectiveControl', () => {
  it('player1 controla objetivo si tiene más unidades adyacentes', () => {
    const state = makeGameState()

    // Añadir objetivo en hex (1,0)
    state.board['1,0'] = {
      coord: { q: 1, r: 0 }, terrain: 'normal', elevation: 0,
      occupiedBy: null,
      upgradeToken: null, garrisonToken: null,
      objectiveToken: { id: 'obj1', vpValue: 2, controlledBy: null }
    }

    // rx78 está en (0,0) — adyacente a (1,0)
    // zaku2 está en (2,0) — también adyacente a (1,0)
    // Empate → nadie controla

    const { results } = resolveObjectiveControl(state)
    expect(results[0].controlledBy).toBeNull()
  })

  it('player1 controla si tiene más unidades', () => {
    const state = makeGameState()

    // Objetivo en (0,1)
    state.board['0,1'] = {
      coord: { q: 0, r: 1 }, terrain: 'normal', elevation: 0,
      occupiedBy: null,
      upgradeToken: null, garrisonToken: null,
      objectiveToken: { id: 'obj2', vpValue: 3, controlledBy: null }
    }

    // rx78 en (0,0) → adyacente a (0,1) ✓
    // zaku2 en (2,0) → NO adyacente a (0,1)
    const { results } = resolveObjectiveControl(state)
    expect(results[0].controlledBy).toBe('player1')
  })
})

describe('transitionToPhase2', () => {
  it('cambia la fase a phase2', () => {
    const state = makeGameState()
    const newState = transitionToPhase2(state)
    expect(newState.phase).toBe('phase2')
  })

  it('preserva los tokens del timeline sin resetear', () => {
    const state = makeGameState()
    // El timeline fluye continuo — los tokens se mantienen donde están
    const newState = transitionToPhase2(state)
    expect(getUnitRound(newState.timeline, 'rx78')).toBe(2)
    expect(getUnitRound(newState.timeline, 'zaku2')).toBe(4)
  })
})

describe('awardObjectiveVP', () => {
  it('otorga VP al jugador que controla el objetivo', () => {
    const state = makeGameState()

    state.board['0,1'] = {
      coord: { q: 0, r: 1 }, terrain: 'normal', elevation: 0,
      occupiedBy: null, upgradeToken: null, garrisonToken: null,
      objectiveToken: { id: 'obj1', vpValue: 3, controlledBy: 'player1' }
    }

    const { newState, vpAwarded } = awardObjectiveVP(state)
    expect(vpAwarded.player1).toBe(3)
    expect(vpAwarded.player2).toBe(0)
    expect(newState.players.player1.vp).toBe(3)
  })
})

// ─── RSP: PASS_RESPONSE ───────────────────────────────────────────────────────
describe('applyPassResponse', () => {
  it('limpia pendingResponse', () => {
    const state = makeGameState()
    state.pendingResponse = {
      trigger: 'after_combat_damage',
      forPlayerId: 'player1',
      attackerUnitId: 'zaku2',
      defenderUnitId: 'rx78',
    }
    const result = applyPassResponse(state, 'player1')
    expect(result.success).toBe(true)
    expect(result.newState!.pendingResponse).toBeNull()
  })

  it('rechaza si no hay ventana de respuesta', () => {
    const state = makeGameState()
    const result = applyPassResponse(state, 'player1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('ventana')
  })

  it('rechaza si la ventana es para el otro jugador', () => {
    const state = makeGameState()
    state.pendingResponse = {
      trigger: 'after_combat_damage',
      forPlayerId: 'player2',
      attackerUnitId: 'rx78',
      defenderUnitId: 'zaku2',
    }
    const result = applyPassResponse(state, 'player1')
    expect(result.success).toBe(false)
  })
})

// ─── RSP: PLAY_RESPONSE ───────────────────────────────────────────────────────
describe('applyPlayResponse', () => {
  function makeStateWithRspWindow(): GameState {
    const state = makeGameState()
    state.pendingResponse = {
      trigger: 'after_combat_damage',
      forPlayerId: 'player2',
      attackerUnitId: 'rx78',
      defenderUnitId: 'zaku2',
    }
    state.players['player2'].tactics.hand = [{
      id: 'shield-rsp',
      name: 'Earth Federation Shield',
      type: 'response',
      faction: 'Earth Federation',
      effect: 'An allied unit is dealt -2 Damage',
      effectData: { type: 'reduce_incoming_damage', amount: 2, trigger: 'after_combat_damage' },
    }]
    return state
  }

  it('acepta carta RSP con trigger correcto', () => {
    const state = makeStateWithRspWindow()
    const result = applyPlayResponse(state, 'shield-rsp', 'player2')
    expect(result.success).toBe(true)
    expect(result.newState!.pendingResponse).toBeNull()
  })

  it('mueve la carta a descartadas y la quita de la mano', () => {
    const state = makeStateWithRspWindow()
    const result = applyPlayResponse(state, 'shield-rsp', 'player2')
    expect(result.newState!.players['player2'].tactics.hand).toHaveLength(0)
    expect(result.newState!.players['player2'].tactics.discarded).toHaveLength(1)
  })

  it('rechaza si no hay ventana de respuesta', () => {
    const state = makeGameState()
    state.players['player2'].tactics.hand = [{
      id: 'shield-rsp', name: 'Shield', type: 'response', faction: 'EF',
      effect: '...', effectData: { type: 'reduce_incoming_damage', amount: 2, trigger: 'after_combat_damage' },
    }]
    const result = applyPlayResponse(state, 'shield-rsp', 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toContain('ventana')
  })

  it('rechaza si la ventana es para el otro jugador', () => {
    const state = makeStateWithRspWindow()
    const result = applyPlayResponse(state, 'shield-rsp', 'player1')
    expect(result.success).toBe(false)
  })

  it('rechaza carta que no está en la mano', () => {
    const state = makeStateWithRspWindow()
    const result = applyPlayResponse(state, 'carta-inexistente', 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toContain('mano')
  })

  it('rechaza carta RSP con trigger distinto al de la ventana', () => {
    const state = makeStateWithRspWindow()
    state.players['player2'].tactics.hand[0].effectData = {
      type: 'gain_upgrade_after_rescue', upgradeType: 'shield', trigger: 'after_rescue',
    }
    const result = applyPlayResponse(state, 'shield-rsp', 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toContain('trigger')
  })

  it('rechaza carta CMD en ventana de respuesta', () => {
    const state = makeStateWithRspWindow()
    state.players['player2'].tactics.hand[0].type = 'command' as const
    const result = applyPlayResponse(state, 'shield-rsp', 'player2')
    expect(result.success).toBe(false)
    expect(result.error).toContain('RSP')
  })
})

// ─── RSP: apertura de ventana tras ATTACK ─────────────────────────────────────
describe('pendingResponse tras applyAttack', () => {
  it('abre ventana de respuesta si el defensor tiene carta after_combat_damage', () => {
    const state = makeGameState()
    state.players['player2'].tactics.hand = [{
      id: 'shield-rsp', name: 'Shield', type: 'response', faction: 'EF',
      effect: '...', effectData: { type: 'reduce_incoming_damage', amount: 2, trigger: 'after_combat_damage' },
    }]
    const result = applyAttack(state, 'rx78', 0, 'zaku2', 'player1', [6, 7, 8])
    expect(result.success).toBe(true)
    expect(result.newState!.pendingResponse).not.toBeNull()
    expect(result.newState!.pendingResponse!.trigger).toBe('after_combat_damage')
    expect(result.newState!.pendingResponse!.forPlayerId).toBe('player2')
  })

  it('NO abre ventana si el defensor no tiene cartas RSP', () => {
    const state = makeGameState()
    const result = applyAttack(state, 'rx78', 0, 'zaku2', 'player1', [6, 7, 8])
    expect(result.success).toBe(true)
    expect(result.newState!.pendingResponse).toBeNull()
  })

  it('NO abre ventana si el objetivo murió', () => {
    const state = makeGameState()
    state.units['zaku2'].currentHp = 1
    state.players['player2'].tactics.hand = [{
      id: 'shield-rsp', name: 'Shield', type: 'response', faction: 'EF',
      effect: '...', effectData: { type: 'reduce_incoming_damage', amount: 2, trigger: 'after_combat_damage' },
    }]
    const result = applyAttack(state, 'rx78', 0, 'zaku2', 'player1', [6, 7, 8])
    expect(result.success).toBe(true)
    expect(result.newState!.units['zaku2'].position).toBeNull()  // murió
    expect(result.newState!.pendingResponse).toBeNull()
  })
})