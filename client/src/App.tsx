import { useState, useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { GameScene } from './three/GameScene'
import type { GameState } from './types/gameState'
import { hexKey, getReachableHexes, gridDistance, checkLineOfSight } from './game/hexGrid'
import { useGameData } from './game/useGameData'
import { UnitPanel } from './components/ui/UnitPanel'
import { TimelineBar } from './components/ui/TimelineBar'

const socket: Socket = io('http://localhost:3001')

type SelectionMode = 'none' | 'moving' | 'attacking' | 'dashing'
type AppScreen = 'lobby' | 'waiting' | 'playing'

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
  const [panelUnitId, setPanelUnitId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none')
  const [reachableHexes, setReachableHexes] = useState<Set<string>>(new Set())
  const [attackableHexes, setAttackableHexes] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [diceResult, setDiceResult] = useState<number[] | null>(null)
  const [hasMoved, setHasMoved] = useState(false)
  const [hasUsedPrimary, setHasUsedPrimary] = useState(false)
  const [selectedWeaponIndex, setSelectedWeaponIndex] = useState<number | null>(null)
  const [tokenTooltip, setTokenTooltip] = useState<string | null>(null)

  const gameStateRef = useRef<GameState | null>(null)
  const lastActionRef = useRef<'moving' | 'dashing' | null>(null)

  useEffect(() => { gameStateRef.current = gameState }, [gameState])

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
      const prevState = gameStateRef.current

      if (prevState && newState.activeUnitId) {
        const prevUnit = prevState.units[newState.activeUnitId]
        const newUnit = newState.units[newState.activeUnitId]

        if (prevUnit && newUnit) {
          // Detectar upgrade o energía recogida
          if (newUnit.upgrades.length > prevUnit.upgrades.length) {
            const gained = newUnit.upgrades[newUnit.upgrades.length - 1]
            const labels: Record<string, string> = {
              attack: '⚔ ¡Upgrade de Ataque! +1 Strength permanente',
              shield: '🛡 ¡Upgrade de Escudo! Absorbe 1 daño',
              movement: '👟 ¡Upgrade de Movimiento! +1 hex de movimiento',
            }
            setMessage(labels[gained.type] ?? `Upgrade obtenido: ${gained.type}`)
          } else if (newUnit.energy > prevUnit.energy) {
            setMessage('⚡ ¡Energía obtenida! +1 token de energía')
          }

          // Detectar movimiento confirmado por el servidor
          const prevPos = prevUnit.position
          const newPos = newUnit.position
          const moved = prevPos && newPos &&
            (prevPos.q !== newPos.q || prevPos.r !== newPos.r)

          if (moved && lastActionRef.current) {
            if (lastActionRef.current === 'moving') {
              setHasMoved(true)
              const weapon = newUnit.weapons[0]
              if (weapon) {
                const enemyIds = new Set(
                  Object.values(newState.units)
                    .filter(u => u.playerId !== newUnit.playerId && u.currentHp > 0 && u.position)
                    .map(u => u.id)
                )
                const attackable = new Set<string>()
                for (const other of Object.values(newState.units)) {
                  if (other.playerId === newUnit.playerId) continue
                  if (other.currentHp <= 0 || !other.position) continue
                  const dist = gridDistance(newPos, other.position)
                  if (dist > weapon.range) continue
                  if (dist > 1) {
                    const los = checkLineOfSight(newPos, other.position, newState.board, newUnit.playerId as 'player1' | 'player2', enemyIds)
                    if (!los.clear) continue
                  }
                  attackable.add(hexKey(other.position))
                }
                setAttackableHexes(attackable)
                setMessage(attackable.size > 0 ? 'Puedes atacar u otras acciones' : 'Pasa turno')
              }
            } else if (lastActionRef.current === 'dashing') {
              setHasUsedPrimary(true)
              setMessage('Dash realizado')
            }
            lastActionRef.current = null
          }
        }
      }

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
          lastActionRef.current = null
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
      lastActionRef.current = null
      setSelectionMode('none')
      setReachableHexes(new Set())
      setAttackableHexes(new Set())
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
    lastActionRef.current = null
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
    const alliedHexes = new Set(
      Object.values(state.units)
        .filter(u => u.id !== unitId && u.currentHp > 0 && u.position && u.playerId === unit.playerId)
        .map(u => hexKey(u.position!))
    )
    return new Set(reachable.map(h => hexKey(h)).filter(k => !alliedHexes.has(k)))
  }, [])

  const calcAttackable = useCallback((unitId: string, state: GameState, weaponIndex: number = 0) => {
    const unit = state.units[unitId]
    if (!unit?.position) return new Set<string>()
    const weapon = unit.weapons[weaponIndex]
    if (!weapon) return new Set<string>()
    const enemyIds = new Set(
      Object.values(state.units)
        .filter(u => u.playerId !== unit.playerId && u.currentHp > 0 && u.position)
        .map(u => u.id)
    )
    const attackable = new Set<string>()
    for (const other of Object.values(state.units)) {
      if (other.playerId === unit.playerId) continue
      if (other.currentHp <= 0 || !other.position) continue
      const dist = gridDistance(unit.position, other.position)
      if (dist > weapon.range) continue
      if (dist > 1) {
        const los = checkLineOfSight(unit.position, other.position, state.board, unit.playerId as 'player1' | 'player2', enemyIds)
        if (!los.clear) continue
      }
      attackable.add(hexKey(other.position))
    }
    return attackable
  }, [])

  const calcCanRescue = useCallback((unitId: string, state: GameState, playerId: 'player1' | 'player2') => {
    const unit = state.units[unitId]
    if (!unit?.position) return false
    for (const hex of Object.values(state.board)) {
      if (!hex.garrisonToken) continue
      if (hex.garrisonToken.owner !== playerId) continue
      const dist = gridDistance(unit.position, hex.coord)
      if (dist <= 1) return true
    }
    return false
  }, [])

  // ─── ACCIONES ─────────────────────────────────────────────────────────────
  const handleUnitClick = useCallback((unitId: string) => {
    if (!gameState || !myPlayerId) return
    const unit = gameState.units[unitId]
    if (!unit) return

    setPanelUnitId(unitId)

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
      lastActionRef.current = 'moving'
      socket.emit('GAME_ACTION', {
        action: { type: 'ADVANCE', unitId: selectedUnitId, to: { q, r } }
      })
      setReachableHexes(new Set())
      setSelectionMode('none')
    }

    if (selectionMode === 'dashing') {
      lastActionRef.current = 'dashing'
      socket.emit('GAME_ACTION', {
        action: { type: 'DASH', unitId: selectedUnitId, to: { q, r } }
      })
      setReachableHexes(new Set())
      setSelectionMode('none')
    }
  }, [gameState, selectedUnitId, selectionMode, reachableHexes])

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

  const handleRescue = useCallback(() => {
    if (!selectedUnitId || !gameState || !myPlayerId) return
    const unit = gameState.units[selectedUnitId]
    if (!unit?.position) return
    for (const hex of Object.values(gameState.board)) {
      if (!hex.garrisonToken) continue
      if (hex.garrisonToken.owner !== myPlayerId) continue
      const dist = gridDistance(unit.position, hex.coord)
      if (dist <= 1) {
        socket.emit('GAME_ACTION', {
          action: { type: 'RESCUE', unitId: selectedUnitId, garrisonId: hex.garrisonToken.id }
        })
        setHasUsedPrimary(true)
        setMessage('Garrison rescatada — +2 VP')
        return
      }
    }
  }, [selectedUnitId, gameState, myPlayerId])

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
  const panelUnit = panelUnitId
    ? gameState.units[panelUnitId]
    : activeUnit ?? null

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a2e', display: 'flex', flexDirection: 'column' }}>

      <TimelineBar gameState={gameState} myPlayerId={myPlayerId} />

      <div style={{
        textAlign: 'center', padding: '4px 16px',
        background: 'rgba(0,0,0,0.6)', color: 'white',
        fontSize: 12, zIndex: 10, flexShrink: 0,
        borderBottom: '1px solid #111',
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16,
      }}>
        <span style={{ color: gameState.activePlayerId === 'player1' ? '#4fc3f7' : '#ef9a9a' }}>
          {activeUnit?.name ?? '—'}
        </span>
        <span style={{ color: isMyTurn ? '#4caf50' : '#888' }}>
          {isFinished ? '— FIN —' : isMyTurn ? '⚡ Tu turno' : `Turno de ${activePlayer.name}`}
        </span>
        {message && <span style={{ color: '#f5c518' }}>{message}</span>}
        {diceResult && (
          <span style={{ color: '#aaa' }}>
            [{diceResult.join(', ')}] — {diceResult.filter(r => r >= 4).length} impactos
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <GameScene
          gameState={gameState}
          selectedUnitId={selectedUnitId}
          reachableHexes={reachableHexes}
          attackableHexes={attackableHexes}
          onHexClick={handleHexClick}
          onUnitClick={handleUnitClick}
          onTokenHover={setTokenTooltip}
        />

        {panelUnit && !isFinished && (
          <UnitPanel
            unit={panelUnit}
            isActive={gameState.activeUnitId === panelUnit.id}
            isMyUnit={panelUnit.playerId === myPlayerId}
            isMyTurn={isMyTurn}
            isSelected={panelUnit?.id === selectedUnitId}
            hasMoved={hasMoved}
            hasUsedPrimary={hasUsedPrimary}
            selectedWeaponIndex={selectedWeaponIndex}
            canRescue={
              selectedUnitId && myPlayerId
                ? calcCanRescue(selectedUnitId, gameState, myPlayerId)
                : false
            }
            onMove={() => {
              if (!selectedUnitId) return
              setSelectionMode('moving')
              setReachableHexes(calcReachable(selectedUnitId, gameState))
              setAttackableHexes(new Set())
              setMessage('Elige hex para mover')
            }}
            onDash={() => {
              if (!selectedUnitId) return
              setSelectionMode('dashing')
              const unit = gameState.units[selectedUnitId]
              if (!unit.position) return
              const obstacles = new Set(
                Object.values(gameState.units)
                  .filter(u2 => u2.id !== selectedUnitId && u2.currentHp > 0 && u2.position && u2.playerId !== unit.playerId)
                  .map(u2 => hexKey(u2.position!))
              )
              const alliedHexes = new Set(
                Object.values(gameState.units)
                  .filter(u2 => u2.id !== selectedUnitId && u2.currentHp > 0 && u2.position && u2.playerId === unit.playerId)
                  .map(u2 => hexKey(u2.position!))
              )
              const reachable = getReachableHexes(unit.position, gameState.board, obstacles, 2)
              setReachableHexes(new Set(reachable.map(h => hexKey(h)).filter(k => !alliedHexes.has(k))))
              setAttackableHexes(new Set())
              setMessage('Dash: elige hex (2 hexes, cuesta 2 TL)')
            }}
            onAttack={(idx) => handleAttackMode(idx)}
            onEnergize={() => {
              if (!selectedUnitId) return
              socket.emit('GAME_ACTION', { action: { type: 'ENERGIZE', unitId: selectedUnitId } })
              setHasUsedPrimary(true)
              setMessage('Energize: +1 energía, -2 TL')
            }}
            onRescue={handleRescue}
            onEndTurn={handleEndTurn}
            onCancel={() => {
              setSelectionMode('none')
              setReachableHexes(new Set())
              setAttackableHexes(new Set())
              setSelectedUnitId(null)
              setPanelUnitId(null)
            }}
          />
        )}

        <div style={{
          position: 'absolute', bottom: 16, right: 16,
          background: 'rgba(10,10,20,0.92)', border: '1px solid #333',
          borderRadius: 8, padding: '8px 12px', color: 'white',
          fontSize: 11, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ color: '#666', fontSize: 10, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
            Leyenda
          </div>
          {[
            { color: '#f5c518', shape: 'circle', label: 'Objetivo' },
            { color: '#4fc3f7', shape: 'square', label: 'Garrison Federación' },
            { color: '#ef9a9a', shape: 'square', label: 'Garrison Zeon' },
            { color: '#ef9a9a', shape: 'diamond', label: '⚔ Ataque' },
            { color: '#4fc3f7', shape: 'diamond', label: '🛡 Escudo' },
            { color: '#81c784', shape: 'diamond', label: '👟 Movimiento' },
            { color: '#f5c518', shape: 'diamond', label: '⚡ Energía' },
            { color: '#555', shape: 'diamond', label: '❓ Token oculto' },
          ].map(({ color, shape, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 10, height: 10,
                background: color,
                borderRadius: shape === 'circle' ? '50%' : 0,
                transform: shape === 'diamond' ? 'rotate(45deg)' : 'none',
                flexShrink: 0,
              }} />
              <span style={{ color: color === '#555' ? '#888' : color }}>{label}</span>
            </div>
          ))}
        </div>

        {tokenTooltip && (
          <div style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(10,10,20,0.95)', border: '1px solid #f5c518',
            borderRadius: 8, padding: '8px 16px', color: '#f5c518',
            fontSize: 13, zIndex: 20, whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            {tokenTooltip}
          </div>
        )}
      </div>

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
              onClick={() => {
                setScreen('lobby')
                setGameState(null)
                setMyPlayerId(null)
                setPanelUnitId(null)
              }}
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