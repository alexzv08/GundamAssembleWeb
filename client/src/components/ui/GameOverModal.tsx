import type { GameState, PlayerId } from '../../types/gameState'
import { C, FONT, eyebrow, button, sideColor } from '../../theme'

interface GameOverModalProps {
  gameState: GameState
  myPlayerId?: PlayerId | null
  onReturnToLobby: () => void
  /** Revancha: 'none' sin pedir, 'sent' pedida por mí, 'rival' la pide el rival, 'unavailable' el rival se fue */
  rematch?: 'none' | 'sent' | 'rival' | 'unavailable'
  onRematch?: () => void
  onWatchReplay?: () => void
}

export function GameOverModal({ gameState, myPlayerId = null, onReturnToLobby, rematch = 'none', onRematch, onWatchReplay }: GameOverModalProps) {
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
        {rematch === 'rival' && <span style={{ color: C.amber, fontSize: 13 }}>Tu rival quiere la revancha</span>}
        {rematch === 'unavailable' && <span style={{ color: C.textSoft, fontSize: 13 }}>Tu rival ha salido de la sala</span>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {onRematch && rematch !== 'unavailable' && (
            <button onClick={onRematch} disabled={rematch === 'sent'} style={{ ...button('amber', rematch === 'sent'), padding: '10px 20px', fontSize: 14.5 }}>
              {rematch === 'sent' ? 'Esperando al rival…' : rematch === 'rival' ? 'Aceptar la revancha' : 'Revancha'}
            </button>
          )}
          {onWatchReplay && <button onClick={onWatchReplay} style={{ ...button('primary'), padding: '10px 20px', fontSize: 14.5 }}>Ver repetición</button>}
          <button onClick={onReturnToLobby} style={{ ...button(onRematch ? 'ghost' : 'amber'), padding: '10px 20px', fontSize: 14.5 }}>Volver al lobby</button>
        </div>
      </div>
    </div>
  )
}
