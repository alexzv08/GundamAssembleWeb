import type { GameState } from '../../types/gameState'
import { C, FONT, sideColor } from '../../theme'

interface GameStatusBarProps {
  gameState: GameState
  myPlayerId: 'player1' | 'player2' | null
  isMyTurn: boolean
  message: string
}

// Barra de estado: solo responde a "¿a quién le toca y qué está pasando ahora?"
// (los dados se muestran en DiceTray).
export function GameStatusBar({ gameState, myPlayerId, isMyTurn, message }: GameStatusBarProps) {
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
    </div>
  )
}
