import type { GameState, PlayerId } from '../../types/gameState'
import type { Hex } from '../../types/board'
import { C, FONT, eyebrow, sideColor } from '../../theme'

interface ObjectivesPanelProps {
  objectiveHexes: Hex[]
  players: GameState['players']
  myPlayerId: PlayerId | null
}

// Objetivos: quién controla cada uno y cuántos VP darán al final de la fase.
export function ObjectivesPanel({ objectiveHexes, players, myPlayerId }: ObjectivesPanelProps) {
  if (objectiveHexes.length === 0) return null
  const sorted = [...objectiveHexes].sort((a, b) => a.objectiveToken!.id.localeCompare(b.objectiveToken!.id, undefined, { numeric: true }))
  const mine = sorted.filter(h => h.objectiveToken!.controlledBy === myPlayerId).reduce((n, h) => n + h.objectiveToken!.vpValue, 0)
  const theirs = sorted.filter(h => h.objectiveToken!.controlledBy && h.objectiveToken!.controlledBy !== myPlayerId).reduce((n, h) => n + h.objectiveToken!.vpValue, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={eyebrow}>Objetivos</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: C.textDim }} title="VP que daría cada bando si la fase acabara ahora">
          al cierre: <span style={{ color: C.ally }}>+{mine}</span> / <span style={{ color: C.enemy }}>+{theirs}</span>
        </span>
      </div>
      {sorted.map((hex, i) => {
        const obj = hex.objectiveToken!
        const owner = obj.controlledBy
        const color = owner ? sideColor(owner, myPlayerId) : C.textDim
        return (
          <div key={obj.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{
              width: 10, height: 10, flexShrink: 0, background: owner ? color : 'transparent',
              border: `1.5px solid ${owner ? color : C.amber}`, clipPath: 'polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)',
            }} />
            <span style={{ flex: 1 }}>Objetivo {i + 1}</span>
            <span style={{ color, fontSize: 11.5 }}>{owner ? (owner === myPlayerId ? 'Tuyo' : players[owner].name) : 'Libre'}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: C.textDim }}>{obj.vpValue} VP</span>
          </div>
        )
      })}
    </div>
  )
}
