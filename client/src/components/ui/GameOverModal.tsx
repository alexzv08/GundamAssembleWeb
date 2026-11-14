import type { GameState, PlayerId } from '../../types/gameState'
import { C, FONT, eyebrow, button, sideColor } from '../../theme'

interface GameOverModalProps {
  gameState: GameState
  myPlayerId?: PlayerId | null
  onReturnToLobby: () => void
}

export function GameOverModal({ gameState, myPlayerId = null, onReturnToLobby }: GameOverModalProps) {
  const w = gameState.winner
  const won = w && w === myPlayerId
  const title = !w ? 'Empate' : myPlayerId ? (won ? 'Victoria' : 'Derrota') : `Gana ${gameState.players[w].name}`
  const color = !w ? C.textSoft : won ? C.amber : myPlayerId ? C.enemy : sideColor(w, myPlayerId)
  const order: PlayerId[] = myPlayerId === 'player2' ? ['player2', 'player1'] : ['player1', 'player2']
  return (
    <div role="dialog" aria-label="Fin de la partida" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(4,7,15,0.78)', zIndex: 120, backdropFilter: 'blur(4px)', padding: 16 }}>
      <div style={{ background: C.panel, border: `1px solid ${color}`, borderRadius: 14, padding: '28px 34px', textAlign: 'center', color: C.text, boxShadow: `0 0 60px ${color}33`, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 300, animation: 'ga-rise 220ms ease-out' }}>
        <span style={eyebrow}>Fin de la partida</span>
        <span style={{ fontFamily: FONT.display, fontSize: 46, fontWeight: 700, letterSpacing: '0.06em', color, textTransform: 'uppercase' }}>{title}</span>
        {gameState.winReason && <span style={{ color: C.textSoft, fontSize: 13 }}>{gameState.winReason}</span>}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 28 }}>
          {order.map(p => (
            <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ ...eyebrow, color: sideColor(p, myPlayerId) }}>{p === myPlayerId ? 'Tú' : gameState.players[p].name}</span>
              <span style={{ fontFamily: FONT.display, fontSize: 34, fontWeight: 700 }}>{gameState.players[p].vp}</span>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textDim }}>VP</span>
            </div>
          ))}
        </div>
        <button onClick={onReturnToLobby} style={{ ...button('amber'), padding: '10px 24px', fontSize: 14.5 }}>Volver al lobby</button>
      </div>
    </div>
  )
}
