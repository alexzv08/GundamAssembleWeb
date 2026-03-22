import { useState, useCallback } from 'react'
import { GameScene } from './three/GameScene'
import { createTestGame } from './game/createTestGame'
import type { GameState } from './types'
import { hexKey, getReachableHexes, hexDistance } from './game/hexGrid'
import { applyAction } from './game/actions'
import { checkGameOver } from './game/victory'

// Modo de selección actual
type SelectionMode = 'none' | 'moving' | 'attacking'

export default function App() {
  const [gameState, setGameState]         = useState<GameState>(createTestGame)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  const [reachableHexes, setReachableHexes] = useState<Set<string>>(new Set())
  const [attackableHexes, setAttackableHexes] = useState<Set<string>>(new Set())
  const [message, setMessage]             = useState<string>('Selecciona una unidad azul')
  const [diceResult, setDiceResult]       = useState<number[] | null>(null)

  // Limpiar selección
  const clearSelection = useCallback(() => {
    setSelectedUnitId(null)
    setSelectionMode('none')
    setReachableHexes(new Set())
    setAttackableHexes(new Set())
    setDiceResult(null)
  }, [])

  // Calcular hexes de movimiento para una unidad
  const calcReachable = useCallback((unitId: string, state: GameState) => {
    const unit = state.units[unitId]
    if (!unit?.position) return new Set<string>()
    const obstacles = new Set(
      Object.values(state.units)
        .filter(u => u.id !== unitId && u.currentHp > 0 && u.position && u.playerId !== unit.playerId)
        .map(u => hexKey(u.position!))
    )
    const reachable = getReachableHexes(unit.position, state.board, obstacles, 3)
    return new Set(reachable.map(h => hexKey(h)))
  }, [])

  // Calcular hexes atacables para una unidad
  const calcAttackable = useCallback((unitId: string, state: GameState) => {
    const unit = state.units[unitId]
    if (!unit?.position) return new Set<string>()
    const weapon = unit.weapons[0]
    const attackable = new Set<string>()
    for (const other of Object.values(state.units)) {
      if (other.playerId === unit.playerId) continue
      if (other.currentHp <= 0 || !other.position) continue
      const dist = hexDistance(unit.position, other.position)
      if (dist <= weapon.range) attackable.add(hexKey(other.position))
    }
    return attackable
  }, [])

  // Click en unidad
  const handleUnitClick = useCallback((unitId: string) => {
    const unit = gameState.units[unitId]
    if (!unit) return

    // Click en unidad enemiga mientras atacamos
    if (selectionMode === 'attacking' && selectedUnitId && unit.playerId !== gameState.activePlayerId) {
      const rolls = Array.from({ length: gameState.units[selectedUnitId].weapons[0].strength },
        () => Math.floor(Math.random() * 10) + 1
      )
      setDiceResult(rolls)

      const result = applyAction(
        gameState,
        { type: 'ATTACK', unitId: selectedUnitId, weaponIndex: 0, targetId: unitId },
        gameState.activePlayerId,
        rolls
      )

      if (result.success && result.newState) {
        const gameOver = checkGameOver(result.newState)
        if (gameOver.isOver) {
          setGameState({ ...result.newState, phase: 'finished', winner: gameOver.winner })
          setMessage(gameOver.winner
            ? `¡Gana ${result.newState.players[gameOver.winner].name}! — ${gameOver.reason}`
            : `¡Empate! — ${gameOver.reason}`
          )
        } else {
          setGameState(result.newState)
          const hits = rolls.filter(r => r >= 4).length
          setMessage(`Ataque: [${rolls.join(', ')}] → ${hits} impactos`)
        }
        clearSelection()
      } else {
        setMessage(result.error ?? 'Ataque no válido')
      }
      return
    }

    // Click en unidad propia activa
    if (unit.playerId !== gameState.activePlayerId) {
      setMessage('No es tu turno')
      return
    }
    if (unitId !== gameState.activeUnitId) {
      setMessage('Esta unidad no puede actuar ahora')
      return
    }

    setSelectedUnitId(unitId)
    setSelectionMode('moving')
    setReachableHexes(calcReachable(unitId, gameState))
    setAttackableHexes(new Set())
    setMessage(`${unit.name} seleccionado — elige hex para mover o pulsa Atacar`)
  }, [gameState, selectionMode, selectedUnitId, calcReachable, clearSelection])

  // Click en hex
  const handleHexClick = useCallback((key: string) => {
    if (!selectedUnitId || selectionMode !== 'moving') return
    if (!reachableHexes.has(key)) return

    const [q, r] = key.split(',').map(Number)
    const result = applyAction(
      gameState,
      { type: 'ADVANCE', unitId: selectedUnitId, to: { q, r } },
      gameState.activePlayerId
    )

    if (result.success && result.newState) {
      setGameState(result.newState)
      // Tras mover, recalcular atacables desde nueva posición
      const newAttackable = calcAttackable(selectedUnitId, result.newState)
      setAttackableHexes(newAttackable)
      setReachableHexes(new Set())
      setSelectionMode('none')
      setMessage(`Movido — ${newAttackable.size > 0 ? 'puedes atacar o pasar turno' : 'pasa turno'}`)
    }
  }, [selectedUnitId, selectionMode, reachableHexes, gameState, calcAttackable])

  // Botón atacar
  const handleAttackMode = useCallback(() => {
    if (!selectedUnitId) return
    const attackable = calcAttackable(selectedUnitId, gameState)
    if (attackable.size === 0) {
      setMessage('No hay enemigos en rango')
      return
    }
    setSelectionMode('attacking')
    setAttackableHexes(attackable)
    setReachableHexes(new Set())
    setMessage('Selecciona un enemigo para atacar')
  }, [selectedUnitId, gameState, calcAttackable])

  // Botón pasar turno
  const handleEndTurn = useCallback(() => {
    if (!selectedUnitId) return
    const result = applyAction(
      gameState,
      { type: 'END_ACTIVATION', unitId: selectedUnitId },
      gameState.activePlayerId
    )
    if (result.success && result.newState) {
      setGameState(result.newState)
      const next = result.newState.activeUnitId
        ? result.newState.units[result.newState.activeUnitId]
        : null
      setMessage(next
        ? `Turno de ${result.newState.players[result.newState.activePlayerId].name} — ${next.name}`
        : 'Fin de fase'
      )
    }
    clearSelection()
  }, [selectedUnitId, gameState, clearSelection])

  const activeUnit  = gameState.activeUnitId ? gameState.units[gameState.activeUnitId] : null
  const activePlayer = gameState.players[gameState.activePlayerId]
  const isFinished  = gameState.phase === 'finished'

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a2e', display: 'flex', flexDirection: 'column' }}>

      {/* HUD superior */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 16px', background: 'rgba(0,0,0,0.8)', color: 'white',
        fontSize: 14, zIndex: 10, gap: 16,
      }}>
        {/* Player 1 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: '#4fc3f7', fontWeight: 'bold' }}>
            {gameState.players.player1.name}
          </span>
          <span style={{ color: '#f5c518' }}>
            {gameState.players.player1.vp} VP
          </span>
          {Object.values(gameState.units)
            .filter(u => u.playerId === 'player1')
            .map(u => (
              <span key={u.id} style={{ fontSize: 12, color: u.currentHp > 0 ? '#aaa' : '#555' }}>
                {u.name} — HP {u.currentHp}/{u.maxHp}
              </span>
            ))}
        </div>

        {/* Centro */}
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ color: '#aaa', fontSize: 11, marginBottom: 2 }}>
            {isFinished ? '— FIN DE PARTIDA —' : `Turno de ${activePlayer.name}`}
          </div>
          {activeUnit && !isFinished && (
            <div style={{ color: activeUnit.playerId === 'player1' ? '#4fc3f7' : '#ef9a9a', fontWeight: 'bold' }}>
              {activeUnit.name}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#f5c518', marginTop: 4 }}>
            {message}
          </div>
          {diceResult && (
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
              Dados: [{diceResult.join(', ')}]
            </div>
          )}
        </div>

        {/* Player 2 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ color: '#ef9a9a', fontWeight: 'bold' }}>
            {gameState.players.player2.name}
          </span>
          <span style={{ color: '#f5c518' }}>
            {gameState.players.player2.vp} VP
          </span>
          {Object.values(gameState.units)
            .filter(u => u.playerId === 'player2')
            .map(u => (
              <span key={u.id} style={{ fontSize: 12, color: u.currentHp > 0 ? '#aaa' : '#555' }}>
                {u.name} — HP {u.currentHp}/{u.maxHp}
              </span>
            ))}
        </div>
      </div>

      {/* Canvas 3D */}
      <div style={{ flex: 1 }}>
        <GameScene
          gameState={gameState}
          selectedUnitId={selectedUnitId}
          reachableHexes={reachableHexes}
          attackableHexes={attackableHexes}
          onHexClick={handleHexClick}
          onUnitClick={handleUnitClick}
        />
      </div>

      {/* HUD inferior — acciones */}
      {!isFinished && selectedUnitId && (
        <div style={{
          padding: '8px 16px', background: 'rgba(0,0,0,0.85)', color: 'white',
          fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', zIndex: 10,
        }}>
          {(() => {
            const u = gameState.units[selectedUnitId]
            return (
              <>
                <span style={{ fontWeight: 'bold', color: '#4fc3f7' }}>{u.name}</span>
                <span style={{ color: '#aaa' }}>HP {u.currentHp}/{u.maxHp}</span>
                <span style={{ color: '#aaa' }}>Energía: {u.energy}</span>
                <div style={{ flex: 1 }} />
                <button
                  onClick={handleAttackMode}
                  style={{
                    padding: '6px 16px', background: '#c62828', color: 'white',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  }}
                >
                  ⚔ Atacar
                </button>
                <button
                  onClick={handleEndTurn}
                  style={{
                    padding: '6px 16px', background: '#333', color: 'white',
                    border: '1px solid #555', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  }}
                >
                  Pasar turno →
                </button>
                <button
                  onClick={clearSelection}
                  style={{
                    padding: '6px 12px', background: 'transparent', color: '#aaa',
                    border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  }}
                >
                  ✕
                </button>
              </>
            )
          })()}
        </div>
      )}

      {/* Pantalla de fin de partida */}
      {isFinished && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.75)', zIndex: 20,
        }}>
          <div style={{
            background: '#1a1a2e', border: '1px solid #444', borderRadius: 12,
            padding: '40px 60px', textAlign: 'center', color: 'white',
          }}>
            <div style={{ fontSize: 32, fontWeight: 'bold', marginBottom: 12 }}>
              {gameState.winner
                ? `🏆 ${gameState.players[gameState.winner].name} gana`
                : '🤝 Empate'}
            </div>
            <div style={{ color: '#aaa', marginBottom: 8 }}>
              {gameState.players.player1.name}: {gameState.players.player1.vp} VP
            </div>
            <div style={{ color: '#aaa', marginBottom: 24 }}>
              {gameState.players.player2.name}: {gameState.players.player2.vp} VP
            </div>
            <button
              onClick={() => { setGameState(createTestGame()); clearSelection(); setMessage('Selecciona una unidad azul') }}
              style={{
                padding: '10px 28px', background: '#1565c0', color: 'white',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15,
              }}
            >
              Nueva partida
            </button>
          </div>
        </div>
      )}
    </div>
  )
}