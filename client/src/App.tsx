import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { io, Socket } from 'socket.io-client'
import { GameScene } from './three/GameScene'
import type { GameState, AttackPreview, ReplaySummary } from './types/gameState'
import type { Unit, Weapon } from './types/units'
import type { AreaAim } from './types/gameState'
import { aimToward, aimTargets, rotateAim, aimKey } from './game/areaAim'
import { hexKey, gridDistance } from './game/hexGrid'
import { targetAt, baseOwnerAt, reachableFor, attackableHexes as calcAttackableHexes, attackableHexesWith, canPlayResponseCard, rwsAt, rwsDeployHexes, rwsAdjacentTo, alliedRws, isEmptyHex, responseAbilityOptions } from './game/queries'
import { getNeighbors, keyToHex } from './game/hexGrid'
import { getUnitRound } from './game/timeline'
import { useGameData } from './game/useGameData'
import { fetchMapList } from './api/gameData'
import { UnitPanel } from './components/ui/UnitPanel'
import { TimelineBar } from './components/ui/TimelineBar'
import { TacticsHand } from './components/ui/TacticsHand'
import { ToastContainer } from './components/ui/Toast'
import type { ChatMessage } from './components/ui/ChatPanel'
import { SideRail } from './components/ui/SideRail'
import { DiceTray } from './components/ui/DiceTray'
import { AttackPreviewBox } from './components/ui/AttackPreviewBox'
import { useIsMobile } from './game/useIsMobile'
import { myFollowUp, followUpMoveHexes, followUpAttackHexes } from './game/followUp'
import { C, button } from './theme'
import { sfx, isMuted, setMuted } from './game/sound'
import { ChoiceModal, type ChoiceRequest } from './components/ui/ChoiceModal'
import { UPGRADE_OPTIONS } from './components/ui/choiceOptions'
import { useToasts } from './components/ui/useToasts'
import { AuthScreen } from './components/ui/AuthScreen'
import { ProfileModal } from './components/ui/ProfileModal'
import { UsernameSetupModal } from './components/ui/UsernameSetupModal'
import { GameStatusBar } from './components/ui/GameStatusBar'
import { GameOverModal } from './components/ui/GameOverModal'
import { ReplayBar } from './components/ui/ReplayBar'
import { readLink, clearLink, shareUrl, copyText } from './game/links'
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

const EMPTY_SET: Set<string> = new Set()

