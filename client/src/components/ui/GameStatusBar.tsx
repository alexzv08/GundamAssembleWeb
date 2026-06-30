import type { GameState } from '../../types/gameState'

interface GameStatusBarProps {
  gameState: GameState
  myPlayerId: 'player1' | 'player2' | null
  isMyTurn: boolean
  message: string
  diceResult: number[] | null
}

export function GameStatusBar({ gameState, myPlayerId: _myPlayerId, isMyTurn, message, diceResult }: GameStatusBarProps) {
  const activeUnit = gameState.activeUnitId ? gameState.units[gameState.activeUnitId] : null
  const activePlayer = gameState.players[gameState.activePlayerId]
  const isFinished = gameState.phase === 'finished'

  return (
    <div style={{
      padding: '4px 16px',
      background: 'rgba(0,0,0,0.6)', color: 'white',
      fontSize: 12, zIndex: 10, flexShrink: 0,
      borderBottom: '1px solid #111',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <span style={{ color: isMyTurn ? '#4caf50' : '#888', fontWeight: 'bold', fontSize: 13 }}>
        {isFinished ? '— FIN —' : isMyTurn ? '⚡ Tu turno' : `Turno de ${activePlayer.name}`}
      </span>
      <span style={{ color: gameState.activePlayerId === 'player1' ? '#4fc3f7' : '#ef9a9a' }}>
        {activeUnit?.name ?? '—'}
      </span>
      {message && <span style={{ color: '#f5c518', marginLeft: 'auto' }}>{message}</span>}
      {diceResult && (
        <span style={{ color: '#aaa' }}>
          [{diceResult.join(', ')}] — {diceResult.filter(r => r >= 4).length} hits
        </span>
      )}
    </div>
  )
}
