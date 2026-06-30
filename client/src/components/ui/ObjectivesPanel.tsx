import type { GameState } from '../../types/gameState'
import type { Hex } from '../../types/board'

interface ObjectivesPanelProps {
  objectiveHexes: Hex[]
  players: GameState['players']
}

export function ObjectivesPanel({ objectiveHexes, players }: ObjectivesPanelProps) {
  if (objectiveHexes.length === 0) return null

  return (
    <div style={{
      position: 'absolute', top: 12, right: 16,
      background: 'rgba(10,10,20,0.92)', border: '1px solid #333',
      borderRadius: 8, padding: '8px 12px', color: 'white',
      fontSize: 11, zIndex: 15, minWidth: 160,
    }}>
      <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        Objetivos
      </div>
      {objectiveHexes.map(hex => {
        const obj = hex.objectiveToken!
        const controlled = obj.controlledBy
        const color = controlled === 'player1' ? '#4fc3f7' : controlled === 'player2' ? '#ef9a9a' : '#555'
        const label = controlled ? players[controlled].name : 'Sin control'
        return (
          <div key={obj.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
              boxShadow: controlled ? `0 0 4px ${color}` : 'none',
            }} />
            <span style={{ color: '#888', flex: 1 }}>{obj.id}</span>
            <span style={{ color }}>{label}</span>
            <span style={{ color: '#444', fontSize: 9 }}>+{obj.vpValue}VP</span>
          </div>
        )
      })}
    </div>
  )
}
