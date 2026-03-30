import { useState, useCallback, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { GameScene } from './three/GameScene'
import type { GameState } from './types'
import { hexKey, getReachableHexes, hexDistance, gridDistance } from './game/hexGrid'
import { useGameData } from './game/useGameData'

const socket: Socket = io('http://localhost:3001')

type SelectionMode = 'none' | 'moving' | 'attacking' | 'dashing'
type AppScreen = 'lobby' | 'waiting' | 'playing'

const btnStyle = (bg: string, border?: string) => ({
  padding: '6px 12px',
  background: bg,
  color: 'white',
  border: border ?? 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap' as const,
})

export default function App() {
  const gameData = useGameData()

  const [screen, setScreen] = useState<AppScreen>('lobby')
  const [playerName, setPlayerName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [roomInput, setRoomInput] = useState('')
  const [myPlayerId, setMyPlayerId] = useState<'player1' | 'player2' | null>(null)
  const [connected, setConnected] = useState(false)
  const [lobbyError, setLobbyError] = useState('')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  const [reachableHexes, setReachableHexes] = useState<Set<string>>(new Set())
  const [attackableHexes, setAttackableHexes] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [diceResult, setDiceResult] = useState<number[] | null>(null)
  const [hasMoved, setHasMoved] = useState(false)
  const [hasUsedPrimary, setHasUsedPrimary] = useState(false)
  const [selectedWeaponIndex, setSelectedWeaponIndex] = useState<number | null>(null)

  // ─── SOCKET EVENTS ────────────────────────────────────────────────────────
  useEffect(() => {
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('ROOM_CREATED', ({ roomId, playerId }: { roomId: string; playerId: 'player1' | 'player2' }) => {
      setRoomId(roomId)
      setMyPlayerId(playerId)
      setScreen('waiting')
    })

    socket.on('JOIN_ERROR', ({ message }: { message: string }) => {
      setLobbyError(message)
    })

    socket.on('GAME_STARTED', ({ gameState, playerId }: { gameState: GameState; playerId: 'player1' | 'player2' }) => {
      setGameState(gameState)
      setMyPlayerId(playerId)
      setScreen('playing')
      setMessage('¡Partida iniciada!')
    })

    socket.on('GAME_STATE_UPDATE', ({ gameState: newState, diceRolls }: {
      gameState: GameState
      diceRolls?: number[]
    }) => {
      setGameState(newState)
      if (diceRolls) setDiceResult(diceRolls)
      setSelectedUnitId(prev => {
        if (newState.activeUnitId !== prev) {
          setHasMoved(false)
          setHasUsedPrimary(false)
          setReachableHexes(new Set())
          setAttackableHexes(new Set())
          setSelectionMode('none')
          setSelectedWeaponIndex(null)
          return null
        }
        return prev
      })
    })

    socket.on('GAME_OVER', ({ gameState, winner, reason }: { gameState: GameState; winner: string | null; reason: string }) => {
      setGameState(gameState)
      setMessage(winner
        ? `¡Gana ${gameState.players[winner as 'player1' | 'player2'].name}! — ${reason}`
        : `Empate — ${reason}`
      )
      clearSelection()
    })

    socket.on('ACTION_ERROR', ({ message }: { message: string }) => {
      setMessage(`Error: ${message}`)
    })

    socket.on('OPPONENT_DISCONNECTED', ({ message }: { message: string }) => {
      setMessage(message)
    })

    return () => {
      socket.off('connect')
      socket.off('disconnect')
      socket.off('ROOM_CREATED')
      socket.off('JOIN_ERROR')
      socket.off('GAME_STARTED')
      socket.off('GAME_STATE_UPDATE')
      socket.off('GAME_OVER')
      socket.off('ACTION_ERROR')
      socket.off('OPPONENT_DISCONNECTED')
    }
  }, [])

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  const clearSelection = useCallback(() => {
    setSelectedUnitId(null)
    setSelectionMode('none')
    setReachableHexes(new Set())
    setAttackableHexes(new Set())
    setDiceResult(null)
    setHasMoved(false)
    setHasUsedPrimary(false)
    setSelectedWeaponIndex(null)
  }, [])

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

  const calcAttackable = useCallback((unitId: string, state: GameState, weaponIndex: number = 0) => {
    const unit = state.units[unitId]
    if (!unit?.position) return new Set<string>()
    const weapon = unit.weapons[weaponIndex]
    if (!weapon) return new Set<string>()
    const attackable = new Set<string>()
    for (const other of Object.values(state.units)) {
      if (other.playerId === unit.playerId) continue
      if (other.currentHp <= 0 || !other.position) continue
      const dist = gridDistance(unit.position, other.position)
      if (dist <= weapon.range) attackable.add(hexKey(other.position))
    }
    return attackable
  }, [])

  // ─── ACCIONES ─────────────────────────────────────────────────────────────
  const handleUnitClick = useCallback((unitId: string) => {
    if (!gameState || !myPlayerId) return
    const unit = gameState.units[unitId]
    if (!unit) return

    // Atacar unidad enemiga
    if (selectionMode === 'attacking' && selectedUnitId && unit.playerId !== myPlayerId) {
      const wIdx = selectedWeaponIndex ?? 0
      socket.emit('GAME_ACTION', {
        action: { type: 'ATTACK', unitId: selectedUnitId, weaponIndex: wIdx, targetId: unitId }
      })
      setHasUsedPrimary(true)
      clearSelection()
      return
    }

    if (unit.playerId !== myPlayerId) { setMessage('Esa unidad no es tuya'); return }
    if (gameState.activePlayerId !== myPlayerId) { setMessage('No es tu turno'); return }
    if (unitId !== gameState.activeUnitId) { setMessage('Esta unidad no puede actuar ahora'); return }

    setSelectedUnitId(unitId)
    setSelectionMode('none')
    setReachableHexes(hasMoved ? new Set() : calcReachable(unitId, gameState))
    setAttackableHexes(new Set())
    setSelectedWeaponIndex(null)
    setMessage(`${unit.name} seleccionado`)
  }, [gameState, myPlayerId, selectionMode, selectedUnitId, selectedWeaponIndex, hasMoved, calcReachable, clearSelection])

  const handleHexClick = useCallback((key: string) => {
    if (!gameState || !selectedUnitId) return
    if (!reachableHexes.has(key)) return
    const [q, r] = key.split(',').map(Number)

    if (selectionMode === 'moving') {
      socket.emit('GAME_ACTION', {
        action: { type: 'ADVANCE', unitId: selectedUnitId, to: { q, r } }
      })
      setHasMoved(true)
      const newAttackable = calcAttackable(selectedUnitId, gameState, selectedWeaponIndex ?? 0)
      setAttackableHexes(newAttackable)
      setReachableHexes(new Set())
      setSelectionMode('none')
      setMessage(newAttackable.size > 0 ? 'Puedes atacar u otras acciones' : 'Pasa turno')
    }

    if (selectionMode === 'dashing') {
      socket.emit('GAME_ACTION', {
        action: { type: 'DASH', unitId: selectedUnitId, to: { q, r } }
      })
      setHasUsedPrimary(true)
      setReachableHexes(new Set())
      setSelectionMode('none')
      setMessage('Dash realizado')
    }
  }, [gameState, selectedUnitId, selectionMode, reachableHexes, selectedWeaponIndex, calcAttackable])

  const handleAttackMode = useCallback((weaponIndex: number) => {
    if (!gameState || !selectedUnitId) return
    const attackable = calcAttackable(selectedUnitId, gameState, weaponIndex)
    if (attackable.size === 0) { setMessage('No hay enemigos en rango'); return }
    setSelectedWeaponIndex(weaponIndex)
    setSelectionMode('attacking')
    setAttackableHexes(attackable)
    setReachableHexes(new Set())
    const weapon = gameState.units[selectedUnitId]?.weapons[weaponIndex]
    setMessage(`${weapon?.name} — Selecciona un enemigo (rango ${weapon?.range})`)
  }, [gameState, selectedUnitId, calcAttackable])

  const handleEndTurn = useCallback(() => {
    if (!selectedUnitId) return
    socket.emit('GAME_ACTION', {
      action: { type: 'END_ACTIVATION', unitId: selectedUnitId }
    })
    clearSelection()
  }, [selectedUnitId, clearSelection])

  // ─── LOADING ──────────────────────────────────────────────────────────────
  if (!gameData.loaded) return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0d0d1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: '#4fc3f7', marginBottom: 8 }}>GUNDAM ASSEMBLE</div>
        <div style={{ color: '#666' }}>Cargando datos...</div>
      </div>
    </div>
  )

  if (gameData.error) return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0d0d1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef5350'
    }}>
      Error cargando datos: {gameData.error}
    </div>
  )

  // ─── LOBBY ────────────────────────────────────────────────────────────────
  if (screen === 'lobby') return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0d0d1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a2e', border: '1px solid #333', borderRadius: 12,
        padding: '40px 48px', minWidth: 340, color: 'white', textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 8, color: '#4fc3f7' }}>
          GUNDAM ASSEMBLE
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 32 }}>
          {connected ? '🟢 Conectado' : '🔴 Desconectado'}
        </div>
        <input
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          placeholder="Tu nombre"
          style={{
            width: '100%', padding: '10px 14px', marginBottom: 16,
            background: '#0d0d1a', border: '1px solid #444', borderRadius: 8,
            color: 'white', fontSize: 14, boxSizing: 'border-box',
          }}
        />
        <button
          onClick={() => { if (playerName.trim()) socket.emit('CREATE_ROOM', { playerName: playerName.trim() }) }}
          style={{
            width: '100%', padding: '12px', marginBottom: 16,
            background: '#1565c0', color: 'white', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 'bold',
          }}
        >
          Crear sala
        </button>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={roomInput}
            onChange={e => setRoomInput(e.target.value.toUpperCase())}
            placeholder="Código de sala"
            style={{
              flex: 1, padding: '10px 14px',
              background: '#0d0d1a', border: '1px solid #444', borderRadius: 8,
              color: 'white', fontSize: 14,
            }}
          />
          <button
            onClick={() => {
              if (playerName.trim() && roomInput.trim()) {
                setLobbyError('')
                socket.emit('JOIN_ROOM', { roomId: roomInput.trim(), playerName: playerName.trim() })
              }
            }}
            style={{
              padding: '10px 20px', background: '#2e7d32', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
            }}
          >
            Unirse
          </button>
        </div>
        {lobbyError && (
          <div style={{ color: '#ef5350', fontSize: 13, marginTop: 8 }}>{lobbyError}</div>
        )}
      </div>
    </div>
  )

  // ─── ESPERANDO ────────────────────────────────────────────────────────────
  if (screen === 'waiting') return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0d0d1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, marginBottom: 16 }}>Sala creada</div>
        <div style={{ fontSize: 36, fontWeight: 'bold', color: '#f5c518', marginBottom: 16, letterSpacing: 8 }}>
          {roomId}
        </div>
        <div style={{ color: '#aaa', marginBottom: 8 }}>Comparte este código con tu oponente</div>
        <div style={{ color: '#666', fontSize: 13 }}>Esperando jugador 2...</div>
      </div>
    </div>
  )

  // ─── PARTIDA ──────────────────────────────────────────────────────────────
  if (!gameState) return null

  const activeUnit = gameState.activeUnitId ? gameState.units[gameState.activeUnitId] : null
  const activePlayer = gameState.players[gameState.activePlayerId]
  const isMyTurn = gameState.activePlayerId === myPlayerId
  const isFinished = gameState.phase === 'finished'
  const selectedUnit = selectedUnitId ? gameState.units[selectedUnitId] : null

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a2e', display: 'flex', flexDirection: 'column' }}>

      {/* HUD superior */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 16px', background: 'rgba(0,0,0,0.8)', color: 'white',
        fontSize: 14, zIndex: 10, gap: 16, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: '#4fc3f7', fontWeight: 'bold' }}>
            {gameState.players.player1.name}
            {myPlayerId === 'player1' && <span style={{ color: '#666', fontSize: 11 }}> (tú)</span>}
          </span>
          <span style={{ color: '#f5c518' }}>{gameState.players.player1.vp} VP</span>
          {Object.values(gameState.units).filter(u => u.playerId === 'player1').map(u => (
            <span key={u.id} style={{ fontSize: 12, color: u.currentHp > 0 ? '#aaa' : '#555' }}>
              {u.name} — HP {u.currentHp}/{u.maxHp}
            </span>
          ))}
        </div>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ color: isMyTurn ? '#4caf50' : '#ef9a9a', fontSize: 12, marginBottom: 2 }}>
            {isFinished ? '— FIN —' : isMyTurn ? '⚡ Tu turno' : `Turno de ${activePlayer.name}`}
          </div>
          {activeUnit && !isFinished && (
            <div style={{ color: activeUnit.playerId === 'player1' ? '#4fc3f7' : '#ef9a9a', fontWeight: 'bold' }}>
              {activeUnit.name}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#f5c518', marginTop: 4 }}>{message}</div>
          {diceResult && (
            <div style={{ fontSize: 12, color: '#aaa' }}>
              Dados: [{diceResult.join(', ')}] — {diceResult.filter(r => r >= 4).length} impactos
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ color: '#ef9a9a', fontWeight: 'bold' }}>
            {gameState.players.player2.name}
            {myPlayerId === 'player2' && <span style={{ color: '#666', fontSize: 11 }}> (tú)</span>}
          </span>
          <span style={{ color: '#f5c518' }}>{gameState.players.player2.vp} VP</span>
          {Object.values(gameState.units).filter(u => u.playerId === 'player2').map(u => (
            <span key={u.id} style={{ fontSize: 12, color: u.currentHp > 0 ? '#aaa' : '#555' }}>
              {u.name} — HP {u.currentHp}/{u.maxHp}
            </span>
          ))}
        </div>
      </div>

      {/* Canvas 3D */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <GameScene
          gameState={gameState}
          selectedUnitId={selectedUnitId}
          reachableHexes={reachableHexes}
          attackableHexes={attackableHexes}
          onHexClick={handleHexClick}
          onUnitClick={handleUnitClick}
        />
      </div>

      {/* HUD inferior */}
      {!isFinished && isMyTurn && selectedUnitId && selectedUnit && (
        <div style={{
          padding: '8px 16px', background: 'rgba(0,0,0,0.9)', color: 'white',
          fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
          zIndex: 10, flexWrap: 'wrap', borderTop: '1px solid #333', flexShrink: 0,
        }}>
          {/* Info unidad */}
          <span style={{ fontWeight: 'bold', color: '#4fc3f7', marginRight: 4 }}>{selectedUnit.name}</span>
          <span style={{ color: '#aaa' }}>HP {selectedUnit.currentHp}/{selectedUnit.maxHp}</span>
          <span style={{ color: '#aaa' }}>⚡ {selectedUnit.energy}</span>
          <span style={{
            color: hasMoved ? '#555' : '#4caf50', fontSize: 11,
            border: `1px solid ${hasMoved ? '#333' : '#4caf50'}`,
            borderRadius: 4, padding: '2px 6px',
          }}>
            {hasMoved ? 'Movido' : 'Puede mover'}
          </span>
          <span style={{
            color: hasUsedPrimary ? '#555' : '#f5c518', fontSize: 11,
            border: `1px solid ${hasUsedPrimary ? '#333' : '#f5c518'}`,
            borderRadius: 4, padding: '2px 6px',
          }}>
            {hasUsedPrimary ? 'Acción usada' : 'Acción disponible'}
          </span>

          <div style={{ flex: 1 }} />

          {/* Mover */}
          {!hasMoved && (
            <button onClick={() => {
              setSelectionMode('moving')
              setReachableHexes(calcReachable(selectedUnitId, gameState))
              setAttackableHexes(new Set())
              setMessage('Elige hex para mover')
            }} style={btnStyle('#1565c0')}>🚶 Mover</button>
          )}

          {/* Dash */}
          {!hasUsedPrimary && (
            <button onClick={() => {
              setSelectionMode('dashing')
              const unit = gameState.units[selectedUnitId]
              if (!unit.position) return
              const obstacles = new Set(
                Object.values(gameState.units)
                  .filter(u2 => u2.id !== selectedUnitId && u2.currentHp > 0 && u2.position && u2.playerId !== unit.playerId)
                  .map(u2 => hexKey(u2.position!))
              )
              const reachable = getReachableHexes(unit.position, gameState.board, obstacles, 2)
              setReachableHexes(new Set(reachable.map(h => hexKey(h))))
              setAttackableHexes(new Set())
              setMessage('Dash: elige hex (2 hexes, cuesta 2 TL)')
            }} style={btnStyle('#6a1b9a')}>💨 Dash</button>
          )}

          {/* Armas — un botón por arma */}
          {!hasUsedPrimary && selectedUnit.weapons.map((weapon, idx) => (
            <button
              key={idx}
              onClick={() => handleAttackMode(idx)}
              style={btnStyle(
                selectedWeaponIndex === idx ? '#b71c1c' : '#c62828',
                selectedWeaponIndex === idx ? '2px solid #ff5252' : undefined
              )}
            >
              ⚔ {weapon.name} (R{weapon.range} S{weapon.strength} TL{weapon.tlCost})
            </button>
          ))}

          {/* Energize */}
          {!hasUsedPrimary && (
            <button onClick={() => {
              socket.emit('GAME_ACTION', {
                action: { type: 'ENERGIZE', unitId: selectedUnitId }
              })
              setHasUsedPrimary(true)
              setMessage('Energize: +1 energía, -2 TL')
            }} style={btnStyle('#e65100')}>⚡ Energize</button>
          )}

          {/* Pasar turno */}
          <button onClick={handleEndTurn} style={btnStyle('#333', '1px solid #555')}>Pasar →</button>

          {/* Cancelar */}
          <button onClick={clearSelection} style={btnStyle('transparent', '1px solid #444')}>✕</button>
        </div>
      )}

      {/* Fin de partida */}
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
              onClick={() => { setScreen('lobby'); setGameState(null); setMyPlayerId(null) }}
              style={{
                padding: '10px 28px', background: '#1565c0', color: 'white',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15,
              }}
            >
              Volver al lobby
            </button>
          </div>
        </div>
      )}
    </div>
  )
}