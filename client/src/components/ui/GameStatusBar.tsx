import { useEffect, useState } from 'react'
import type { GameState, TurnClock } from '../../types/gameState'
import { C, FONT, sideColor, button } from '../../theme'

interface GameStatusBarProps {
  gameState: GameState
  myPlayerId: 'player1' | 'player2' | null
  isMyTurn: boolean
  message: string
  onSurrender?: () => void
}

// Barra de estado: solo responde a "¿a quién le toca y qué está pasando ahora?"
// (los dados se muestran en DiceTray).
export function GameStatusBar({ gameState, myPlayerId, isMyTurn, message, onSurrender }: GameStatusBarProps) {
  const [confirm, setConfirm] = useState(false)
  const activeUnit = gameState.activeUnitId ? gameState.units[gameState.activeUnitId] : null
  const activePlayer = gameState.players[gameState.activePlayerId]
  const isFinished = gameState.phase === 'finished'
  const color = sideColor(gameState.activePlayerId, myPlayerId)

  return (
    <div style={{
      padding: '5px max(16px, env(safe-area-inset-left, 0px))', background: C.bg, color: C.text,
      fontSize: 12.5, flexShrink: 0, borderBottom: `1px solid ${C.line}`,
      display: 'flex', alignItems: 'center', gap: 12, minHeight: 30, minWidth: 0,
    }}>
      <span style={{
        fontFamily: FONT.display, fontWeight: 700, fontSize: 13.5, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: isFinished ? C.textSoft : isMyTurn ? C.amber : color, whiteSpace: 'nowrap',
        animation: isMyTurn && !isFinished ? 'ga-pulse 2.4s infinite' : undefined,
      }}>
        {isFinished ? 'Fin de la partida' : isMyTurn ? 'Tu turno' : `Turno de ${activePlayer.name}`}
      </span>
      {activeUnit && !isFinished && (
        <span style={{ color, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeUnit.name}</span>
      )}
      {message && (
        <span style={{ color: C.textSoft, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{message}</span>
      )}
      {!isFinished && gameState.turnClock && (
        <ClockBadge clock={gameState.turnClock} mine={gameState.turnClock.playerId === myPlayerId} style={{ marginLeft: message ? 0 : 'auto' }} />
      )}
      {!isFinished && onSurrender && (confirm ? (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: message || gameState.turnClock ? 0 : 'auto' }}>
          <span style={{ color: C.textSoft, fontSize: 12 }}>¿Rendirte?</span>
          <button onClick={() => { setConfirm(false); onSurrender() }} style={{ ...button('danger'), padding: '2px 9px' }}>Sí, me rindo</button>
          <button onClick={() => setConfirm(false)} style={{ ...button('ghost'), padding: '2px 9px' }}>No</button>
        </span>
      ) : (
        <button onClick={() => setConfirm(true)} style={{ ...button('ghost'), padding: '2px 9px', marginLeft: message || gameState.turnClock ? 0 : 'auto' }} title="Rendirse: el rival gana la partida">Rendirse</button>
      ))}
    </div>
  )
}

// Cuenta atrás del jugador que debe actuar. El servidor manda lo que quedaba al
// enviar el estado; el cliente descuenta desde que lo recibe.
function ClockBadge({ clock, mine, style }: { clock: TurnClock; mine: boolean; style?: React.CSSProperties }) {
  const [left, setLeft] = useState(Math.ceil(clock.remainingMs / 1000))
  useEffect(() => {
    const at = Date.now()
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((clock.remainingMs - (Date.now() - at)) / 1000))), 250)
    return () => clearInterval(t)
  }, [clock])
  const urgent = left <= 10
  const label = clock.kind === 'response' ? 'Response' : clock.kind === 'choice' ? 'Elegir' : 'Turno'
  return (
    <span title={mine ? 'Si se agota, se pasa automáticamente. Tres veces seguidas = derrota.' : 'Tiempo del rival'}
      style={{ ...style, fontFamily: FONT.mono, fontSize: 12, padding: '1px 8px', borderRadius: 4, whiteSpace: 'nowrap',
        border: `1px solid ${urgent ? C.danger : C.lineStrong}`, color: urgent ? C.danger : mine ? C.text : C.textSoft,
        animation: urgent && mine ? 'ga-pulse 1s infinite' : undefined }}>
      {label} {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  )
}
