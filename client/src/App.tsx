import { useState, useCallback, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { GameScene } from './three/GameScene'
import type { GameState } from './types'
import { hexKey, getReachableHexes, hexDistance } from './game/hexGrid'

// ─── SOCKET ───────────────────────────────────────────────────────────────────
const socket: Socket = io('http://localhost:3001')

type SelectionMode = 'none' | 'moving' | 'attacking'
type AppScreen = 'lobby' | 'waiting' | 'playing'

export default function App() {
  // ── Pantalla actual ──────────────────────────────────────────────────────
  const [screen, setScreen] = useState<AppScreen>('lobby')
  const [playerName, setPlayerName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [roomInput, setRoomInput] = useState('')
  const [myPlayerId, setMyPlayerId] = useState<'player1' | 'player2' | null>(null)
  const [connected, setConnected] = useState(false)
  const [lobbyError, setLobbyError] = useState('')

  // ── Estado de juego ──────────────────────────────────────────────────────
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  const [reachableHexes, setReachableHexes] = useState<Set<string>>(new Set())
  const [attackableHexes, setAttackableHexes] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [diceResult, setDiceResult] = useState<number[] | null>(null)

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

    socket.on('GAME_STATE_UPDATE', ({ gameState, diceRolls }: { gameState: GameState; diceRolls?: number[] }) => {
      setGameState(gameState)
      if (diceRolls) setDiceResult(diceRolls)
      clearSelection()
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

  // ─── ACCIONES DE JUEGO ────────────────────────────────────────────────────
  const handleUnitClick = useCallback((unitId: string) => {
    if (!gameState || !myPlayerId) return
    const unit = gameState.units[unitId]
    if (!unit) return

    // Atacar unidad enemiga
    if (selectionMode === 'attacking' && selectedUnitId && unit.playerId !== myPlayerId) {
      socket.emit('GAME_ACTION', {
        action: { type: 'ATTACK', unitId: selectedUnitId, weaponIndex: 0, targetId: unitId }
      })
      clearSelection()
      return
    }

    // Seleccionar unidad propia
    if (unit.playerId !== myPlayerId) { setMessage('Esa unidad no es tuya'); return }
    if (gameState.activePlayerId !== myPlayerId) { setMessage('No es tu turno'); return }
    if (unitId !== gameState.activeUnitId) { setMessage('Esta unidad no puede actuar ahora'); return }

    setSelectedUnitId(unitId)
    setSelectionMode('moving')
    setReachableHexes(calcReachable(unitId, gameState))
    setAttackableHexes(new Set())
    setMessage(`${unit.name} seleccionado`)
  }, [gameState, myPlayerId, selectionMode, selectedUnitId, calcReachable, clearSelection])

  const handleHexClick = useCallback((key: string) => {
    if (!gameState || !selectedUnitId || selectionMode !== 'moving') return
    if (!reachableHexes.has(key)) return
    const [q, r] = key.split(',').map(Number)
    socket.emit('GAME_ACTION', {
      action: { type: 'ADVANCE', unitId: selectedUnitId, to: { q, r } }
    })
    clearSelection()
  }, [gameState, selectedUnitId, selectionMode, reachableHexes, clearSelection])

  const handleAttackMode = useCallback(() => {
    if (!gameState || !selectedUnitId) return
    const attackable = calcAttackable(selectedUnitId, gameState)
    if (attackable.size === 0) { setMessage('No hay enemigos en rango'); return }
    setSelectionMode('attacking')
    setAttackableHexes(attackable)
    setReachableHexes(new Set())
    setMessage('Selecciona un enemigo para atacar')
  }, [gameState, selectedUnitId, calcAttackable])

  const handleEndTurn = useCallback(() => {
    if (!selectedUnitId) return
    socket.emit('GAME_ACTION', {
      action: { type: 'END_ACTIVATION', unitId: selectedUnitId }
    })
    clearSelection()
  }, [selectedUnitId, clearSelection])

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

  // ─── ESPERANDO OPONENTE ───────────────────────────────────────────────────
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
        <div style={{ color: '#aaa', marginBottom: 8 }}>
          Comparte este código con tu oponente
        </div>
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

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a2e', display: 'flex', flexDirection: 'column' }}>

      {/* HUD superior */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 16px', background: 'rgba(0,0,0,0.8)', color: 'white',
        fontSize: 14, zIndex: 10, gap: 16,
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

      {/* HUD inferior */}
      {!isFinished && isMyTurn && selectedUnitId && gameState.units[selectedUnitId] && (
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
                <button onClick={handleAttackMode} style={{
                  padding: '6px 16px', background: '#c62828', color: 'white',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}>⚔ Atacar</button>
                <button onClick={handleEndTurn} style={{
                  padding: '6px 16px', background: '#333', color: 'white',
                  border: '1px solid #555', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}>Pasar turno →</button>
                <button onClick={clearSelection} style={{
                  padding: '6px 12px', background: 'transparent', color: '#aaa',
                  border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}>✕</button>
              </>
            )
          })()}
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