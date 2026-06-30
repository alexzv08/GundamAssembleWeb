import type { GameState } from '../../types/gameState'

interface LegendPanelProps {
  players: GameState['players']
  bottomOffset: number
}

const LEGEND_ITEMS = (p1Name: string, p2Name: string) => [
  { color: '#f5c518', shape: 'circle', label: 'Objetivo' },
  { color: '#ef5350', shape: 'square', label: `Garrison ${p1Name}` },
  { color: '#4fc3f7', shape: 'square', label: `Garrison ${p2Name}` },
  { color: '#ef9a9a', shape: 'diamond', label: '⚔ Ataque' },
  { color: '#4fc3f7', shape: 'diamond', label: '🛡 Escudo' },
  { color: '#81c784', shape: 'diamond', label: '👟 Movimiento' },
  { color: '#f5c518', shape: 'diamond', label: '⚡ Energía' },
  { color: '#555', shape: 'diamond', label: '❓ Oculto' },
] as const

export function LegendPanel({ players, bottomOffset }: LegendPanelProps) {
  const items = LEGEND_ITEMS(players.player1.name, players.player2.name)

  return (
    <div style={{
      position: 'absolute', bottom: bottomOffset, right: 16,
      background: 'rgba(10,10,20,0.92)', border: '1px solid #333',
      borderRadius: 8, padding: '8px 12px', color: 'white',
      fontSize: 11, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ color: '#666', fontSize: 10, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
        Leyenda
      </div>
      {items.map(({ color, shape, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 10, height: 10, background: color,
            borderRadius: shape === 'circle' ? '50%' : 0,
            transform: shape === 'diamond' ? 'rotate(45deg)' : 'none',
            flexShrink: 0,
          }} />
          <span style={{ color: color === '#555' ? '#888' : color }}>{label}</span>
        </div>
      ))}
    </div>
  )
}
