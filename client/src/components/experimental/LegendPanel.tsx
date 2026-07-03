import type { GameState } from '../../types/gameState'

interface LegendPanelProps {
    players: GameState['players']
    bottomOffset?: number
}

const CHAKRA = "'Chakra Petch', sans-serif"
const PLEX = "'IBM Plex Sans', system-ui, sans-serif"

const ITEMS = [
    { color: '#e3c64b', shape: 'circle',  label: 'Objetivo'     },
    { color: '#e3c64b', shape: 'diamond', label: 'Energía'      },
    { color: '#d65a52', shape: 'square',  label: 'Garrison J1'  },
    { color: '#49b0d6', shape: 'square',  label: 'Garrison J2'  },
    { color: '#d678c0', shape: 'diamond', label: 'Ataque'       },
    { color: '#5fb0e0', shape: 'triangle',label: 'Escudo'       },
    { color: '#5fc97a', shape: 'circle',  label: 'Movimiento'   },
    { color: '#7e8a92', shape: 'diamond', label: 'Oculto'       },
] as const

function ShapeIcon({ color, shape }: { color: string; shape: string }) {
    const base: React.CSSProperties = { width: 10, height: 10, background: color, flexShrink: 0, display: 'inline-block' }
    if (shape === 'circle')   return <span style={{ ...base, borderRadius: '50%' }} />
    if (shape === 'square')   return <span style={{ ...base, borderRadius: 2 }} />
    if (shape === 'diamond')  return <span style={{ ...base, clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }} />
    if (shape === 'triangle') return <span style={{ ...base, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }} />
    return <span style={base} />
}

export function LegendPanel({ players, bottomOffset: _bottomOffset }: LegendPanelProps) {
    const items = ITEMS.map(it => ({
        ...it,
        label: it.label === 'Garrison J1'
            ? `Garrison ${players.player1.name}`
            : it.label === 'Garrison J2'
            ? `Garrison ${players.player2.name}`
            : it.label,
    }))

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
            }}>LEYENDA</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 10px' }}>
                {items.map(({ color, shape, label }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ShapeIcon color={color} shape={shape} />
                        <span style={{ fontSize: 11, color: '#bcc8d0' }}>{label}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
