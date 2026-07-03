import type { GameState } from '../../types/gameState'
import type { Hex } from '../../types/board'

interface ObjectivesPanelProps {
    objectiveHexes: Hex[]
    players: GameState['players']
}

const MONO = "'IBM Plex Mono', monospace"
const CHAKRA = "'Chakra Petch', sans-serif"
const PLEX = "'IBM Plex Sans', system-ui, sans-serif"

export function ObjectivesPanel({ objectiveHexes, players }: ObjectivesPanelProps) {
    if (objectiveHexes.length === 0) return null

    return (
        <div style={{
            background: 'rgba(13,22,36,.9)',
            border: '1px solid #20304a',
            borderRadius: 12,
            padding: '13px 14px',
            backdropFilter: 'blur(6px)',
            fontFamily: PLEX,
            color: '#dbe4ec',
            minWidth: 210,
        }}>
            <div style={{
                fontFamily: CHAKRA, fontSize: 11, color: '#9fb0bc',
                letterSpacing: 2.5, fontWeight: 600, marginBottom: 11,
            }}>OBJETIVOS</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {objectiveHexes.map(hex => {
                    const obj = hex.objectiveToken!
                    const controlled = obj.controlledBy
                    const isP1 = controlled === 'player1'
                    const isP2 = controlled === 'player2'
                    const dotColor = isP1 ? '#8fe6f7' : isP2 ? '#f0a8a8' : '#3f4d5c'
                    const labelColor = isP1 ? '#8fe6f7' : isP2 ? '#f0a8a8' : '#7e8a92'
                    const vpColor = isP1 ? '#6fc3d6' : isP2 ? '#c98' : '#5e6a72'
                    const label = controlled ? players[controlled].name : 'Sin control'

                    return (
                        <div key={obj.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{
                                width: 9, height: 9, borderRadius: '50%',
                                background: dotColor,
                                boxShadow: controlled ? `0 0 7px ${dotColor}` : 'none',
                                flexShrink: 0, display: 'inline-block',
                            }} />
                            <span style={{ fontFamily: MONO, fontSize: 12, color: '#dbe4ec', width: 46 }}>
                                {obj.id}
                            </span>
                            <span style={{ fontSize: 11, color: labelColor, fontWeight: 600, flex: 1 }}>
                                {label}
                            </span>
                            <span style={{ fontFamily: MONO, fontSize: 11, color: vpColor }}>
                                +{obj.vpValue}VP
                            </span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
