import { useState, useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { GameScene } from './three/GameScene'
import type { GameState } from './types/gameState'
import { hexKey, getReachableHexes, gridDistance, checkLineOfSight } from './game/hexGrid'
import { useGameData } from './game/useGameData'
import { UnitPanel } from './components/ui/UnitPanel'
import { TimelineBar } from './components/ui/TimelineBar'
import { TacticsHand } from './components/ui/TacticsHand'

const socket: Socket = io('http://localhost:3001')

type SelectionMode = 'none' | 'moving' | 'attacking' | 'dashing' | 'using_ability' | 'playing_card'
type AppScreen = 'lobby' | 'waiting' | 'squad_selection' | 'setup' | 'playing'

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
  const [pendingAbilityIndex, setPendingAbilityIndex] = useState<number | null>(null)
  const [pendingCardId, setPendingCardId] = useState<string | null>(null)
  const [tokenTooltip, setTokenTooltip] = useState<string | null>(null)
  const [squadFaction, setSquadFaction] = useState<string>('Earth Federation')
  const [selectedSquad, setSelectedSquad] = useState<string[]>([])
  const [selectedDeck, setSelectedDeck] = useState<string[]>([])
  const [squadStep, setSquadStep] = useState<'units' | 'deck'>('units')
  const [squadSubmitted, setSquadSubmitted] = useState(false)
  const [setupConfirmed, setSetupConfirmed] = useState(false)

  const gameStateRef = useRef<GameState | null>(null)
  const lastActionRef = useRef<'moving' | 'dashing' | null>(null)

  useEffect(() => { gameStateRef.current = gameState }, [gameState])

  const clearSelection = useCallback(() => {
    setSelectedUnitId(null)
    setSelectionMode('none')
    setReachableHexes(new Set())
    setAttackableHexes(new Set())
    setDiceResult(null)
    setHasMoved(false)
    setHasUsedPrimary(false)
    setSelectedWeaponIndex(null)
    setPendingAbilityIndex(null)
    setPendingCardId(null)
    lastActionRef.current = null
  }, [])

  // ─── SOCKET EVENTS ────────────────────────────────────────────────────────
  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true)
      const saved = sessionStorage.getItem('reconnectData')
      if (saved) {
        try {
          const { roomId, playerId } = JSON.parse(saved)
          socket.emit('RECONNECT', { roomId, playerId })
        } catch {
          sessionStorage.removeItem('reconnectData')
        }
      }
    })
    socket.on('disconnect', () => setConnected(false))

    socket.on('ROOM_CREATED', ({ roomId, playerId }: { roomId: string; playerId: 'player1' | 'player2' }) => {
      setRoomId(roomId)
      setMyPlayerId(playerId)
      sessionStorage.setItem('reconnectData', JSON.stringify({ roomId, playerId }))
      setScreen('waiting')
    })

    socket.on('JOIN_ERROR', ({ message }: { message: string }) => {
      setLobbyError(message)
    })

    socket.on('SQUAD_SELECTION_STARTED', ({ playerId, faction, roomId: rId }: { playerId: 'player1' | 'player2'; faction: string; roomId: string }) => {
      setMyPlayerId(playerId)
      setRoomId(rId)
      setSquadFaction(faction)
      setSelectedSquad([])
      setSelectedDeck([])
      setSquadStep('units')
      setSquadSubmitted(false)
      sessionStorage.setItem('reconnectData', JSON.stringify({ roomId: rId, playerId }))
      setScreen('squad_selection')
    })

    socket.on('GAME_STARTED', ({ gameState, playerId }: { gameState: GameState; playerId: 'player1' | 'player2' }) => {
      setGameState(gameState)
      setMyPlayerId(playerId)
      setSetupConfirmed(false)
      setScreen(gameState.phase === 'setup' ? 'setup' : 'playing')
      setMessage(gameState.phase === 'setup' ? 'Ordena tus unidades en el Timeline' : '¡Partida iniciada!')
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

      // Setup → phase1 transition
      if (newState.phase === 'phase1') {
        setScreen('playing')
        setSetupConfirmed(false)
        setMessage('¡Partida iniciada!')
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

    socket.on('OPPONENT_RECONNECTED', ({ message }: { message: string }) => {
      setMessage(message)
    })

    socket.on('OPPONENT_ABANDONED', ({ message }: { message: string }) => {
      setMessage(message)
      sessionStorage.removeItem('reconnectData')
    })

    socket.on('RECONNECT_SUCCESS', ({ playerId, roomId: rId, roomStatus, gameState: gs, faction, squadSubmitted: submitted }: {
      playerId: 'player1' | 'player2'
      roomId: string
      roomStatus: string
      gameState?: GameState
      faction: string
      squadSubmitted: boolean
    }) => {
      setMyPlayerId(playerId)
      setRoomId(rId)

      if (roomStatus === 'waiting') {
        setScreen('waiting')
      } else if (roomStatus === 'squad_selection') {
        setSquadFaction(faction)
        setSquadSubmitted(submitted)
        if (!submitted) {
          setSelectedSquad([])
          setSelectedDeck([])
          setSquadStep('units')
        }
        setScreen('squad_selection')
      } else if (roomStatus === 'playing' && gs) {
        setGameState(gs)
        setScreen(gs.phase === 'setup' ? 'setup' : 'playing')
        setMessage('Reconectado a la partida')
      } else if (roomStatus === 'finished' && gs) {
        setGameState(gs)
        setScreen('playing')
        setMessage('Partida finalizada')
        sessionStorage.removeItem('reconnectData')
      }
    })

    socket.on('RECONNECT_FAILED', ({ message }: { message: string }) => {
      sessionStorage.removeItem('reconnectData')
      setMessage(message)
    })

    socket.on('PHASE_TRANSITION', ({ gameState: newState, message: msg }: { gameState: GameState; message: string }) => {
      setGameState(newState)
      setMessage(msg)
      clearSelection()
    })

    return () => {
      socket.off('connect')
      socket.off('disconnect')
      socket.off('ROOM_CREATED')
      socket.off('JOIN_ERROR')
      socket.off('SQUAD_SELECTION_STARTED')
      socket.off('GAME_STARTED')
      socket.off('GAME_STATE_UPDATE')
      socket.off('GAME_OVER')
      socket.off('ACTION_ERROR')
      socket.off('OPPONENT_DISCONNECTED')
      socket.off('OPPONENT_RECONNECTED')
      socket.off('OPPONENT_ABANDONED')
      socket.off('RECONNECT_SUCCESS')
      socket.off('RECONNECT_FAILED')
      socket.off('PHASE_TRANSITION')
    }
  }, [clearSelection])

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  const calcReachable = useCallback((unitId: string, state: GameState) => {
    const unit = state.units[unitId]
    if (!unit?.position) return new Set<string>()
    const obstacles = new Set(
      Object.values(state.units)
        .filter(u => u.id !== unitId && u.currentHp > 0 && u.position && u.playerId !== unit.playerId)
        .map(u => hexKey(u.position!))
    )
    // Aplicar upgrade de movimiento
    const movementUpgrade = unit.upgrades.find(u => u.type === 'movement')?.value ?? 0
    const maxMove = 3 + movementUpgrade
    const hasHover = unit.traits.includes('Hover')

    const reachable = getReachableHexes(unit.position, state.board, obstacles, maxMove, hasHover)
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
    // Garrisons enemigas también son objetivos de ataque
    for (const hex of Object.values(state.board)) {
      if (!hex.garrisonToken || hex.garrisonToken.owner === unit.playerId) continue
      const dist = gridDistance(unit.position, hex.coord)
      if (dist > weapon.range) continue
      if (dist > 1) {
        const los = checkLineOfSight(unit.position, hex.coord, state.board, unit.playerId as 'player1' | 'player2', enemyIds)
        if (!los.clear) continue
      }
      attackable.add(hexKey(hex.coord))
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

    if (selectionMode === 'using_ability' && selectedUnitId && pendingAbilityIndex !== null && unit.playerId !== myPlayerId) {
      socket.emit('GAME_ACTION', {
        action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex: pendingAbilityIndex, targetId: unitId }
      })
      setHasUsedPrimary(true)
      clearSelection()
      return
    }

    if (selectionMode === 'playing_card' && selectedUnitId && pendingCardId !== null && unit.playerId !== myPlayerId) {
      socket.emit('GAME_ACTION', {
        action: { type: 'PLAY_CARD', unitId: selectedUnitId, cardId: pendingCardId, targetId: unitId }
      })
      setPendingCardId(null)
      setSelectionMode('none')
      setAttackableHexes(new Set())
      setReachableHexes(new Set())
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
  }, [gameState, myPlayerId, selectionMode, selectedUnitId, selectedWeaponIndex, pendingAbilityIndex, pendingCardId, hasMoved, calcReachable, clearSelection])

  const handleHexClick = useCallback((key: string) => {
    if (!gameState || !selectedUnitId) return

    // En modo ataque: disparar a garrison enemiga si el hex tiene una
    if (selectionMode === 'attacking' && attackableHexes.has(key)) {
      const hex = gameState.board[key]
      if (hex?.garrisonToken && hex.garrisonToken.owner !== myPlayerId) {
        socket.emit('GAME_ACTION', {
          action: { type: 'ATTACK_GARRISON', unitId: selectedUnitId, weaponIndex: selectedWeaponIndex ?? 0, garrisonId: hex.garrisonToken.id }
        })
        setHasUsedPrimary(true)
        clearSelection()
        return
      }
    }

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
  }, [gameState, selectedUnitId, selectionMode, reachableHexes, attackableHexes, myPlayerId, selectedWeaponIndex, clearSelection])

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

  const handleUseAbility = useCallback((abilityIndex: number) => {
    if (!gameState || !selectedUnitId || !myPlayerId) return
    const unit = gameState.units[selectedUnitId]
    if (!unit) return
    const ability = unit.abilities[abilityIndex]
    if (!ability) return

    if (ability.abilityData?.type === 'fracture_enemy') {
      const enemyHexes = new Set(
        Object.values(gameState.units)
          .filter(u => u.playerId !== myPlayerId && u.currentHp > 0 && u.position)
          .map(u => hexKey(u.position!))
      )
      if (enemyHexes.size === 0) { setMessage('No hay enemigos en el tablero'); return }
      setPendingAbilityIndex(abilityIndex)
      setSelectionMode('using_ability')
      setAttackableHexes(enemyHexes)
      setReachableHexes(new Set())
      setMessage(`${ability.name} — Selecciona un objetivo enemigo`)
      return
    }

    socket.emit('GAME_ACTION', {
      action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex }
    })
    setHasUsedPrimary(true)
    clearSelection()
  }, [gameState, selectedUnitId, myPlayerId, clearSelection])

  const handlePlayCard = useCallback((cardId: string) => {
    if (!gameState || !myPlayerId) return

    // Si hay ventana de respuesta activa para mí, emitir PLAY_RESPONSE
    if (gameState.pendingResponse?.forPlayerId === myPlayerId) {
      socket.emit('GAME_ACTION', { action: { type: 'PLAY_RESPONSE', cardId } })
      setMessage('Carta RSP jugada')
      return
    }

    // Usa la unidad seleccionada o la activa si no hay selección
    const unitId = selectedUnitId ?? gameState.activeUnitId
    if (!unitId) return
    const unit = gameState.units[unitId]
    if (!unit || unit.playerId !== myPlayerId) { setMessage('No tienes una unidad activa'); return }

    const card = gameState.players[myPlayerId].tactics.hand.find(c => c.id === cardId)
    if (!card) return
    if (!card.effectData) {
      setMessage(`"${card.name}" no está implementada aún`)
      return
    }

    const needsTarget = card.effectData.type === 'destroy_upgrade_and_slow' ||
                        card.effectData.type === 'destroy_upgrade_and_fracture'

    if (needsTarget) {
      const enemyHexes = new Set(
        Object.values(gameState.units)
          .filter(u => u.playerId !== myPlayerId && u.currentHp > 0 && u.position)
          .map(u => hexKey(u.position!))
      )
      if (enemyHexes.size === 0) { setMessage('No hay enemigos en el tablero'); return }
      setSelectedUnitId(unitId)
      setPendingCardId(cardId)
      setSelectionMode('playing_card')
      setAttackableHexes(enemyHexes)
      setReachableHexes(new Set())
      setMessage(`${card.name} — Selecciona un objetivo enemigo`)
      return
    }

    socket.emit('GAME_ACTION', {
      action: { type: 'PLAY_CARD', unitId, cardId }
    })
    setMessage(`Carta jugada: ${card.name}`)
  }, [gameState, selectedUnitId, myPlayerId])

  const handlePassResponse = useCallback(() => {
    socket.emit('GAME_ACTION', { action: { type: 'PASS_RESPONSE' } })
  }, [])

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

  // ─── SELECCIÓN DE ESCUADRA ────────────────────────────────────────────────
  if (screen === 'squad_selection') {
    const availableUnitCards = gameData.allUnitCards
    const availableTacticsCards = gameData.allTacticsCards
    const MAX_SQUAD = 3
    const DECK_SIZE = 10
    const canGoToDeck = selectedSquad.length === MAX_SQUAD
    const canConfirm = selectedDeck.length === DECK_SIZE && !squadSubmitted

    return (
      <div style={{
        width: '100vw', height: '100vh', background: '#0d0d1a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#1a1a2e', border: '1px solid #333', borderRadius: 12,
          padding: '32px 40px', maxWidth: 760, width: '100%', color: 'white',
        }}>
          {/* Cabecera con pasos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 'bold', color: '#4fc3f7' }}>
                {squadStep === 'units' ? 'Selección de Escuadra' : 'Mazo de Tácticas'}
              </div>
              <div style={{
                fontSize: 11, marginTop: 2,
                color: squadFaction === 'Earth Federation' ? '#4fc3f7' : '#ef5350',
                fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase',
              }}>
                {squadFaction}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {(['units', 'deck'] as const).map((step, i) => (
                <div key={step} style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 'bold',
                  background: squadStep === step ? '#1565c0' : (step === 'deck' && squadStep === 'deck') ? '#1565c0' : '#333',
                  color: squadStep === step ? 'white' : '#888',
                  border: `2px solid ${squadStep === step ? '#4fc3f7' : '#444'}`,
                }}>{i + 1}</div>
              ))}
            </div>
          </div>

          <div style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
            {squadStep === 'units'
              ? `Elige ${MAX_SQUAD} unidades (${selectedSquad.length}/${MAX_SQUAD})`
              : `Elige exactamente ${DECK_SIZE} cartas (${selectedDeck.length}/${DECK_SIZE})`}
          </div>

          {/* PASO 1: Unidades */}
          {squadStep === 'units' && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
                {availableUnitCards.map(card => {
                  const isSelected = selectedSquad.includes(card.cardId)
                  const canSelect = !isSelected && selectedSquad.length < MAX_SQUAD
                  return (
                    <div
                      key={card.cardId}
                      onClick={() => {
                        if (isSelected) setSelectedSquad(prev => prev.filter(id => id !== card.cardId))
                        else if (canSelect) setSelectedSquad(prev => [...prev, card.cardId])
                      }}
                      style={{
                        border: `2px solid ${isSelected ? '#4fc3f7' : '#333'}`,
                        borderRadius: 8, padding: '12px 16px',
                        cursor: isSelected || canSelect ? 'pointer' : 'not-allowed',
                        background: isSelected ? 'rgba(79,195,247,0.1)' : '#0d0d1a',
                        opacity: (!isSelected && !canSelect) ? 0.4 : 1,
                        minWidth: 140,
                      }}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{card.unitName}</div>
                      {card.pilot && card.pilot !== card.unitName && (
                        <div style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>{card.pilot}</div>
                      )}
                      <div style={{ fontSize: 10, color: card.faction === 'Earth Federation' ? '#4fc3f7' : '#ef5350', marginBottom: 4 }}>
                        {card.faction}
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#aaa' }}>
                        <span>HP {card.hp}</span>
                        <span>VP {card.vp}</span>
                        <span>TL {card.tl}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <button
                disabled={!canGoToDeck}
                onClick={() => {
                  setSquadStep('deck')
                }}
                style={{
                  padding: '12px 32px', background: canGoToDeck ? '#1565c0' : '#333',
                  color: 'white', border: 'none', borderRadius: 8,
                  cursor: canGoToDeck ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 'bold',
                }}
              >
                Siguiente →
              </button>
            </>
          )}

          {/* PASO 2: Mazo de tácticas */}
          {squadStep === 'deck' && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                {availableTacticsCards.map(card => {
                  const isSelected = selectedDeck.includes(card.cardId)
                  const isFull = selectedDeck.length >= DECK_SIZE
                  const isCommand = card.type === 'command'
                  const isFed = card.faction === 'Earth Federation'
                  const artColor = isFed
                    ? (isCommand ? 'linear-gradient(160deg, #0d47a1 0%, #1565c0 50%, #29b6f6 100%)'
                                 : 'linear-gradient(160deg, #004d40 0%, #00695c 50%, #4db6ac 100%)')
                    : (isCommand ? 'linear-gradient(160deg, #b71c1c 0%, #c62828 50%, #ef9a9a 100%)'
                                 : 'linear-gradient(160deg, #4a148c 0%, #6a1b9a 50%, #ce93d8 100%)')
                  const borderColor = isSelected ? '#4fc3f7' : isFull && !isSelected ? '#222' : '#444'
                  const canToggle = !squadSubmitted && (isSelected || !isFull)
                  return (
                    <div
                      key={card.cardId}
                      onClick={() => {
                        if (!canToggle) return
                        if (isSelected) setSelectedDeck(prev => prev.filter(id => id !== card.cardId))
                        else setSelectedDeck(prev => [...prev, card.cardId])
                      }}
                      style={{
                        width: 118, borderRadius: 8, overflow: 'hidden',
                        border: `2px solid ${borderColor}`,
                        cursor: canToggle ? 'pointer' : 'default',
                        opacity: isFull && !isSelected ? 0.35 : 1,
                        position: 'relative',
                        boxShadow: isSelected ? '0 0 10px rgba(79,195,247,0.4)' : 'none',
                        transition: 'opacity 0.15s, box-shadow 0.15s',
                        flexShrink: 0,
                      }}
                    >
                      {/* Área de arte */}
                      <div style={{
                        height: 72, background: artColor,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 4,
                        position: 'relative',
                      }}>
                        <div style={{
                          fontSize: 22,
                          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
                        }}>
                          {isCommand ? '⚔️' : '🛡️'}
                        </div>
                        <div style={{
                          fontSize: 9, fontWeight: 'bold', letterSpacing: 1,
                          color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase',
                        }}>
                          {isFed ? 'Fed.' : 'Zeon'}
                        </div>
                        {isSelected && (
                          <div style={{
                            position: 'absolute', top: 4, right: 6,
                            width: 18, height: 18, borderRadius: '50%',
                            background: '#4fc3f7', color: '#000',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 'bold',
                          }}>✓</div>
                        )}
                      </div>
                      {/* Cuerpo de la carta */}
                      <div style={{ background: '#111827', padding: '7px 8px' }}>
                        <div style={{
                          fontSize: 11, fontWeight: 'bold', color: 'white',
                          lineHeight: 1.3, marginBottom: 4,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {card.name}
                        </div>
                        <div style={{
                          display: 'inline-block', fontSize: 9, padding: '1px 5px', borderRadius: 3,
                          background: isCommand ? 'rgba(21,101,192,0.5)' : 'rgba(123,31,162,0.5)',
                          color: isCommand ? '#90caf9' : '#ce93d8',
                          textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5,
                        }}>
                          {isCommand ? 'Comando' : 'Respuesta'}
                        </div>
                        <div style={{
                          fontSize: 9.5, color: '#9ca3af', lineHeight: 1.35,
                          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {card.effect}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  onClick={() => setSquadStep('units')}
                  disabled={squadSubmitted}
                  style={{
                    padding: '12px 20px', background: '#333', color: '#aaa',
                    border: 'none', borderRadius: 8, cursor: squadSubmitted ? 'not-allowed' : 'pointer', fontSize: 14,
                  }}
                >
                  ← Volver
                </button>
                {squadSubmitted ? (
                  <div style={{ color: '#4caf50', flex: 1, textAlign: 'center' }}>
                    Selección confirmada — esperando al oponente...
                  </div>
                ) : (
                  <button
                    disabled={!canConfirm}
                    onClick={() => {
                      socket.emit('SELECT_SQUAD', { unitCardIds: selectedSquad, cardIds: selectedDeck })
                      setSquadSubmitted(true)
                    }}
                    style={{
                      flex: 1, padding: '12px 32px', background: canConfirm ? '#1565c0' : '#333',
                      color: 'white', border: 'none', borderRadius: 8,
                      cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 'bold',
                    }}
                  >
                    Confirmar selección
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── SETUP (ORDENAR TIMELINE) ─────────────────────────────────────────────
  if (screen === 'setup' && gameState) {
    const slotsWithMultiple = gameState.timeline.slots.filter(
      slot => slot.tokens.filter(t => t.playerId === myPlayerId).length > 1
    )

    return (
      <div style={{
        width: '100vw', height: '100vh', background: '#0d0d1a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#1a1a2e', border: '1px solid #333', borderRadius: 12,
          padding: '32px 40px', maxWidth: 600, width: '100%', color: 'white',
        }}>
          <div style={{ fontSize: 22, fontWeight: 'bold', color: '#4fc3f7', marginBottom: 4 }}>
            Ordenar Timeline
          </div>
          <div style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
            Si tienes varias unidades en el mismo slot, elige cuál activa primero.
          </div>

          {slotsWithMultiple.length === 0 ? (
            <div style={{ color: '#aaa', marginBottom: 24 }}>
              Tus unidades no comparten ningún slot — no hay nada que reordenar.
            </div>
          ) : (
            <div style={{ marginBottom: 24 }}>
              {slotsWithMultiple.map(slot => {
                const myTokens = slot.tokens.filter(t => t.playerId === myPlayerId)
                return (
                  <div key={slot.round} style={{ marginBottom: 16, padding: '12px 16px', background: '#0d0d1a', borderRadius: 8 }}>
                    <div style={{ color: '#f5c518', marginBottom: 8, fontSize: 13 }}>Slot {slot.round}</div>
                    {myTokens.map((token, idx) => {
                      const unit = gameState.units[token.unitId]
                      return (
                        <div key={token.unitId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ color: '#4fc3f7', flex: 1 }}>{idx + 1}. {unit?.name ?? token.unitId}</span>
                          <button
                            disabled={idx === 0}
                            onClick={() => {
                              const newOrder = [...myTokens.map(t => t.unitId)]
                              const tmp = newOrder[idx]; newOrder[idx] = newOrder[idx - 1]; newOrder[idx - 1] = tmp
                              socket.emit('REORDER_SLOT', { slotRound: slot.round, unitIds: newOrder })
                            }}
                            style={{ padding: '2px 8px', background: '#333', color: 'white', border: 'none', borderRadius: 4, cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.3 : 1 }}
                          >▲</button>
                          <button
                            disabled={idx === myTokens.length - 1}
                            onClick={() => {
                              const newOrder = [...myTokens.map(t => t.unitId)]
                              const tmp = newOrder[idx]; newOrder[idx] = newOrder[idx + 1]; newOrder[idx + 1] = tmp
                              socket.emit('REORDER_SLOT', { slotRound: slot.round, unitIds: newOrder })
                            }}
                            style={{ padding: '2px 8px', background: '#333', color: 'white', border: 'none', borderRadius: 4, cursor: idx === myTokens.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === myTokens.length - 1 ? 0.3 : 1 }}
                          >▼</button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ marginBottom: 16, fontSize: 12, color: '#666' }}>
            Timeline resumen:
            {gameState.timeline.slots
              .filter(s => s.tokens.some(t => t.playerId === myPlayerId))
              .map(s => {
                const myTokens = s.tokens.filter(t => t.playerId === myPlayerId)
                return <span key={s.round} style={{ marginLeft: 8 }}>
                  Slot {s.round}: {myTokens.map(t => gameState.units[t.unitId]?.name ?? t.unitId).join(', ')}
                </span>
              })
            }
          </div>

          {setupConfirmed ? (
            <div style={{ color: '#4caf50' }}>Confirmado — esperando al oponente...</div>
          ) : (
            <button
              onClick={() => {
                socket.emit('CONFIRM_SETUP')
                setSetupConfirmed(true)
              }}
              style={{
                padding: '12px 32px', background: '#1565c0', color: 'white',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 'bold',
              }}
            >
              Confirmar y comenzar
            </button>
          )}
        </div>
      </div>
    )
  }

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
            onUseAbility={handleUseAbility}
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

        {myPlayerId && !isFinished && (gameState.players[myPlayerId].tactics.hand.length > 0 || gameState.pendingResponse?.forPlayerId === myPlayerId) && (
          <TacticsHand
            hand={gameState.players[myPlayerId].tactics.hand}
            isMyTurn={isMyTurn}
            selectedCardId={pendingCardId}
            onPlayCard={handlePlayCard}
            pendingResponseTrigger={gameState.pendingResponse?.forPlayerId === myPlayerId ? gameState.pendingResponse.trigger : null}
            onPassResponse={handlePassResponse}
          />
        )}

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
                sessionStorage.removeItem('reconnectData')
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