type SelectionMode = 'none' | 'moving' | 'attacking' | 'dashing' | 'using_ability' | 'ability_hex' | 'playing_card' | 'card_hex' | 'ally_target' | 'bit_assault'
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
  const [selectedWeaponIndex, setSelectedWeaponIndex] = useState<number | null>(null)
  const [pendingAbilityIndex, setPendingAbilityIndex] = useState<number | null>(null)
  const [pendingCardId, setPendingCardId] = useState<string | null>(null)
  const [choice, setChoice] = useState<ChoiceRequest | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [muted, setMutedState] = useState(isMuted())
  const isMobile = useIsMobile()
  // Previsión del ataque sobre el hex bajo el ratón
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; data: AttackPreview } | null>(null)
  // Iron-Blooded Tenacity: hex elegido para moverse (paso 1) antes de elegir objetivo (paso 2)
  // Plantilla de área fijada (rotada a mano o tocada en móvil); si no, sigue al ratón
  const [aimLock, setAimLock] = useState<AreaAim | null>(null)
  const [followTo, setFollowTo] = useState<{ id: string; to: { q: number; r: number } | null } | null>(null)
  const [mobileSheet, setMobileSheet] = useState<'info' | 'unit' | 'hidden' | null>(null)
  const allyPickRef = useRef<((allyId: string) => void) | null>(null)
  const [bitAssault, setBitAssault] = useState<{ unitId: string; cardId: string; queue: string[]; picks: string[] } | null>(null)
  const [tokenTooltip, setTokenTooltip] = useState<string | null>(null)
  const [logHoveredHexes, setLogHoveredHexes] = useState<Set<string>>(new Set())
  const [selectedSquad, setSelectedSquad] = useState<string[]>([])
  const [selectedDeck, setSelectedDeck] = useState<string[]>([])
  const [squadStep, setSquadStep] = useState<'units' | 'deck'>('units')
  const [squadSubmitted, setSquadSubmitted] = useState(false)
  const [setupConfirmed, setSetupConfirmed] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [lobbyMode, setLobbyMode] = useState<'main' | 'private'>('main')
  const [maps, setMaps] = useState<{ id: string; name: string; description?: string }[]>([{ id: 'DemoMap', name: 'Colina central' }])
  const [mapId, setMapId] = useState('DemoMap')
  const [squadSize, setSquadSize] = useState(3)
  useEffect(() => { fetchMapList().then(r => setMaps(r.maps)).catch(() => {}) }, [])
  const [showProfile, setShowProfile] = useState(false)
  // Espectador, revancha y repeticiones
  const [spectating, setSpectating] = useState(false)
  const [spectators, setSpectators] = useState(0)
  const [replayId, setReplayId] = useState<string | null>(null)
  const [rematch, setRematch] = useState<'none' | 'sent' | 'rival' | 'unavailable'>('none')
  const [replay, setReplay] = useState<{ id: string; summary: ReplaySummary; total: number; index: number } | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [replayLoading, setReplayLoading] = useState(false)
  const replayReq = useRef(0)
  const spectatingRef = useRef(false)
  useEffect(() => { spectatingRef.current = spectating }, [spectating])
  const pendingLink = useRef(readLink())
  const [needsUsernameSetup, setNeedsUsernameSetup] = useState(false)
  const [usernameSuggestion, setUsernameSuggestion] = useState('')

  const gameStateRef = useRef<GameState | null>(null)
  const myPlayerIdRef = useRef<'player1' | 'player2' | null>(null)
  const { toasts, addToast } = useToasts()

  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { myPlayerIdRef.current = myPlayerId }, [myPlayerId])

  const clearSelection = useCallback(() => {
    setSelectedUnitId(null)
    setSelectionMode('none')
    setReachableHexes(new Set())
    setAttackableHexes(new Set())
    setSelectedWeaponIndex(null)
    setPendingAbilityIndex(null)
    setPendingCardId(null)
    setAimLock(null)
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

    socket.on('JOIN_ERROR', ({ message }: { message: string }) => { setLobbyError(message); setLobbyMode('private') })
    socket.on('SPECTATE_ERROR', ({ message }: { message: string }) => { setLobbyError(message); setLobbyMode('private') })
    socket.on('SPECTATE_STARTED', ({ roomId: rId, gameState: gs, replayId: rid }: { roomId: string; gameState: GameState; replayId: string | null }) => {
      setSpectating(true)
      setMyPlayerId(null)
      setRoomId(rId)
      setGameState(gs)
      setReplayId(rid)
      setChat([])
      setScreen('playing')
      setMessage('Viendo la partida como espectador')
    })
    socket.on('SPECTATE_ENDED', ({ message: msg }: { message: string }) => {
      if (myPlayerIdRef.current) return
      setSpectating(false)
      setGameState(null)
      setScreen('lobby')
      addToast(msg, C.amber, 4000)
    })
    socket.on('SPECTATORS', ({ count }: { count: number }) => setSpectators(count))
    socket.on('REMATCH_REQUESTED', ({ playerId }: { playerId: string }) => {
      if (!myPlayerIdRef.current) return
      setRematch(playerId === myPlayerIdRef.current ? 'sent' : 'rival')
    })
    socket.on('REMATCH_UNAVAILABLE', () => { if (myPlayerIdRef.current) setRematch('unavailable') })
    socket.on('MATCH_SEARCHING', () => setIsSearching(true))
    socket.on('MATCH_CANCELLED', () => setIsSearching(false))

    socket.on('SQUAD_SELECTION_STARTED', ({ playerId, roomId: rId, squadSize: size }: { playerId: 'player1' | 'player2'; roomId: string; squadSize?: number }) => {
      setMyPlayerId(playerId)
      setRoomId(rId)
      setSquadSize(size ?? 3)
      setSelectedSquad([])
      setSelectedDeck([])
      setSquadStep('units')
      setSquadSubmitted(false)
      setIsSearching(false)
      setLobbyMode('main')
      setRematch('none')
      setReplayId(null)
      setGameState(null)
      setSpectating(false)
      setSpectators(0)
      sessionStorage.setItem('reconnectData', JSON.stringify({ roomId: rId, playerId }))
      setScreen('squad_selection')
    })

    socket.on('SQUAD_ACCEPTED', () => setSquadSubmitted(true))
    socket.on('CHAT_MESSAGE', (m: ChatMessage) => { setChat(prev => [...prev.slice(-99), m]); sfx.chat() })

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
        if (diceRolls?.length) sfx.dice()
        const someoneHurt = Object.values(newState.units).some(u => prevState.units[u.id] && u.position && u.currentHp < prevState.units[u.id].currentHp)
        if (someoneHurt) sfx.hit()
        const moved = Object.values(newState.units).some(u => {
          const p = prevState.units[u.id]?.position
          return p && u.position && (p.q !== u.position.q || p.r !== u.position.r)
        })
        if (moved) sfx.move()
        if (prevState.activeUnitId !== newState.activeUnitId && newState.activeUnitId) {
          if (newState.activePlayerId === myPlayerIdRef.current) sfx.myTurn()
          const unit = newState.units[newState.activeUnitId]
          const mine = newState.activePlayerId === myPlayerIdRef.current
          setMessage('')
          addToast(mine ? `Tu turno: ${unit?.name ?? '?'}` : `Turno de ${newState.players[newState.activePlayerId]?.name}: ${unit?.name ?? '?'}`,
            mine ? C.amber : C.enemy, 2600)
        }

        Object.values(newState.units).forEach(unit => {
          const prev = prevState.units[unit.id]
          if (prev?.position && !unit.position) { addToast(`¡${unit.name} derrotado!`, C.danger, 4000); sfx.defeat() }
        })

        Object.values(newState.board).forEach(hex => {
          if (!hex.objectiveToken) return
          const prev = prevState.board[hexKey(hex.coord)]?.objectiveToken?.controlledBy
          const next = hex.objectiveToken.controlledBy
          if (prev === undefined || prev === next) return
          addToast(next ? (next === myPlayerIdRef.current ? '¡Objetivo capturado!' : `${newState.players[next].name} captura un Objetivo`) : 'Objetivo neutralizado', C.amber, 3500)
        })

        Object.values(prevState.board).forEach(hex => {
          if (hex.garrisonToken && !newState.board[hexKey(hex.coord)]?.garrisonToken) addToast('Garrison retirada del tablero (+2 VP)', C.ok)
        })

        if (newState.activeUnitId && prevState.activeUnitId === newState.activeUnitId) {
          const prevUnit = prevState.units[newState.activeUnitId]
          const newUnit = newState.units[newState.activeUnitId]
          if (prevUnit && newUnit) {
            if (newUnit.upgrades.length > prevUnit.upgrades.length) {
              const gained = newUnit.upgrades[newUnit.upgrades.length - 1]
              const labels: Record<string, string> = {
                attack: 'Strength Upgrade', shield: 'Shield Upgrade', movement: 'Speed Upgrade',
              }
              addToast(`${labels[gained.type] ?? 'Upgrade'} conseguido`, C.ok)
            } else if (newUnit.energy > prevUnit.energy) {
              addToast('+1 Energy', C.amber, 2000)
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
      // H1: al empezar la activación de una unidad tuya queda seleccionada
      // (sus acciones aparecen sin tener que pulsar el modelo)
      setSelectedUnitId(prev => {
        if (newState.activeUnitId !== prev) {
          setReachableHexes(new Set())
          setAttackableHexes(new Set())
          setSelectionMode('none')
          setSelectedWeaponIndex(null)
          setPanelUnitId(null)
          return newState.activePlayerId === myPlayerIdRef.current ? newState.activeUnitId : null
        }
        return prev
      })
    })

    socket.on('GAME_OVER', ({ gameState, winner, reason, replayId: rid }: { gameState: GameState; winner: string | null; reason: string; replayId?: string | null }) => {
      setGameState(gameState)
      setReplayId(rid ?? null)
      setMessage(winner
        ? `¡Gana ${gameState.players[winner as 'player1' | 'player2'].name}! — ${reason}`
        : `Empate — ${reason}`)
      clearSelection()
    })

    socket.on('ACTION_ERROR', ({ message }: { message: string }) => {
      setMessage(`Error: ${message}`)
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

    socket.on('RECONNECT_SUCCESS', ({ playerId, roomId: rId, roomStatus, gameState: gs, squadSubmitted: submitted, squadSize: size, replayId: rid }: {
      playerId: 'player1' | 'player2'; roomId: string; roomStatus: string
      gameState?: GameState; squadSubmitted: boolean; squadSize?: number; replayId?: string | null
    }) => {
      setReplayId(rid ?? null)
      if (size) setSquadSize(size)
      setMyPlayerId(playerId)
      setRoomId(rId)
      if (roomStatus === 'waiting') {
        setScreen('waiting')
      } else if (roomStatus === 'squad_selection') {
        setSquadSubmitted(submitted)
        if (!submitted) { setSelectedSquad([]); setSelectedDeck([]); setSquadStep('units') }
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
      socket.off('connect'); socket.off('disconnect'); socket.off('connect_error')
      socket.off('ROOM_CREATED'); socket.off('JOIN_ERROR'); socket.off('MATCH_SEARCHING')
      socket.off('MATCH_CANCELLED'); socket.off('SQUAD_SELECTION_STARTED'); socket.off('SQUAD_ACCEPTED'); socket.off('GAME_STARTED')
      socket.off('CHAT_MESSAGE')
      socket.off('GAME_STATE_UPDATE'); socket.off('GAME_OVER'); socket.off('ACTION_ERROR')
      socket.off('OPPONENT_DISCONNECTED'); socket.off('OPPONENT_RECONNECTED'); socket.off('OPPONENT_ABANDONED')
      socket.off('RECONNECT_SUCCESS'); socket.off('RECONNECT_FAILED'); socket.off('PHASE_TRANSITION')
      socket.off('SPECTATE_ERROR'); socket.off('SPECTATE_STARTED'); socket.off('SPECTATE_ENDED'); socket.off('SPECTATORS')
      socket.off('REMATCH_REQUESTED'); socket.off('REMATCH_UNAVAILABLE')
    }
  }, [clearSelection, addToast])

  // ─── REPETICIONES ─────────────────────────────────────────────────────────
  // El servidor reconstruye la partida; aquí se pide cada paso al moverse por ella.
  const seekReplay = useCallback((id: string, index: number) => {
    const req = ++replayReq.current
    setReplay(r => r && r.id === id ? { ...r, index: Math.max(0, Math.min(r.total - 1, index)) } : r)
    setReplayLoading(true)
    socket.emit('REPLAY_FRAME', { id, index }, (frame: GameState | null) => {
      if (req !== replayReq.current) return   // ya se pidió otro paso
      setReplayLoading(false)
      if (frame) setGameState(frame)
    })
  }, [])

  const openReplay = useCallback((id: string) => {
    setReplayLoading(true)
    socket.emit('REPLAY_OPEN', { id }, (r: { summary: ReplaySummary; frames: number } | null) => {
      setReplayLoading(false)
      if (!r) { addToast('No se encontró la repetición', C.danger, 4000); return }
      sessionStorage.removeItem('reconnectData')
      if (spectatingRef.current) socket.emit('STOP_SPECTATING')
      setSpectating(false)
      setMyPlayerId(null)
      setPanelUnitId(null)
      clearSelection()
      setReplay({ id, summary: r.summary, total: r.frames, index: 0 })
      setReplayPlaying(false)
      setMessage('')
      setScreen('playing')
      seekReplay(id, 0)
    })
  }, [addToast, clearSelection, seekReplay])

  const exitReplay = () => {
    setReplay(null)
    setReplayPlaying(false)
    setGameState(null)
    setScreen('lobby')
  }

  // Reproducción automática
  useEffect(() => {
    if (!replay || !replayPlaying || replayLoading) return
    if (replay.index >= replay.total - 1) { const t = setTimeout(() => setReplayPlaying(false), 0); return () => clearTimeout(t) }
    const t = setTimeout(() => seekReplay(replay.id, replay.index + 1), 1100 / replaySpeed)
    return () => clearTimeout(t)
  }, [replay, replayPlaying, replayLoading, replaySpeed, seekReplay])

  // Enlaces compartidos (?sala=, ?ver=, ?repeticion=): se usan al llegar al lobby
  useEffect(() => {
    const link = pendingLink.current
    if (!link || !connected || screen !== 'lobby') return
    pendingLink.current = null
    clearLink()
    if (link.kind === 'sala') socket.emit('JOIN_ROOM', { roomId: link.id, playerName: playerName.trim() })
    else if (link.kind === 'ver') socket.emit('SPECTATE', { roomId: link.id })
    else openReplay(link.id)
  }, [connected, screen, playerName, openReplay])

  const leaveSpectating = () => {
    socket.emit('STOP_SPECTATING')
    setSpectating(false)
    setGameState(null)
    setScreen('lobby')
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  // Los resaltados usan las mismas consultas que valida el servidor (game/queries.ts)
  const calcReachable = useCallback((unitId: string, state: GameState, kind: 'advance' | 'dash' | 'move' = 'advance', base?: number) =>
    new Set(reachableFor(state, unitId, { kind, base }).keys()), [])

  const calcAttackable = useCallback((unitId: string, state: GameState, weaponIndex: number = 0) =>
    new Set(calcAttackableHexes(state, unitId, weaponIndex)), [])

  const calcCanRescue = useCallback((unitId: string, state: GameState, playerId: 'player1' | 'player2') => {
    const unit = state.units[unitId]
    if (!unit?.position) return false
    for (const hex of Object.values(state.board)) {
      if (!hex.garrisonToken || hex.garrisonToken.owner !== playerId) continue
      if (gridDistance(unit.position, hex.coord) <= 1) return true
    }
    return false
  }, [])

  // ─── PLANTILLAS DE ÁREA ────────────────────────────────────────────────────
  // Armas "SP": el jugador orienta la cuña o centra la flor y confirma con un clic.
  const areaWeapon: Weapon | null = useMemo(() => {
    if (!gameState || !selectedUnitId || !myPlayerId) return null
    const w = selectionMode === 'attacking' ? gameState.units[selectedUnitId]?.weapons[selectedWeaponIndex ?? 0]
      : selectionMode === 'playing_card' && pendingCardId ? gameState.players[myPlayerId].tactics.hand.find(c => c.id === pendingCardId)?.weapon
        : undefined
    return w?.area ? w : null
  }, [gameState, selectedUnitId, myPlayerId, selectionMode, selectedWeaponIndex, pendingCardId])
  const currentAim = useMemo(() => !areaWeapon || !gameState || !selectedUnitId ? null
    : aimLock ?? (hoverKey ? aimToward(gameState, selectedUnitId, areaWeapon, hoverKey) : null),
  [areaWeapon, aimLock, hoverKey, gameState, selectedUnitId])
  const aimInfo = useMemo(() => currentAim && areaWeapon && gameState && selectedUnitId
    ? aimTargets(gameState, selectedUnitId, areaWeapon, currentAim, hoverKey) : null,
  [currentAim, areaWeapon, gameState, selectedUnitId, hoverKey])

  // Declara el ataque de área con la plantilla actual, o la coloca si el hex queda fuera
  const areaClick = useCallback((key: string) => {
    if (!areaWeapon || !gameState || !selectedUnitId || !myPlayerId) return
    // En móvil (sin ratón) el primer toque coloca la plantilla y el segundo ataca
    if (currentAim && (!isMobile || aimLock) && aimInfo?.primary && aimInfo.hexes.includes(key)) {
      const k = aimInfo.primary
      const unitTarget = gameState.board[k]?.occupiedBy
      const rws = rwsAt(gameState, k)
      const garrison = gameState.board[k]?.garrisonToken
      const targetId = unitTarget ?? (rws && rws.owner !== myPlayerId ? rws.id : garrison?.id)
      if (!targetId) return
      const weaponIndex = selectedWeaponIndex ?? 0
      const action = selectionMode === 'playing_card'
        ? { type: 'PLAY_CARD', unitId: selectedUnitId, cardId: pendingCardId, targetId, aim: currentAim }
        : unitTarget ? { type: 'ATTACK', unitId: selectedUnitId, weaponIndex, targetId, aim: currentAim }
          : rws && rws.owner !== myPlayerId ? { type: 'ATTACK_RWS', unitId: selectedUnitId, weaponIndex, rwsId: rws.id }
            : { type: 'ATTACK_GARRISON', unitId: selectedUnitId, weaponIndex, garrisonId: garrison!.id }
      socket.emit('GAME_ACTION', { action })
      clearSelection()
      return
    }
    const next = aimToward(gameState, selectedUnitId, areaWeapon, key)
    setAimLock(next)
    if (next) setMessage('Plantilla colocada: toca dentro de ella para atacar')
  }, [areaWeapon, gameState, selectedUnitId, myPlayerId, currentAim, aimInfo, selectedWeaponIndex, selectionMode, pendingCardId, clearSelection, isMobile, aimLock])

  // Previsión del ataque (también con la plantilla colocada)
  const previewSig = areaWeapon ? (aimInfo?.primary ? `area:${aimKey(currentAim)}:${aimInfo.primary}` : null) : hoverKey
  useEffect(() => {
    const unitId = gameState?.activeUnitId
    const attacking = selectionMode === 'attacking' || (selectionMode === 'playing_card' && !!pendingCardId)
    if (!previewSig || !unitId || !attacking) return
    const targetKey = areaWeapon ? aimInfo?.primary : hoverKey
    if (!targetKey || (!areaWeapon && !attackableHexes.has(targetKey))) return
    const aim = areaWeapon ? currentAim ?? undefined : undefined
    const req = selectionMode === 'attacking'
      ? { unitId, weaponIndex: selectedWeaponIndex ?? 0, targetKey, aim }
      : { unitId, cardId: pendingCardId, targetKey, aim }
    let alive = true
    socket.emit('PREVIEW_ATTACK', req, (p: AttackPreview | null) => { if (alive) setPreview(p ? { key: previewSig, data: p } : null) })
    return () => { alive = false }
  }, [previewSig, hoverKey, areaWeapon, aimInfo, currentAim, selectionMode, selectedWeaponIndex, pendingCardId, attackableHexes, gameState?.activeUnitId])

  // ─── ACCIONES ─────────────────────────────────────────────────────────────
  const handleUnitClick = useCallback((unitId: string) => {
    if (!gameState || !myPlayerId) return
    const unit = gameState.units[unitId]
    if (!unit) return

    setPanelUnitId(unitId)
    // Iron-Blooded Tenacity (paso 2): pulsar al enemigo lo ataca
    const fu = myFollowUp(gameState, myPlayerId)
    if (fu) {
      const step = followTo?.id === `${fu.unitId}:${gameState.log.length}` ? followTo : null
      if (step && unit.position && followUpAttackHexes(gameState, fu, step.to).has(hexKey(unit.position))) {
        socket.emit('GAME_ACTION', { action: { type: 'FOLLOW_UP', to: step.to, targetId: unit.id } })
        setFollowTo(null)
      }
      return
    }

    if (selectionMode === 'ally_target' && unit.playerId === myPlayerId && unitId !== selectedUnitId && allyPickRef.current) {
      const pick = allyPickRef.current
      allyPickRef.current = null
      setSelectionMode('none')
      setAttackableHexes(new Set())
      pick(unitId)
      return
    }

    if (areaWeapon && unit.position && (selectionMode === 'attacking' || selectionMode === 'playing_card')) {
      areaClick(hexKey(unit.position))
      return
    }

    if (selectionMode === 'attacking' && selectedUnitId && unit.playerId !== myPlayerId) {
      socket.emit('GAME_ACTION', { action: { type: 'ATTACK', unitId: selectedUnitId, weaponIndex: selectedWeaponIndex ?? 0, targetId: unitId } })
      clearSelection()
      return
    }

    if (selectionMode === 'using_ability' && selectedUnitId && pendingAbilityIndex !== null && unit.playerId !== myPlayerId) {
      socket.emit('GAME_ACTION', { action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex: pendingAbilityIndex, targetId: unitId } })
      clearSelection()
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
    setReachableHexes(gameState.activation?.advanced ? new Set() : calcReachable(unitId, gameState))
    setAttackableHexes(new Set())
    setSelectedWeaponIndex(null)
    setMessage(`${unit.name} seleccionado`)
  }, [gameState, myPlayerId, selectionMode, selectedUnitId, selectedWeaponIndex, pendingAbilityIndex, pendingCardId, calcReachable, clearSelection, followTo, areaWeapon, areaClick])

  const handleHexClick = useCallback((key: string) => {
    // Iron-Blooded Tenacity: primero el hex al que moverse, luego el enemigo
    const fu = gameState ? myFollowUp(gameState, myPlayerId) : null
    if (fu && gameState) {
      const id = `${fu.unitId}:${gameState.log.length}`
      const step = followTo?.id === id ? followTo : null
      if (!step) {
        if (followUpMoveHexes(gameState, fu).has(key)) setFollowTo({ id, to: keyToHex(key) })
      } else if (followUpAttackHexes(gameState, fu, step.to).has(key)) {
        const target = gameState.board[key]?.occupiedBy
        socket.emit('GAME_ACTION', { action: { type: 'FOLLOW_UP', to: step.to, targetId: target } })
        setFollowTo(null)
      }
      return
    }
    // Push / Pull a elegir: el servidor espera el siguiente hex de quien empuja
    const forced = gameState?.pendingForcedMove
    if (forced && forced.forPlayerId === myPlayerId) {
      const to = forced.request.options.find(o => `${o.q},${o.r}` === key)
      if (to) socket.emit('GAME_ACTION', { action: { type: 'CHOOSE_FORCED_MOVE', to } })
      return
    }
    if (!gameState || !selectedUnitId) return

    if (areaWeapon && (selectionMode === 'attacking' || selectionMode === 'playing_card')) {
      areaClick(key)
      return
    }

    if (selectionMode === 'attacking' && attackableHexes.has(key)) {
      const rws = rwsAt(gameState, key)
      if (rws && rws.owner !== myPlayerId && !gameState.board[key]?.occupiedBy) {
        socket.emit('GAME_ACTION', { action: { type: 'ATTACK_RWS', unitId: selectedUnitId, weaponIndex: selectedWeaponIndex ?? 0, rwsId: rws.id } })
        clearSelection()
        return
      }
      const hex = gameState.board[key]
      if (hex?.garrisonToken && hex.garrisonToken.owner !== myPlayerId) {
        socket.emit('GAME_ACTION', { action: { type: 'ATTACK_GARRISON', unitId: selectedUnitId, weaponIndex: selectedWeaponIndex ?? 0, garrisonId: hex.garrisonToken.id } })
        clearSelection()
        return
      }
    }

    if (selectionMode === 'playing_card' && pendingCardId && attackableHexes.has(key)) {
      const rws = rwsAt(gameState, key)
      if (rws && rws.owner !== myPlayerId && !gameState.board[key]?.occupiedBy) {
        socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId: selectedUnitId, cardId: pendingCardId, targetId: rws.id } })
        clearSelection()
        return
      }
      const hex = gameState.board[key]
      if (hex?.garrisonToken && hex.garrisonToken.owner !== myPlayerId) {
        socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId: selectedUnitId, cardId: pendingCardId, targetId: hex.garrisonToken.id } })
        clearSelection()
        return
      }
    }

    if (!reachableHexes.has(key)) return
    const [q, r] = key.split(',').map(Number)

    if (selectionMode === 'bit_assault' && bitAssault) {
      const picks = [...bitAssault.picks, `${bitAssault.queue[0]}=${key}`]
      const queue = bitAssault.queue.slice(1)
      if (queue.length === 0) {
        socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId: bitAssault.unitId, cardId: bitAssault.cardId, choices: picks } })
        setBitAssault(null)
        clearSelection()
        return
      }
      const next = new Set(reachableHexes)
      next.delete(key)
      setReachableHexes(next)
      setBitAssault({ ...bitAssault, queue, picks })
      setMessage(`Bit Assault — elige un hex vacío para ${gameState.rws[queue[0]].name}`)
      return
    }

    if (selectionMode === 'card_hex' && pendingCardId) {
      socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId: selectedUnitId, cardId: pendingCardId, targetHex: { q, r } } })
      clearSelection()
      return
    }

    if (selectionMode === 'ability_hex' && pendingAbilityIndex !== null) {
      socket.emit('GAME_ACTION', { action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex: pendingAbilityIndex, targetHex: { q, r } } })
      clearSelection()
      return
    }
    if (selectionMode === 'moving') {
      socket.emit('GAME_ACTION', { action: { type: 'ADVANCE', unitId: selectedUnitId, to: { q, r } } })
      setReachableHexes(new Set())
      setSelectionMode('none')
    }
    if (selectionMode === 'dashing') {
      socket.emit('GAME_ACTION', { action: { type: 'DASH', unitId: selectedUnitId, to: { q, r } } })
      setReachableHexes(new Set())
      setSelectionMode('none')
    }
  }, [gameState, selectedUnitId, selectionMode, reachableHexes, attackableHexes, myPlayerId, selectedWeaponIndex, pendingAbilityIndex, pendingCardId, bitAssault, clearSelection, followTo, areaWeapon, areaClick])

  const handleAttackMode = useCallback((weaponIndex: number) => {
    if (!gameState || !selectedUnitId) return
    const attackable = calcAttackable(selectedUnitId, gameState, weaponIndex)
    if (attackable.size === 0) { setMessage('No hay enemigos en rango'); return }
    setSelectedWeaponIndex(weaponIndex)
    setSelectionMode('attacking')
    setAttackableHexes(attackable)
    setReachableHexes(new Set())
    setAimLock(null)
    const weapon = gameState.units[selectedUnitId]?.weapons[weaponIndex]
    setMessage(weapon?.area
      ? `${weapon.name} — ${weapon.area === 'cone' ? 'orienta la plantilla con el ratón (o gírala)' : 'centra la plantilla en un hex a alcance'} y haz clic para atacar`
      : `${weapon?.name} — Selecciona un enemigo (rango ${weapon?.range})`)
  }, [gameState, selectedUnitId, calcAttackable])

  const handleUseAbility = useCallback((abilityIndex: number) => {
    if (!gameState || !selectedUnitId || !myPlayerId) return
    const unit = gameState.units[selectedUnitId]
    if (!unit) return
    const ability = unit.abilities[abilityIndex]
    if (!ability) return

    const data = ability.abilityData
    // Habilidades que necesitan elegir un enemigo
    if (data && (data.type === 'status_enemy' || data.type === 'push_and_damage' || data.type === 'fracture_enemy')) {
      const range = data.type === 'push_and_damage' || data.adjacentOnly ? 1 : (data.range ?? 1)
      const enemyHexes = new Set(
        Object.values(gameState.units)
          .filter(u => u.playerId !== myPlayerId && u.position && unit.position && gridDistance(unit.position, u.position) <= range)
          .map(u => hexKey(u.position!))
      )
      if (enemyHexes.size === 0) { setMessage(`${ability.name}: no hay enemigos a alcance ${range}`); return }
      setPendingAbilityIndex(abilityIndex)
      setSelectionMode('using_ability')
      setAttackableHexes(enemyHexes)
      setReachableHexes(new Set())
      setMessage(`${ability.name} — elige un enemigo`)
      return
    }
    const emitAbility = (extra: object) => {
      socket.emit('GAME_ACTION', { action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex, ...extra } })
      clearSelection()
    }
    const pickAlly = (range: number, filter: (u: Unit) => boolean, then: (allyId: string) => void) => {
      const allies = Object.values(gameState.units).filter(u => u.playerId === myPlayerId && u.id !== selectedUnitId && u.position &&
        unit.position && gridDistance(unit.position, u.position) <= range && filter(u))
      if (allies.length === 0) { setMessage(`${ability.name}: no hay aliados válidos`); return }
      allyPickRef.current = then
      setSelectionMode('ally_target')
      setAttackableHexes(new Set(allies.map(u => hexKey(u.position!))))
      setReachableHexes(new Set())
      setMessage(`${ability.name} — elige un aliado`)
    }
    // White Base Unity: aliado con ≤1 Upgrades + tipo de Upgrade
    if (data?.type === 'upgrade_ally_choice') {
      pickAlly(data.range ?? 3, u => u.upgrades.length <= (data.amount ?? 1), allyId =>
        setChoice({ kind: 'single', title: `${ability.name}: Upgrade para ${gameState.units[allyId].name}`, options: UPGRADE_OPTIONS,
          onPick: v => { setChoice(null); emitAbility({ targetId: allyId, choice: v }) } }))
      return
    }
    // Material Transfer: aliado + reparto de Upgrades
    if (data?.type === 'redistribute_upgrades') {
      pickAlly(data.range ?? 3, () => true, allyId => {
        const ally = gameState.units[allyId]
        const all = [...unit.upgrades.map(u => ({ u, owner: 'self' })), ...ally.upgrades.map(u => ({ u, owner: 'ally' }))]
        if (all.length === 0) { setMessage('Ninguna de las dos unidades tiene Upgrades'); return }
        setChoice({ kind: 'rows', title: `${ability.name}: ¿quién se queda cada Upgrade?`,
          rows: all.map((x, i) => ({ id: String(i), label: x.u.type })),
          options: [{ value: 'self', label: unit.name }, { value: 'ally', label: ally.name }],
          initial: all.map(x => x.owner),
          onConfirm: vals => { setChoice(null); emitAbility({ targetId: allyId, choices: vals }) } })
      })
      return
    }
    // Zeon Zealotry: mover hasta 5 ignorando el terreno, acercándose a un enemigo dañado
    if (data?.type === 'move_toward_damaged' && unit.position) {
      const damaged = Object.values(gameState.units).filter(u => u.playerId !== myPlayerId && u.position && u.currentHp < u.maxHp)
      const hexes = new Set([...reachableFor(gameState, selectedUnitId, { kind: 'move', base: data.amount ?? 5, ignoreTerrain: true }).keys()]
        .filter(k => damaged.some(e => gridDistance(keyToHex(k), e.position!) < gridDistance(unit.position!, e.position!))))
      if (hexes.size === 0) { setMessage(`${ability.name}: no hay destinos que acerquen a un enemigo dañado`); return }
      setPendingAbilityIndex(abilityIndex)
      setSelectionMode('ability_hex')
      setReachableHexes(hexes)
      setAttackableHexes(new Set())
      setMessage(`${ability.name} — elige el hex de destino`)
      return
    }
    // Desplegar o recolocar una RWS: elegir un hex vacío a alcance
    if (data?.type === 'deploy_rws') {
      const hexes = new Set(rwsDeployHexes(gameState, selectedUnitId, data.range ?? 3))
      if (hexes.size === 0) { setMessage(`${ability.name}: no hay hexes vacíos a alcance`); return }
      setPendingAbilityIndex(abilityIndex)
      setSelectionMode('ability_hex')
      setReachableHexes(hexes)
      setAttackableHexes(new Set())
      setMessage(`${ability.name} — elige un hex vacío`)
      return
    }
    // Habilidades "Move N": elegir el hex de destino
    if (data && (data.type === 'move' || data.type === 'self_damage_move')) {
      const amount = data.type === 'move' ? (data.amount ?? 2) : (data.range ?? 2)
      const hexes = calcReachable(selectedUnitId, gameState, 'move', amount)
      if (hexes.size === 0) { setMessage(`${ability.name}: no hay hexes alcanzables`); return }
      setPendingAbilityIndex(abilityIndex)
      setSelectionMode('ability_hex')
      setReachableHexes(hexes)
      setAttackableHexes(new Set())
      setMessage(`${ability.name} — elige el hex de destino`)
      return
    }

    socket.emit('GAME_ACTION', { action: { type: 'USE_ABILITY', unitId: selectedUnitId, abilityIndex } })
    setMessage(`${ability.name} usada`)
  }, [gameState, selectedUnitId, myPlayerId, calcReachable, clearSelection])

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
    if (gameState.activation?.cardPlayed) { setMessage('Ya jugaste una carta en esta activación'); return }
    if (card.signature && card.signature !== unit.signature) { setMessage(`Solo "${card.signature}" puede jugar esta carta`); return }

    const startTargeting = (hexes: Set<string>, mode: SelectionMode, what: string) => {
      if (hexes.size === 0) { setMessage(`${card.name}: no hay ${what} válidos`); return }
      setSelectedUnitId(unitId)
      setPendingCardId(cardId)
      setSelectionMode(mode)
      setAttackableHexes(mode === 'card_hex' ? new Set() : hexes)
      setReachableHexes(mode === 'card_hex' ? hexes : new Set())
      setMessage(`${card.name} — elige ${what}`)
    }

    const emitCard = (extra: object) => {
      socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId, cardId, ...extra } })
      clearSelection()
    }
    if (card.effectData?.type === 'gain_upgrade_choice') {
      setChoice({ kind: 'single', title: `${card.name}: elige la Upgrade`, options: UPGRADE_OPTIONS,
        onPick: v => { setChoice(null); emitCard({ choice: v }) } })
      return
    }
    if (card.effectData?.type === 'special_ops') {
      const lb = Object.values(gameState.units).filter(u => u.playerId === myPlayerId && u.position && u.traits.includes('Londo Bell'))
      if (lb.length === 0) { setMessage('No tienes unidades Londo Bell en el tablero'); return }
      setChoice({ kind: 'rows', title: `${card.name}: una Upgrade distinta para cada unidad`,
        rows: lb.map(u => ({ id: u.id, label: u.name })),
        options: [{ value: '', label: 'Nada' }, ...UPGRADE_OPTIONS],
        initial: lb.map((_, i) => UPGRADE_OPTIONS[i]?.value ?? ''),
        onConfirm: vals => { setChoice(null); emitCard({ choices: lb.map((u, i) => `${u.id}=${vals[i]}`).filter((_, i) => vals[i]) }) } })
      return
    }
    if (card.effectData?.type === 'bit_assault') {
      const onBoard = Object.values(gameState.rws).filter(r => r.position)
      if (onBoard.length === 0) { setMessage('No hay RWS en el tablero'); return }
      // Destinos: hexes vacíos contando como libres los que ocupan ahora las RWS
      const empty = new Set(Object.keys(gameState.board).filter(k => isEmptyHex(gameState, k) || onBoard.some(r => hexKey(r.position!) === k)))
      setSelectedUnitId(unitId)
      setPendingCardId(cardId)
      setBitAssault({ unitId, cardId, queue: onBoard.map(r => r.id), picks: [] })
      setSelectionMode('bit_assault')
      setReachableHexes(empty)
      setAttackableHexes(new Set())
      setMessage(`Bit Assault — elige un hex vacío para ${onBoard[0].name}`)
      return
    }

    // Carta Attack: objetivos según el arma de la carta
    if (card.type === 'attack') {
      if (!card.weapon) { setMessage(`"${card.name}" no está implementada aún`); return }
      if (gameState.hasUsedPrimaryAction) { setMessage('Las cartas Attack sustituyen al ataque primario, que ya usaste'); return }
      setAimLock(null)
      startTargeting(new Set(attackableHexesWith(gameState, unitId, card.weapon)), 'playing_card', card.weapon.area ? 'la colocación de la plantilla' : 'un objetivo')
      return
    }
    const e = card.effectData
    if (!e) { setMessage(`"${card.name}" no está implementada aún`); return }

    // Cartas que necesitan un enemigo
    const enemyTarget: Record<string, number> = {
      destroy_upgrade_and_slow: e.range ?? 3, destroy_upgrade_and_fracture: e.range ?? 3, move_and_push: 3,
      status_adjacent: 1, push_adjacent: 1, damage_per_own_upgrade: e.range ?? 2, steal_upgrade: e.range ?? 3,
    }
    if (e.type in enemyTarget && unit.position) {
      const range = enemyTarget[e.type]
      startTargeting(new Set(Object.values(gameState.units)
        .filter(u => u.playerId !== myPlayerId && u.position && gridDistance(unit.position!, u.position) <= range)
        .map(u => hexKey(u.position!))), 'playing_card', 'un enemigo')
      return
    }
    // Dismantle: enemigo junto a una RWS aliada
    if (e.type === 'dismantle') {
      startTargeting(new Set(Object.values(gameState.units)
        .filter(u => u.playerId !== myPlayerId && u.position && rwsAdjacentTo(gameState, hexKey(u.position), myPlayerId).length > 0)
        .map(u => hexKey(u.position!))), 'playing_card', 'un enemigo junto a tu RWS')
      return
    }
    // Iśvara Assault: hex vacío junto a tu RWS
    if (e.type === 'reposition_near_rws') {
      const own = alliedRws(gameState, myPlayerId, e.rws).find(r => r.ownerUnitId === unitId)
      startTargeting(new Set(own ? getNeighbors(own.position!).map(hexKey).filter(k => isEmptyHex(gameState, k)) : []), 'card_hex', 'un hex junto a tu RWS')
      return
    }
    // Cartas de movimiento: elegir el hex de destino
    if (e.type === 'move' || e.type === 'move_and_rescue') {
      startTargeting(calcReachable(unitId, gameState, 'move', e.amount ?? 2), 'card_hex', 'el hex de destino')
      return
    }

    socket.emit('GAME_ACTION', { action: { type: 'PLAY_CARD', unitId, cardId } })
    setMessage(`Carta jugada: ${card.name}`)
  }, [gameState, selectedUnitId, myPlayerId, calcReachable, clearSelection])

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
        setMessage('Rescate solicitado')
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
        onCreateRoom={() => socket.emit('CREATE_ROOM', { playerName: playerName.trim(), mapId, squadSize })}
        onPlayBot={level => socket.emit('PLAY_BOT', { playerName: playerName.trim(), mapId, squadSize, level })}
        maps={maps}
        mapId={mapId}
        onMapIdChange={setMapId}
        squadSize={squadSize}
        onSquadSizeChange={setSquadSize}
        onJoinRoom={() => { setLobbyError(''); socket.emit('JOIN_ROOM', { roomId: roomInput.trim(), playerName: playerName.trim() }) }}
        onSpectate={() => { setLobbyError(''); socket.emit('SPECTATE', { roomId: roomInput.trim() }) }}
        onListReplays={() => new Promise<ReplaySummary[]>(res => socket.emit('REPLAY_LIST', {}, res))}
        onOpenReplay={openReplay}
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
      squadSize={squadSize}
      playerName={playerName}
      myPlayerId={myPlayerId ?? 'player1'}
      availableUnitCards={gameData.allUnitCards}
      availableTacticsCards={gameData.allTacticsCards}
      selectedSquad={selectedSquad}
      onToggleUnit={cardId => {
        // Las unidades Mass Produced admiten copias: cada clic añade una mientras quepa.
        const card = gameData.allUnitCards.find(c => c.cardId === cardId)
        const copies = selectedSquad.filter(id => id === cardId).length
        const mass = card?.traits.includes('Mass Produced') ?? false
        if (copies > 0 && (!mass || selectedSquad.length >= squadSize)) setSelectedSquad(prev => prev.filter(id => id !== cardId))
        else if (selectedSquad.length < squadSize) setSelectedSquad(prev => [...prev, cardId])
        setSelectedDeck([])
      }}
      selectedDeck={selectedDeck}
      onToggleCard={cardId => {
        if (selectedDeck.includes(cardId)) setSelectedDeck(prev => prev.filter(id => id !== cardId))
        else setSelectedDeck(prev => [...prev, cardId])
      }}
      squadStep={squadStep}
      onSetSquadStep={setSquadStep}
      squadSubmitted={squadSubmitted}
      onConfirm={(unitCardIds, cardIds) => socket.emit('SELECT_SQUAD', { unitCardIds, cardIds })}
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

  const hasHandStrip = !isFinished && myPlayerId && (
    gameState.players[myPlayerId].tactics.hand.length > 0 ||
    gameState.pendingResponse?.forPlayerId === myPlayerId
  )

  // Push / Pull pendiente de elegir hex (Q&A 7: se puede mover menos, incluso 0)
  const forced = gameState.pendingForcedMove ?? null
  const myForced = forced && forced.forPlayerId === myPlayerId ? forced : null
  const forcedUnitName = forced ? gameState.units[forced.request.unitId]?.name ?? 'la unidad' : ''
  const forcedHexes = myForced ? new Set(myForced.request.options.map(o => `${o.q},${o.r}`)) : null
  const myFU = myFollowUp(gameState, myPlayerId)
  const fuStep = myFU && followTo?.id === `${myFU.unitId}:${gameState.log.length}` ? followTo : null
  const fuMove = myFU && !fuStep ? followUpMoveHexes(gameState, myFU) : null
  const fuAttack = myFU && fuStep ? followUpAttackHexes(gameState, myFU, fuStep.to) : null
  const sendFollowUp = (targetId: string | null) => {
    socket.emit('GAME_ACTION', { action: { type: 'FOLLOW_UP', to: fuStep?.to ?? null, targetId } })
    setFollowTo(null)
  }
  const rivalFU = gameState.pendingFollowUp && !myFU && !gameState.pendingAttack && !gameState.pendingResponse ? gameState.pendingFollowUp : null
  const statusMessage = rivalFU ? `El rival resuelve ${rivalFU.source}…` : forced && !myForced
    ? `El rival está eligiendo hacia dónde mover a ${forcedUnitName}…`
    : gameState.pendingResponse && gameState.pendingResponse.forPlayerId !== myPlayerId ? 'Esperando la respuesta del rival…' : message

  const handStrip = hasHandStrip && myPlayerId && (
    <div style={{ height: isMobile ? 132 : HAND_STRIP_H, flexShrink: 0, background: `linear-gradient(180deg, ${C.bg}, ${C.bgDeep})`, borderTop: `1px solid ${C.line}`, position: 'relative', zIndex: 20 }}>
      <TacticsHand
        hand={gameState.players[myPlayerId].tactics.hand}
        isMyTurn={isMyTurn}
        selectedCardId={pendingCardId}
        deckCount={gameState.players[myPlayerId].tactics.deck.length}
        onPlayCard={handlePlayCard}
        pendingResponseTrigger={gameState.pendingResponse?.forPlayerId === myPlayerId ? gameState.pendingResponse.trigger : null}
        canRespond={c => canPlayResponseCard(gameState, myPlayerId, c)}
        onPassResponse={handlePassResponse}
        responseAbilities={responseAbilityOptions(gameState, myPlayerId).map(o => ({
          key: `${o.unitId}:${o.abilityIndex}`,
          label: `${gameState.units[o.unitId].abilities[o.abilityIndex].name} (${gameState.units[o.unitId].shortName ?? gameState.units[o.unitId].name})`,
          onUse: () => socket.emit('GAME_ACTION', { action: { type: 'USE_RESPONSE_ABILITY', unitId: o.unitId, abilityIndex: o.abilityIndex } }),
        }))}
        cardPlayed={gameState.activation?.cardPlayed ?? false}
        compact={isMobile}
      />
    </div>
  )

  const unitPanel = panelUnit && !isFinished && (
    <UnitPanel
      unit={panelUnit}
      compact={isMobile}
      mode={selectionMode}
      isActive={gameState.activeUnitId === panelUnit.id}
      // Sin bando propio (espectador, repetición) los colores siguen la vista del jugador 1, como sideColor
      isMyUnit={panelUnit.playerId === (myPlayerId ?? 'player1')}
      isMyTurn={isMyTurn}
      isSelected={panelUnit.id === selectedUnitId}
      advanced={gameState.activation?.advanced ?? false}
      usedCommands={gameState.activation?.usedCommands ?? []}
      freeDashes={gameState.activation?.freeDashes ?? 0}
      freeAttacks={gameState.activation?.freeAttacks ?? []}
      hasUsedPrimary={gameState.hasUsedPrimaryAction}
      selectedWeaponIndex={selectedWeaponIndex}
      currentTlRound={getUnitRound(gameState.timeline, panelUnit.id)}
      canRescue={myPlayerId && gameState.activeUnitId ? calcCanRescue(gameState.activeUnitId, gameState, myPlayerId) : false}
      mustLeaveBase={gameState.activeUnitId === panelUnit.id && !!panelUnit.position && baseOwnerAt(gameState, hexKey(panelUnit.position)) !== null
        && !(gameState.activation?.advanced ?? false) && reachableFor(gameState, panelUnit.id, { kind: 'advance' }).size > 0}
      onMove={() => {
        const id = gameState.activeUnitId
        if (!id) return
        setSelectedUnitId(id)
        setSelectionMode('moving')
        setReachableHexes(calcReachable(id, gameState))
        setAttackableHexes(new Set())
        setMessage('Avanzar: elige un hex resaltado')
      }}
      onDash={() => {
        const id = gameState.activeUnitId
        if (!id) return
        setSelectedUnitId(id)
        setSelectionMode('dashing')
        setReachableHexes(calcReachable(id, gameState, 'dash'))
        setAttackableHexes(new Set())
        setMessage('Dash: elige un hex resaltado')
      }}
      onAttack={handleAttackMode}
      onUseAbility={handleUseAbility}
      onEnergize={() => {
        const id = gameState.activeUnitId
        if (!id) return
        socket.emit('GAME_ACTION', { action: { type: 'ENERGIZE', unitId: id } })
        setMessage('Energize: +1 Energy')
      }}
      onRescue={handleRescue}
      onEndTurn={handleEndTurn}
      onToggleAutoResponses={myPlayerId ? enabled => socket.emit('GAME_ACTION', { action: { type: 'SET_AUTO_RESPONSES', unitId: panelUnit.id, enabled } }) : undefined}
      onCancel={() => {
        setSelectionMode('none')
        setReachableHexes(new Set())
        setAttackableHexes(new Set())
        setSelectedWeaponIndex(null)
        setMessage('')
      }}
      onClose={panelUnitId && panelUnitId !== gameState.activeUnitId ? () => setPanelUnitId(null) : undefined}
    />
  )

  return (
    <div style={{ width: '100vw', height: '100dvh', background: C.bg, display: 'flex', flexDirection: 'column', color: C.text }}>

      <TimelineBar gameState={gameState} myPlayerId={myPlayerId} compact={isMobile} />

      <GameStatusBar gameState={gameState} myPlayerId={myPlayerId} isMyTurn={isMyTurn}
        message={replay ? gameState.log[gameState.log.length - 1]?.message ?? '' : statusMessage}
        badge={replay ? 'Repetición' : spectating ? 'Espectador' : undefined}
        spectators={replay ? 0 : spectators}
        onShareSpectate={myPlayerId && roomId ? () => { copyText(shareUrl('ver', roomId)) } : undefined}
        onLeave={spectating ? leaveSpectating : undefined}
        onSurrender={myPlayerId ? () => socket.emit('GAME_ACTION', { action: { type: 'SURRENDER' } }) : undefined} />

      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <GameScene
            gameState={gameState}
            myPlayerId={myPlayerId}
            selectedUnitId={selectedUnitId}
            reachableHexes={forcedHexes ?? fuMove ?? (myFU ? EMPTY_SET : reachableHexes)}
            attackableHexes={forcedHexes ? EMPTY_SET : fuAttack ?? (myFU ? EMPTY_SET : aimInfo ? new Set(aimInfo.hexes) : attackableHexes)}
            onHexClick={handleHexClick}
            onUnitClick={handleUnitClick}
            onTokenHover={setTokenTooltip}
            logHighlightedHexes={logHoveredHexes}
            focusKey={activeUnit?.position ? hexKey(activeUnit.position) : null}
            onHexHover={setHoverKey}
            compact={isMobile}
          />
        </div>

        <DiceTray gameState={gameState} myPlayerId={myPlayerId} />
        {preview && preview.key === previewSig && (areaWeapon || attackableHexes.has(hoverKey ?? '')) && (selectionMode === 'attacking' || selectionMode === 'playing_card') && (
          <AttackPreviewBox preview={preview.data}
            targetName={(() => {
              const k = areaWeapon ? aimInfo?.primary ?? '' : preview.key
              const u = gameState.board[k]?.occupiedBy
              const name = u ? gameState.units[u].name : rwsAt(gameState, k)?.name ?? 'Garrison'
              return areaWeapon && preview.data.targets > 1 ? `${name} y ${preview.data.targets - 1} más` : name
            })()} />
        )}

        {areaWeapon && (
          <div role="dialog" aria-label="Plantilla de área" style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
            background: C.panel, border: `1px solid ${C.enemy}`, borderRadius: 8,
            padding: '8px 14px', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center',
            maxWidth: 'calc(100% - 32px)', flexWrap: 'wrap', justifyContent: 'center',
          }}>
            <span>
              <b style={{ color: C.enemy }}>{areaWeapon.name}</b>: {!currentAim
                ? (areaWeapon.area === 'cone' ? 'apunta la plantilla hacia los enemigos' : areaWeapon.areaOnTarget ? 'elige el enemigo objetivo: también alcanza a sus enemigos adyacentes' : 'elige el hex central (a alcance)')
                : aimInfo?.primary
                  ? `${aimInfo.hexes.filter(k => myPlayerId && targetAt(gameState, k, myPlayerId)).length} objetivo(s) dentro · clic dentro para atacar`
                  : 'ningún objetivo válido dentro'}
            </span>
            {areaWeapon.area === 'cone' && (
              <>
                <button type="button" aria-label="Girar a la izquierda" title="Girar a la izquierda" style={button('subtle')}
                  onClick={() => setAimLock(rotateAim(currentAim ?? { facing: 0 }, 1))}>⟲</button>
                <button type="button" aria-label="Girar a la derecha" title="Girar a la derecha" style={button('subtle')}
                  onClick={() => setAimLock(rotateAim(currentAim ?? { facing: 0 }, -1))}>⟳</button>
              </>
            )}
            {aimLock && <button type="button" onClick={() => setAimLock(null)} style={button('ghost')} title="La plantilla vuelve a seguir al ratón">Seguir al ratón</button>}
            {aimInfo?.primary && isMobile && (
              <button type="button" onClick={() => areaClick(aimInfo.primary!)} style={button('danger')}>Atacar</button>
            )}
          </div>
        )}
        <ToastContainer toasts={toasts} tooltip={tokenTooltip} />

        {myFU && (
          <div role="dialog" aria-label={myFU.source} style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
            background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 8,
            padding: '8px 14px', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center',
            maxWidth: 'calc(100% - 32px)', flexWrap: 'wrap', justifyContent: 'center',
          }}>
            <span>
              <b style={{ color: C.amber }}>{myFU.source}</b>:{' '}
              {!fuStep ? `elige un hex resaltado para mover hasta ${myFU.move}` : `elige el enemigo para ${myFU.weaponName} (Timeline 0)`}
            </span>
            {!fuStep
              ? <button onClick={() => setFollowTo({ id: `${myFU.unitId}:${gameState.log.length}`, to: null })} style={button('amber')}>No moverse</button>
              : <>
                  <button onClick={() => sendFollowUp(null)} style={button('amber')}>No atacar</button>
                  <button onClick={() => setFollowTo(null)} style={button('ghost')}>Volver</button>
                </>}
            {fuStep && fuAttack?.size === 0 && <span style={{ color: C.textSoft }}>No hay enemigos a alcance desde ahí</span>}
          </div>
        )}

        {myForced && (
          <div role="dialog" aria-label="Elegir movimiento forzado" style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
            background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 8,
            padding: '8px 14px', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center',
            maxWidth: 'calc(100% - 32px)', flexWrap: 'wrap', justifyContent: 'center',
          }}>
            <span>
              <b style={{ color: C.amber }}>{myForced.request.mode === 'push' ? 'Push' : 'Pull'}</b> de {forcedUnitName}:
              {' '}hex {myForced.request.step} de {myForced.request.total}. Elige un hex resaltado
            </span>
            <button onClick={() => socket.emit('GAME_ACTION', { action: { type: 'CHOOSE_FORCED_MOVE', to: null } })} style={button('amber')}>
              {myForced.request.step === 1 ? 'No mover' : 'Parar aquí'}
            </button>
          </div>
        )}

        {choice && <ChoiceModal request={choice} onCancel={() => { setChoice(null); clearSelection() }} />}

        {!isMobile && (
          <>
            {unitPanel && <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 15, maxHeight: 'calc(100% - 24px)', display: 'flex' }}>{unitPanel}</div>}
            <div style={{ position: 'absolute', top: 12, right: 12, bottom: 12, width: 300, zIndex: 15, display: 'flex', flexDirection: 'column' }}>
              <SideRail gameState={gameState} myPlayerId={myPlayerId} chat={chat}
                onSendChat={text => socket.emit('CHAT', { text })}
                onHoverHexes={hexes => setLogHoveredHexes(hexes ? new Set(hexes) : new Set())}
                muted={muted} onToggleMute={() => { setMuted(!muted); setMutedState(!muted) }} />
            </div>
          </>
        )}

        {isMobile && (
          <>
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 20, display: 'flex', gap: 6 }}>
              <button onClick={() => setMobileSheet(s => s === 'info' ? null : 'info')} style={button(mobileSheet === 'info' ? 'primary' : 'subtle')}>
                Objetivos · registro
              </button>
            </div>
            {mobileSheet === 'info' && (
              <div style={{ position: 'absolute', top: 50, left: 10, right: 10, bottom: 10, zIndex: 25, display: 'flex', flexDirection: 'column' }}>
                <SideRail gameState={gameState} myPlayerId={myPlayerId} chat={chat}
                  onSendChat={text => socket.emit('CHAT', { text })}
                  onHoverHexes={hexes => setLogHoveredHexes(hexes ? new Set(hexes) : new Set())}
                  muted={muted} onToggleMute={() => { setMuted(!muted); setMutedState(!muted) }} />
              </div>
            )}
            {unitPanel && mobileSheet !== 'info' && (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, padding: '0 8px 8px' }}>
                {mobileSheet === 'unit' || (isMyTurn && mobileSheet !== 'hidden') ? unitPanel : (
                  <button onClick={() => setMobileSheet('unit')} style={{ ...button('subtle'), width: '100%', padding: '9px 12px', textAlign: 'left' }}>
                    {panelUnit!.name} · ver ficha
                  </button>
                )}
                {(mobileSheet === 'unit' || (isMyTurn && mobileSheet !== 'hidden')) && (
                  <button onClick={() => setMobileSheet('hidden')} style={{ ...button('subtle'), width: '100%', marginTop: 4 }}>Ocultar ficha</button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!replay && handStrip}

      {replay && (
        <ReplayBar summary={replay.summary} index={replay.index} total={replay.total} playing={replayPlaying} speed={replaySpeed}
          loading={replayLoading} compact={isMobile}
          onSeek={i => { setReplayPlaying(false); seekReplay(replay.id, i) }}
          onTogglePlay={() => {
            if (!replayPlaying && replay.index >= replay.total - 1) seekReplay(replay.id, 0)
            setReplayPlaying(p => !p)
          }}
          onSpeed={setReplaySpeed}
          onExit={exitReplay} />
      )}

      {isFinished && !replay && (
        <GameOverModal
          gameState={gameState}
          myPlayerId={myPlayerId}
          rematch={rematch}
          onRematch={myPlayerId ? () => { setRematch('sent'); socket.emit('REMATCH') } : undefined}
          onWatchReplay={replayId ? () => openReplay(replayId) : undefined}
          onReturnToLobby={() => {
            if (spectating) socket.emit('STOP_SPECTATING')
            setSpectating(false)
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
