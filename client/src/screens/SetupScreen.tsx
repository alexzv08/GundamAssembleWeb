import type { GameState } from '../types/gameState'

interface SetupScreenProps {
  gameState: GameState
  myPlayerId: 'player1' | 'player2' | null
  setupConfirmed: boolean
  onConfirm: () => void
  onReorderSlot: (slotRound: number, unitIds: string[]) => void
}

export function SetupScreen({ gameState, myPlayerId, setupConfirmed, onConfirm, onReorderSlot }: SetupScreenProps) {
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
                            onReorderSlot(slot.round, newOrder)
                          }}
                          style={{ padding: '2px 8px', background: '#333', color: 'white', border: 'none', borderRadius: 4, cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.3 : 1 }}
                        >▲</button>
                        <button
                          disabled={idx === myTokens.length - 1}
                          onClick={() => {
                            const newOrder = [...myTokens.map(t => t.unitId)]
                            const tmp = newOrder[idx]; newOrder[idx] = newOrder[idx + 1]; newOrder[idx + 1] = tmp
                            onReorderSlot(slot.round, newOrder)
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
              return (
                <span key={s.round} style={{ marginLeft: 8 }}>
                  Slot {s.round}: {myTokens.map(t => gameState.units[t.unitId]?.name ?? t.unitId).join(', ')}
                </span>
              )
            })
          }
        </div>

        {setupConfirmed ? (
          <div style={{ color: '#4caf50' }}>Confirmado — esperando al oponente...</div>
        ) : (
          <button
            onClick={onConfirm}
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
