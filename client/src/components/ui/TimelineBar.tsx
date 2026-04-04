import type { Timeline } from '../../types/timeline'
import type { GameState } from '../../types/gameState'

interface TimelineBarProps {
    gameState: GameState
    myPlayerId: 'player1' | 'player2' | null
}

export function TimelineBar({ gameState, myPlayerId }: TimelineBarProps) {
    const { timeline, units, players, activeUnitId } = gameState

    const p1Color = '#c0393a'
    const p2Color = '#3a6bc0'

    const p1Tokens = timeline.slots.map(slot => ({
        round: slot.round,
        tokens: slot.tokens.filter(t => t.playerId === 'player1'),
    }))
    const p2Tokens = timeline.slots.map(slot => ({
        round: slot.round,
        tokens: slot.tokens.filter(t => t.playerId === 'player2'),
    }))

    const currentRound = timeline.slots.find(s => s.tokens.length > 0)?.round ?? null

    const renderToken = (token: { unitId: string; playerId: 'player1' | 'player2' }, color: string) => {
        const unit = units[token.unitId]
        if (!unit) return null
        const isActive = token.unitId === activeUnitId
        const hpPercent = unit.currentHp / unit.maxHp
        const shortName = unit.name.replace('Zaku II', 'Zaku').replace('Guncannon', 'G.Cannon').replace('Guntank', 'G.Tank')

        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: isActive ? `${color}33` : `${color}18`,
                border: `1px solid ${isActive ? color : color + '66'}`,
                borderRadius: 4,
                padding: '2px 5px',
                boxShadow: isActive ? `0 0 6px ${color}88` : 'none',
                width: '100%',
            }}>
                <div style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: color, flexShrink: 0,
                    boxShadow: isActive ? `0 0 4px ${color}` : 'none',
                }} />
                <span style={{
                    fontSize: 9, color: isActive ? '#fff' : '#ccc',
                    fontWeight: isActive ? 'bold' : 'normal',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1,
                }}>
                    {shortName.split(' ')[0]}
                </span>
                <div style={{
                    width: 18, height: 3, background: '#111',
                    borderRadius: 2, flexShrink: 0, overflow: 'hidden',
                }}>
                    <div style={{
                        height: '100%',
                        width: `${hpPercent * 100}%`,
                        background: hpPercent > 0.5 ? '#4caf50' : hpPercent > 0.25 ? '#ff9800' : '#ef5350',
                    }} />
                </div>
            </div>
        )
    }

    const slotWidth = `${100 / 10}%`

    return (
        <div style={{
            display: 'flex',
            alignItems: 'stretch',
            background: 'rgba(5,5,10,0.95)',
            borderBottom: '1px solid #1a1a1a',
            flexShrink: 0,
            height: 110,
        }}>

            {/* VP Player 1 — izquierda */}
            <div style={{
                width: 110,
                background: `${p1Color}22`,
                border: `1px solid ${p1Color}66`,
                borderRight: `2px solid ${p1Color}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px 8px',
                flexShrink: 0,
            }}>
                <div style={{
                    fontSize: 9, color: p1Color, textTransform: 'uppercase',
                    letterSpacing: 1, marginBottom: 4,
                }}>
                    {myPlayerId === 'player1' ? '▶ ' : ''}Victory Points
                </div>
                <div style={{
                    fontSize: 28, fontWeight: 'bold', color: '#fff', lineHeight: 1,
                }}>
                    {players.player1.vp}
                </div>
                <div style={{
                    fontSize: 9, color: p1Color, marginTop: 4, textTransform: 'uppercase',
                    letterSpacing: 1, textAlign: 'center',
                    maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {players.player1.name}
                </div>
            </div>

            {/* Timeline central */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

                {/* Carril Player 1 (rojo) — arriba */}
                <div style={{
                    flex: 1,
                    background: `${p1Color}0d`,
                    borderBottom: `1px solid #1a1a1a`,
                    display: 'flex',
                }}>
                    {p1Tokens.map(({ round, tokens }) => (
                        <div key={round} style={{
                            width: slotWidth,
                            borderRight: '1px solid #111',
                            padding: '3px 2px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            background: round === currentRound ? `${p1Color}11` : 'transparent',
                        }}>
                            {tokens.map((token, i) => (
                                <div key={i}>{renderToken(token, p1Color)}</div>
                            ))}
                        </div>
                    ))}
                </div>

                {/* Números de round — centro */}
                <div style={{
                    height: 24,
                    background: '#0d0d0d',
                    borderTop: '1px solid #222',
                    borderBottom: '1px solid #222',
                    display: 'flex',
                }}>
                    {timeline.slots.map(slot => {
                        const isCurrent = slot.round === currentRound
                        return (
                            <div key={slot.round} style={{
                                width: slotWidth,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRight: '1px solid #1a1a1a',
                                position: 'relative',
                            }}>
                                {/* Flecha de separación */}
                                <div style={{
                                    position: 'absolute',
                                    right: -1,
                                    top: 0,
                                    bottom: 0,
                                    width: 0,
                                    borderLeft: '6px solid #0d0d0d',
                                    borderTop: '12px solid transparent',
                                    borderBottom: '12px solid transparent',
                                    zIndex: 1,
                                }} />
                                <span style={{
                                    fontSize: isCurrent ? 13 : 11,
                                    fontWeight: isCurrent ? 'bold' : 'normal',
                                    color: isCurrent ? '#f5c518' : '#555',
                                    zIndex: 2,
                                }}>
                                    {slot.round}
                                </span>
                                {isCurrent && (
                                    <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        width: 4,
                                        height: 4,
                                        borderRadius: '50%',
                                        background: '#f5c518',
                                    }} />
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* Carril Player 2 (azul) — abajo */}
                <div style={{
                    flex: 1,
                    background: `${p2Color}0d`,
                    display: 'flex',
                }}>
                    {p2Tokens.map(({ round, tokens }) => (
                        <div key={round} style={{
                            width: slotWidth,
                            borderRight: '1px solid #111',
                            padding: '3px 2px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            background: round === currentRound ? `${p2Color}11` : 'transparent',
                        }}>
                            {tokens.map((token, i) => (
                                <div key={i}>{renderToken(token, p2Color)}</div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* VP Player 2 — derecha */}
            <div style={{
                width: 110,
                background: `${p2Color}22`,
                border: `1px solid ${p2Color}66`,
                borderLeft: `2px solid ${p2Color}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px 8px',
                flexShrink: 0,
            }}>
                <div style={{
                    fontSize: 9, color: p2Color, textTransform: 'uppercase',
                    letterSpacing: 1, marginBottom: 4,
                }}>
                    {myPlayerId === 'player2' ? '▶ ' : ''}Victory Points
                </div>
                <div style={{
                    fontSize: 28, fontWeight: 'bold', color: '#fff', lineHeight: 1,
                }}>
                    {players.player2.vp}
                </div>
                <div style={{
                    fontSize: 9, color: p2Color, marginTop: 4, textTransform: 'uppercase',
                    letterSpacing: 1, textAlign: 'center',
                    maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {players.player2.name}
                </div>
            </div>
        </div>
    )
}