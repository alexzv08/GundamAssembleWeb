import { useState, useCallback, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { GameScene } from './three/GameScene'
import type { GameState } from './types/gameState'
import { hexKey, getReachableHexes, gridDistance, checkLineOfSight } from './game/hexGrid'
import { getUnitRound } from './game/timeline'
import { useGameData } from './game/useGameData'
import { UnitPanel } from './components/ui/UnitPanel'
import { TimelineBar } from './components/ui/TimelineBar'
import { TacticsHand } from './components/ui/TacticsHand'
import { useToasts, ToastContainer } from './components/ui/Toast'
import { ActionLog } from './components/ui/ActionLog'
import { AuthScreen } from './components/ui/AuthScreen'
import { ProfileModal } from './components/ui/ProfileModal'
import { UsernameSetupModal } from './components/ui/UsernameSetupModal'
import { GameStatusBar } from './components/ui/GameStatusBar'
import { ObjectivesPanel } from './components/ui/ObjectivesPanel'
import { LegendPanel } from './components/ui/LegendPanel'
import { GameOverModal } from './components/ui/GameOverModal'
import { LobbyScreen } from './screens/LobbyScreen'
import { WaitingScreen } from './screens/WaitingScreen'
import { SquadSelectionScreen } from './screens/SquadSelectionScreen'
import { SetupScreen } from './screens/SetupScreen'
import { supabase } from './lib/supabase'
import type { User } from '@supabase/supabase-js'
import { GameScreenPreview } from './components/experimental/GameScreenPreview'

const HAND_STRIP_H = 140

const socket: Socket = io(import.meta.env.VITE_SERVER_URL as string, {
  autoConnect: false,
  auth: (cb: (data: { token: string | null }) => void) => {
    supabase.auth.getSession().then(({ data }) => {
      cb({ token: data.session?.access_token ?? null })
    })
  },
})

function inferHasMoved(actionLog: GameState['actionLog'], activeUnitId: string | null): boolean {
  if (!activeUnitId) return false
  for (let i = actionLog.length - 1; i >= 0; i--) {
    const a = actionLog[i]
    if (a.type === 'END_ACTIVATION') break
    if (a.type === 'ADVANCE' && a.unitId === activeUnitId) return true
  }
  return false
}

type SelectionMode = 'none' | 'moving' | 'attacking' | 'dashing' | 'using_ability' | 'playing_card'
type AppScreen = 'auth' | 'lobby' | 'waiting' | 'squad_selection' | 'setup' | 'playing'

export default function App() {
  const gameData = useGameData()

  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<{ username: string; avatar_url: string | null } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [screen, setScreen] = useState<AppScreen>('auth')
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
  const [logHoveredHexes, setLogHoveredHexes] = useState<Set<string>>(new Set())
  const [, setSquadFaction] = useState<string>('Earth Federation')
  const [selectedSquad, setSelectedSquad] = useState<string[]>([])
  const [selectedDeck, setSelectedDeck] = useState<string[]>([])
  const [squadStep, setSquadStep] = useState<'units' | 'deck'>('units')
  const [squadSubmitted, setSquadSubmitted] = useState(false)
  const [setupConfirmed, setSetupConfirmed] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [lobbyMode, setLobbyMode] = useState<'main' | 'private'>('main')
  const [showProfile, setShowProfile] = useState(false)
  const [needsUsernameSetup, setNeedsUsernameSetup] = useState(false)
  const [usernameSuggestion, setUsernameSuggestion] = useState('')

  const gameStateRef = useRef<GameState | null>(null)
  const lastActionRef = useRef<'moving' | 'dashing' | null>(null)
  const { toasts, addToast } = useToasts()

  useEffect(() => { gameStateRef.current = gameState }, [gameState])

  const clearSelection = useCallback(() => {
    setSelectedUnitId(null)
    setSelectionMode('none')
    setReachableHexes(new Set())
    setAttackableHexes(new Set())
    setDiceResult(null)
    setSelectedWeaponIndex(null)
    setPendingAbilityIndex(null)
    setPendingCardId(null)
    lastActionRef.current = null
  }, [])

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function applySession(u: User) {
      setUser(u)
      const { data: prof } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', u.id)
        .maybeSingle()
      if (prof) {
        setProfile(prof)
        setPlayerName(prof.username)
        if (/^player_[0-9a-f]{8}$/.test(prof.username)) {
          const meta = u.user_metadata
          const suggestion = (
            (meta?.full_name as string) || (meta?.name as string) || (meta?.user_name as string) || ''
          ).trim().slice(0, 32)
          setUsernameSuggestion(suggestion)
          setNeedsUsernameSetup(true)
        }
      } else {
        const meta = u.user_metadata
        const suggestion = (
          (meta?.full_name as string) || (meta?.name as string) || (meta?.user_name as string) || ''
        ).trim().slice(0, 32)
        setUsernameSuggestion(suggestion)
        setNeedsUsernameSetup(true)
        setPlayerName(suggestion || 'Piloto')
      }
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await applySession(session.user)
        socket.connect()
        setScreen('lobby')
      }
      setAuthLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await applySession(session.user)
        if (!socket.connected) socket.connect()
        setScreen('lobby')
        setAuthLoading(false)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        socket.disconnect()
        setScreen('auth')
      } else if (event === 'TOKEN_REFRESHED' && socket.connected) {
        socket.disconnect()
        socket.connect()
      }
    })

    return () => subscription.unsubscribe()
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
    socket.on('connect_error', (err) => {
      if (['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_ERROR'].includes(err.message)) {
        setUser(null)
        setScreen('auth')
      }
    })

    socket.on('ROOM_CREATED', ({ roomId, playerId }: { roomId: string; playerId: 'player1' | 'player2' }) => {
      setRoomId(roomId)
      setMyPlayerId(playerId)
      sessionStorage.setItem('reconnectData', JSON.stringify({ roomId, playerId }))
      setScreen('waiting')
    })

    socket.on('JOIN_ERROR', ({ message }: { message: string }) => setLobbyError(message))
    socket.on('MATCH_SEARCHING', () => setIsSearching(true))
    socket.on('MATCH_CANCELLED', () => setIsSearching(false))

    socket.on('SQUAD_SELECTION_STARTED', ({ playerId, faction, roomId: rId }: { playerId: 'player1' | 'player2'; faction: string; roomId: string }) => {
      setMyPlayerId(playerId)
      setRoomId(rId)
      setSquadFaction(faction)
      setSelectedSquad([])
      setSelectedDeck([])
      setSquadStep('units')
      setSquadSubmitted(false)
      setIsSearching(false)
      setLobbyMode('main')
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

    socket.on('GAME_STATE_UPDATE', ({ gameState: newState, diceRolls }: { gameState: GameState; diceRolls?: number[] }) => {
      const prevState = gameStateRef.current

      if (prevState) {
        if (prevState.activeUnitId !== newState.activeUnitId && newState.activeUnitId) {
          const unit = newState.units[newState.activeUnitId]
          const player = newState.players[newState.activePlayerId]
          const color = newState.activePlayerId === 'player1' ? '#4fc3f7' : '#ef9a9a'
          addToast(`Turno: ${unit?.name ?? '?'} — ${player?.name}`, color)
          setHasMoved(false)
          setHasUsedPrimary(false)
        }

        Object.values(newState.units).forEach(unit => {
          const prev = prevState.units[unit.id]
          if (prev && prev.currentHp > 0 && unit.currentHp <= 0)
            addToast(`¡${unit.name} eliminado!`, '#ef5350', 4000)
        })

        Object.values(newState.board).forEach(hex => {
          if (!hex.objectiveToken) return
          const prevHex = prevState.board[hexKey(hex.coord)]
          if (!prevHex?.objectiveToken) return
          const prev = prevHex.objectiveToken.controlledBy
          const next = hex.objectiveToken.controlledBy
          if (prev !== next && next) {
            addToast(`¡Objetivo capturado por ${newState.players[next].name}!`, '#f5c518', 4000)
          }
        })

        Object.values(prevState.board).forEach(hex => {
          if (!hex.garrisonToken) return
          const newHex = newState.board[hexKey(hex.coord)]
          if (!newHex?.garrisonToken) addToast('¡Garrison rescatada! +2 VP', '#81c784')
        })

        if (prevState.phase === 'phase1' && newState.phase === 'phase2')
          addToast('¡Fase 2! — Timeline reiniciado', '#ab47bc', 5000)

        if (newState.activeUnitId) {
          const prevUnit = prevState.units[newState.activeUnitId]
          const newUnit = newState.units[newState.activeUnitId]
          if (prevUnit && newUnit) {
            if (newUnit.upgrades.length > prevUnit.upgrades.length) {
              const gained = newUnit.upgrades[newUnit.upgrades.length - 1]
              const labels: Record<string, string> = {
                attack: '⚔ Upgrade de Ataque obtenido', shield: '🛡 Upgrade de Escudo obtenido',
                movement: '👟 Upgrade de Movimiento obtenido', energy: '⚡ Upgrade de Energía obtenido',
              }
              addToast(labels[gained.type] ?? `Upgrade: ${gained.type}`, '#81c784')
            } else if (newUnit.energy > prevUnit.energy) {
              addToast('⚡ Energía obtenida', '#f5c518')
            }

            const prevPos = prevUnit.position
            const newPos = newUnit.position
            const moved = prevPos && newPos && (prevPos.q !== newPos.q || prevPos.r !== newPos.r)
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
                    if (other.playerId === newUnit.playerId || other.currentHp <= 0 || !other.position) continue
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
      }

      if (newState.phase === 'phase1' && prevState?.phase !== 'phase1') {
        setScreen('playing')
        setSetupConfirmed(false)
        setMessage('¡Partida iniciada!')
      }

      setGameState(newState)
      if (diceRolls) setDiceResult(diceRolls)
      setSelectedUnitId(prev => {
        if (newState.activeUnitId !== prev) {
          setReachableHexes(new Set())
          setAttackableHexes(new Set())
          setSelectionMode('none')
          setSelectedWeaponIndex(null)
          setPanelUnitId(null)
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
        : `Empate — ${reason}`)
      clearSelection()
    })

    socket.on('ACTION_ERROR', ({ message }: { message: string }) => {
      setMessage(`Error: ${message}`)
      lastActionRef.current = null
      setSelectionMode('none')
      setReachableHexes(new Set())
      setAttackableHexes(new Set())
    })

    socket.on('OPPONENT_DISCONNECTED', ({ message }: { message: string }) => setMessage(message))
    socket.on('OPPONENT_RECONNECTED', ({ message }: { message: string }) => setMessage(message))
    socket.on('OPPONENT_ABANDONED', ({ message }: { message: string }) => {
      setMessage(message)
      sessionStorage.removeItem('reconnectData')
    })

    socket.on('RECONNECT_SUCCESS', ({ playerId, roomId: rId, roomStatus, gameState: gs, faction, squadSubmitted: submitted }: {
      playerId: 'player1' | 'player2'; roomId: string; roomStatus: string
      gameState?: GameState; faction: string; squadSubmitted: boolean
    }) => {
      setMyPlayerId(playerId)
      setRoomId(rId)
      if (roomStatus === 'waiting') {
        setScreen('waiting')
      } else if (roomStatus === 'squad_selection') {
        setSquadFaction(faction)
        setSquadSubmitted(submitted)
        if (!submitted) { setSelectedSquad([]); setSelectedDeck([]); setSquadStep('units') }
        setScreen('squad_selection')
      } else if (roomStatus === 'playing' && gs) {
        setGameState(gs)
        setHasUsedPrimary(gs.hasUsedPrimaryAction)
        setHasMoved(inferHasMoved(gs.actionLog, gs.activeUnitId))
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
      setHasMoved(false)
      setHasUsedPrimary(false)
    })

    return () => {
      socket.off('connect'); socket.off('disconnect'); socket.off('connect_error')
      socket.off('ROOM_CREATED'); socket.off('JOIN_ERROR'); socket.off('MATCH_SEARCHING')
      socket.off('MATCH_CANCELLED'); socket.off('SQUAD_SELECTION_STARTED'); socket.off('GAME_STARTED')
      socket.off('GAME_STATE_UPDATE'); socket.off('GAME_OVER'); socket.off('ACTION_ERROR')
      socket.off('OPPONENT_DISCONNECTED'); socket.off('OPPONENT_RECONNECTED'); socket.off('OPPONENT_ABANDONED')
      socket.off('RECONNECT_SUCCESS'); socket.off('RECONNECT_FAILED'); socket.off('PHASE_TRANSITION')
    }
  }, [clearSelection, addToast])

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  const calcReachable = useCallback((unitId: string, state: GameState) => {
    const unit = state.units[unitId]
    if (!unit?.position) return new Set<string>()
    const obstacles = new Set(
      Object.values(state.units)
        .filter(u => u.id !== unitId && u.currentHp > 0 && u.position && u.playerId !== unit.playerId)
        .map(u => hexKey(u.position!))
    )
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
      if (other.playerId === unit.playerId || other.currentHp <= 0 || !other.position) continue
      const dist = gridDistance(unit.position, other.position)
      if (dist > weapon.range) continue
      if (dist > 1) {
        const los = checkLineOfSight(unit.position, other.position, state.board, unit.playerId as 'player1' | 'player2', enemyIds)
        if (!los.clear) continue
      }
      attackable.add(hexKey(other.position))
    }
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
      if (!hex.garrisonToken || hex.garrisonToken.owner !== playerId) continue
      if (gridDistance(unit.position, hex.coord) <= 1) return true
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
      socket.emit('GAME_ACTION', { action: { type: 'ATTACK', unitId: selectedUnitId, weaponIndex: selectedWeaponIndex ?? 0, targetId: unitId } })
      clearSelection()
      setHasUsedPrimary(true)
      return
    }

    if (selectionMode === 'using_ability' && selectedUnitId && pendingAbilityIndex !== null && unit.playerId !== myPlayerId) {
      socket.emit('GAME_ACTION', { action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex: pendingAbilityIndex, targetId: unitId } })
      clearSelection()
      setHasUsedPrimary(true)
      return
    }

    if (selectionMode === 'playing_card' && selectedUnitId && pendingCardId !== null && unit.playerId !== myPlayerId) {
      socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId: selectedUnitId, cardId: pendingCardId, targetId: unitId } })
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

    if (selectionMode === 'attacking' && attackableHexes.has(key)) {
      const hex = gameState.board[key]
      if (hex?.garrisonToken && hex.garrisonToken.owner !== myPlayerId) {
        socket.emit('GAME_ACTION', { action: { type: 'ATTACK_GARRISON', unitId: selectedUnitId, weaponIndex: selectedWeaponIndex ?? 0, garrisonId: hex.garrisonToken.id } })
        clearSelection()
        setHasUsedPrimary(true)
        return
      }
    }

    if (!reachableHexes.has(key)) return
    const [q, r] = key.split(',').map(Number)

    if (selectionMode === 'moving') {
      lastActionRef.current = 'moving'
      socket.emit('GAME_ACTION', { action: { type: 'ADVANCE', unitId: selectedUnitId, to: { q, r } } })
      setReachableHexes(new Set())
      setSelectionMode('none')
    }
    if (selectionMode === 'dashing') {
      lastActionRef.current = 'dashing'
      socket.emit('GAME_ACTION', { action: { type: 'DASH', unitId: selectedUnitId, to: { q, r } } })
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

    socket.emit('GAME_ACTION', { action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex } })
    clearSelection()
    setHasUsedPrimary(true)
  }, [gameState, selectedUnitId, myPlayerId, clearSelection])

  const handlePlayCard = useCallback((cardId: string) => {
    if (!gameState || !myPlayerId) return

    if (gameState.pendingResponse?.forPlayerId === myPlayerId) {
      socket.emit('GAME_ACTION', { action: { type: 'PLAY_RESPONSE', cardId } })
      setMessage('Carta RSP jugada')
      return
    }

    const unitId = selectedUnitId ?? gameState.activeUnitId
    if (!unitId) return
    const unit = gameState.units[unitId]
    if (!unit || unit.playerId !== myPlayerId) { setMessage('No tienes una unidad activa'); return }

    const card = gameState.players[myPlayerId].tactics.hand.find(c => c.id === cardId)
    if (!card) return
    if (!card.effectData) { setMessage(`"${card.name}" no está implementada aún`); return }

    const needsTarget = card.effectData.type === 'destroy_upgrade_and_slow' ||
                        card.effectData.type === 'destroy_upgrade_and_fracture' ||
                        card.effectData.type === 'move_and_push'

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

    socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId, cardId } })
    setMessage(`Carta jugada: ${card.name}`)
  }, [gameState, selectedUnitId, myPlayerId])

  const handlePassResponse = useCallback(() => {
    socket.emit('GAME_ACTION', { action: { type: 'PASS_RESPONSE' } })
  }, [])

  const handleEndTurn = useCallback(() => {
    if (!selectedUnitId) return
    socket.emit('GAME_ACTION', { action: { type: 'END_ACTIVATION', unitId: selectedUnitId } })
    clearSelection()
  }, [selectedUnitId, clearSelection])

  const handleRescue = useCallback(() => {
    if (!selectedUnitId || !gameState || !myPlayerId) return
    const unit = gameState.units[selectedUnitId]
    if (!unit?.position) return
    for (const hex of Object.values(gameState.board)) {
      if (!hex.garrisonToken || hex.garrisonToken.owner !== myPlayerId) continue
      if (gridDistance(unit.position, hex.coord) <= 1) {
        socket.emit('GAME_ACTION', { action: { type: 'RESCUE', unitId: selectedUnitId, garrisonId: hex.garrisonToken.id } })
        setHasUsedPrimary(true)
        setMessage('Garrison rescatada — +2 VP')
        return
      }
    }
  }, [selectedUnitId, gameState, myPlayerId])

  // ─── PREVIEW MODE (dev only) ─────────────────────────────────────────────
  // Acceso: localhost:5173?preview  (solo funciona en desarrollo, nunca en prod)
  // Para quitar: elimina este bloque + la línea de import de GameScreenPreview arriba
  if (import.meta.env.DEV && location.search.includes('preview')) {
    return <GameScreenPreview />
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ─── PANTALLAS PREVIAS ────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: '#4fc3f7', marginBottom: 8 }}>GUNDAM ASSEMBLE</div>
        <div style={{ color: '#666' }}>Verificando sesión...</div>
      </div>
    </div>
  )

  if (screen === 'auth' || !user) return <AuthScreen />

  if (needsUsernameSetup) return (
    <UsernameSetupModal
      user={user}
      suggestion={usernameSuggestion}
      onDone={username => {
        const p = { username, avatar_url: profile?.avatar_url ?? null }
        setProfile(p)
        setPlayerName(username)
        setNeedsUsernameSetup(false)
      }}
    />
  )

  if (!gameData.loaded) return (
    <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: '#4fc3f7', marginBottom: 8 }}>GUNDAM ASSEMBLE</div>
        <div style={{ color: '#666' }}>Cargando datos...</div>
      </div>
    </div>
  )

  if (gameData.error) return (
    <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef5350' }}>
      Error cargando datos: {gameData.error}
    </div>
  )

  if (screen === 'lobby') return (
    <>
      <LobbyScreen
        user={user}
        profile={profile}
        connected={connected}
        playerName={playerName}
        onPlayerNameChange={setPlayerName}
        isSearching={isSearching}
        lobbyMode={lobbyMode}
        onSetLobbyMode={setLobbyMode}
        lobbyError={lobbyError}
        onClearLobbyError={() => setLobbyError('')}
        roomInput={roomInput}
        onRoomInputChange={setRoomInput}
        showProfile={showProfile}
        onShowProfile={setShowProfile}
        onProfileUpdated={p => { setProfile(p); setPlayerName(p.username) }}
        onFindMatch={() => socket.emit('FIND_MATCH', { playerName: playerName.trim() })}
        onCancelMatch={() => socket.emit('CANCEL_MATCH')}
        onCreateRoom={() => socket.emit('CREATE_ROOM', { playerName: playerName.trim() })}
        onJoinRoom={() => { setLobbyError(''); socket.emit('JOIN_ROOM', { roomId: roomInput.trim(), playerName: playerName.trim() }) }}
      />
      {showProfile && (
        <ProfileModal
          user={user}
          profile={profile}
          onClose={() => setShowProfile(false)}
          onProfileUpdated={p => { setProfile(p); setPlayerName(p.username) }}
        />
      )}
    </>
  )

  if (screen === 'waiting') return <WaitingScreen roomId={roomId} />

  if (screen === 'squad_selection') return (
    <SquadSelectionScreen
      playerName={playerName}
      myPlayerId={myPlayerId ?? 'player1'}
      availableUnitCards={gameData.allUnitCards}
      availableTacticsCards={gameData.allTacticsCards}
      selectedSquad={selectedSquad}
      onToggleUnit={cardId => {
        if (selectedSquad.includes(cardId)) setSelectedSquad(prev => prev.filter(id => id !== cardId))
        else if (selectedSquad.length < 3) setSelectedSquad(prev => [...prev, cardId])
      }}
      selectedDeck={selectedDeck}
      onToggleCard={cardId => {
        if (selectedDeck.includes(cardId)) setSelectedDeck(prev => prev.filter(id => id !== cardId))
        else setSelectedDeck(prev => [...prev, cardId])
      }}
      squadStep={squadStep}
      onSetSquadStep={setSquadStep}
      squadSubmitted={squadSubmitted}
      onConfirm={(unitCardIds, cardIds) => {
        socket.emit('SELECT_SQUAD', { unitCardIds, cardIds })
        setSquadSubmitted(true)
      }}
    />
  )

  if (screen === 'setup' && gameState) return (
    <SetupScreen
      gameState={gameState}
      myPlayerId={myPlayerId}
      setupConfirmed={setupConfirmed}
      onConfirm={() => { socket.emit('CONFIRM_SETUP'); setSetupConfirmed(true) }}
      onReorderSlot={(slotRound, unitIds) => socket.emit('REORDER_SLOT', { slotRound, unitIds })}
    />
  )

  // ─── PARTIDA ──────────────────────────────────────────────────────────────
  if (!gameState) return null

  const activeUnit = gameState.activeUnitId ? gameState.units[gameState.activeUnitId] : null
  const isMyTurn = gameState.activePlayerId === myPlayerId
  const isFinished = gameState.phase === 'finished'
  const panelUnit = panelUnitId ? gameState.units[panelUnitId] : activeUnit ?? null
  const objectiveHexes = Object.values(gameState.board).filter(h => h.objectiveToken)

  const hasHandStrip = !isFinished && myPlayerId && (
    gameState.players[myPlayerId].tactics.hand.length > 0 ||
    gameState.pendingResponse?.forPlayerId === myPlayerId
  )
  const bottomOffset = hasHandStrip ? HAND_STRIP_H + 12 : 16

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a2e', display: 'flex', flexDirection: 'column' }}>

      <TimelineBar gameState={gameState} myPlayerId={myPlayerId} />

      <GameStatusBar
        gameState={gameState}
        myPlayerId={myPlayerId}
        isMyTurn={isMyTurn}
        message={message}
        diceResult={diceResult}
      />

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <GameScene
          gameState={gameState}
          myPlayerId={myPlayerId}
          selectedUnitId={selectedUnitId}
          reachableHexes={reachableHexes}
          attackableHexes={attackableHexes}
          onHexClick={handleHexClick}
          onUnitClick={handleUnitClick}
          onTokenHover={setTokenTooltip}
          logHighlightedHexes={logHoveredHexes}
        />

        <ToastContainer toasts={toasts} />

        <ObjectivesPanel objectiveHexes={objectiveHexes} players={gameState.players} />

        <ActionLog
          log={gameState.log}
          myPlayerId={myPlayerId}
          player1Name={gameState.players.player1.name}
          player2Name={gameState.players.player2.name}
          onHoverHexes={hexes => setLogHoveredHexes(hexes ? new Set(hexes) : new Set())}
        />

        {panelUnit && !isFinished && (
          <div style={{ position: 'absolute', bottom: bottomOffset, left: 16, zIndex: 15 }}>
            <UnitPanel
              unit={panelUnit}
              isActive={gameState.activeUnitId === panelUnit.id}
              isMyUnit={panelUnit.playerId === myPlayerId}
              isMyTurn={isMyTurn}
              isSelected={panelUnit?.id === selectedUnitId}
              hasMoved={hasMoved}
              hasUsedPrimary={hasUsedPrimary}
              selectedWeaponIndex={selectedWeaponIndex}
              currentTlRound={getUnitRound(gameState.timeline, panelUnit.id)}
              canRescue={selectedUnitId && myPlayerId ? calcCanRescue(selectedUnitId, gameState, myPlayerId) : false}
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
                setMessage('Dash: elige hex (2 hexes, cuesta TL)')
              }}
              onAttack={handleAttackMode}
              onUseAbility={handleUseAbility}
              onEnergize={() => {
                if (!selectedUnitId) return
                socket.emit('GAME_ACTION', { action: { type: 'ENERGIZE', unitId: selectedUnitId } })
                setHasUsedPrimary(true)
                setMessage('Energize: +1 energía')
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
          </div>
        )}

        <LegendPanel players={gameState.players} bottomOffset={bottomOffset} />

        {tokenTooltip && (
          <div style={{
            position: 'absolute', bottom: bottomOffset, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(10,10,20,0.95)', border: '1px solid #f5c518',
            borderRadius: 8, padding: '8px 16px', color: '#f5c518',
            fontSize: 13, zIndex: 20, whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            {tokenTooltip}
          </div>
        )}

        {hasHandStrip && myPlayerId && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: HAND_STRIP_H,
            background: 'rgba(5,5,12,0.97)',
            borderTop: '1px solid #1e1e2e',
            zIndex: 15,
          }}>
            <TacticsHand
              hand={gameState.players[myPlayerId].tactics.hand}
              isMyTurn={isMyTurn}
              selectedCardId={pendingCardId}
              deckCount={gameState.players[myPlayerId].tactics.deck.length}
              onPlayCard={handlePlayCard}
              pendingResponseTrigger={gameState.pendingResponse?.forPlayerId === myPlayerId ? gameState.pendingResponse.trigger : null}
              onPassResponse={handlePassResponse}
            />
          </div>
        )}
      </div>

      {isFinished && (
        <GameOverModal
          gameState={gameState}
          onReturnToLobby={() => {
            sessionStorage.removeItem('reconnectData')
            setScreen('lobby')
            setGameState(null)
            setMyPlayerId(null)
            setPanelUnitId(null)
          }}
        />
      )}
    </div>
  )
}
