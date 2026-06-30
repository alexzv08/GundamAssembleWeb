import type { GameState } from '../../types/gameState'

interface GameOverModalProps {
  gameState: GameState
  onReturnToLobby: () => void
}

export function GameOverModal({ gameState, onReturnToLobby }: GameOverModalProps) {
  return (
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
          onClick={onReturnToLobby}
          style={{
            padding: '10px 28px', background: '#1565c0', color: 'white',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15,
          }}
        >
          Volver al lobby
        </button>
      </div>
    </div>
  )
}
