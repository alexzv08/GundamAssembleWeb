import { useState } from 'react'
import type { GameState } from '../../types/gameState'

interface TimelineBarProps {
    gameState: GameState
    myPlayerId: 'player1' | 'player2' | null
}

const MONO = "'IBM Plex Mono', monospace"
const CHAKRA = "'Chakra Petch', sans-serif"
const PLEX = "'IBM Plex Sans', system-ui, sans-serif"

const P1_COLOR = '#2f9fbd'
const P1_ACCENT = '#8fe6f7'
const P2_COLOR = '#9a4a44'
const P2_ACCENT = '#f0a8a8'

export function TimelineBar({ gameState, myPlayerId }: TimelineBarProps) {
    const { timeline, units, players, activeUnitId, activePlayerId, phase } = gameState

    const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)

    const currentRound = timeline.slots.find(s => s.tokens.length > 0)?.round ?? null

    const activePlayerName = players[activePlayerId]?.name ?? '—'
    const isMyTurn = myPlayerId === activePlayerId

    const phase1Slots = timeline.slots.filter(s => s.round <= 10)
    const phase2Slots = timeline.slots.filter(s => s.round > 10)
    const isInPhase2 = phase === 'phase2'
    const activeSlots = isInPhase2 ? phase2Slots : phase1Slots
    const phaseLabel = isInPhase2 ? 'FASE 2' : 'FASE 1'

    // Stack de tokens con hover para separar
    const renderStack = (tokens: typeof timeline.slots[0]['tokens'], slotRound: number) => {
        const hovered = hoveredSlot === slotRound
        if (tokens.length === 0) return null
        return (
            <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={() => setHoveredSlot(slotRound)}
                onMouseLeave={() => setHoveredSlot(null)}
            >
                {tokens.map((token, i) => {
                    const unit = units[token.unitId]
                    const isP1 = token.playerId === 'player1'
                    const isUnitActive = token.unitId === activeUnitId
                    const color = isP1 ? P1_COLOR : P2_COLOR
                    const accent = isP1 ? P1_ACCENT : P2_ACCENT
                    return (
                        <div
                            key={i}
                            title={unit?.name ?? token.unitId}
                            style={{
                                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                                background: isP1 ? '#163a48' : '#3a1818',
                                border: `2px solid ${isUnitActive ? accent : color}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontFamily: MONO, fontSize: 11, fontWeight: 700, color: accent,
                                boxShadow: isUnitActive ? `0 0 8px ${color}` : '0 2px 4px rgba(0,0,0,.3)',
                                cursor: 'pointer',
                                position: 'relative',
                                zIndex: tokens.length - i,
                                marginLeft: i === 0 ? 0 : (hovered ? 4 : -14),
                                transition: 'margin-left .2s ease',
                            }}
                        >
                            {(unit?.name ?? '?').charAt(0).toUpperCase()}
                        </div>
                    )
                })}
            </div>
        )
    }

    // Celda base compartida entre las 3 filas
    const cell = (slotRound: number, content: React.ReactNode, extraStyle?: React.CSSProperties) => {
        const isActive = slotRound === currentRound
        return (
            <div key={slotRound} style={{
                flex: 1, minWidth: 52,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: '1px solid #1a2836',
                minHeight: 40,
                background: isActive ? 'rgba(143,230,247,.05)' : 'transparent',
                ...extraStyle,
            }}>
                {content}
            </div>
        )
    }

    const renderPhase = (slots: typeof timeline.slots) => (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1a2836' }}>

            {/* Fila P1 (arriba) */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1a2836' }}>
                {slots.map(slot => {
                    const p1Tokens = slot.tokens.filter(t => t.playerId === 'player1')
                    return cell(slot.round,
                        <div style={{ padding: '6px 2px' }}>{renderStack(p1Tokens, slot.round)}</div>
                    )
                })}
            </div>

            {/* Fila central: números de turno */}
            <div style={{ display: 'flex', background: 'rgba(10,17,30,.6)', borderBottom: '1px solid #1a2836' }}>
                {slots.map(slot => {
                    const isActive = slot.round === currentRound
                    const displayNum = slot.round > 10 ? slot.round - 10 : slot.round
                    return cell(slot.round,
                        <span style={{
                            fontFamily: MONO, fontSize: isActive ? 12 : 10, fontWeight: isActive ? 700 : 400,
                            color: isActive ? '#fff' : '#3f4d5c',
                            textShadow: isActive ? `0 0 8px ${P1_ACCENT}` : 'none',
                        }}>
                            T{displayNum}
                        </span>,
                        { minHeight: 28, background: isActive ? 'rgba(143,230,247,.1)' : 'rgba(10,17,30,.6)' }
                    )
                })}
            </div>

            {/* Fila P2 (abajo) */}
            <div style={{ display: 'flex' }}>
                {slots.map(slot => {
                    const p2Tokens = slot.tokens.filter(t => t.playerId === 'player2')
                    return cell(slot.round,
                        <div style={{ padding: '6px 2px' }}>{renderStack(p2Tokens, slot.round)}</div>
                    )
                })}
            </div>
        </div>
    )

    return (
        <div style={{
            background: 'rgba(5,5,10,.95)',
            borderBottom: '1px solid #111',
            flexShrink: 0,
            fontFamily: PLEX,
            color: '#dbe4ec',
        }}>
            {/* ── Top row: J1 VP · turn bar · J2 VP ── */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>

                {/* J1 VP card */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                    background: 'linear-gradient(180deg, rgba(20,42,52,.9), rgba(14,28,36,.9))',
                    borderRight: `2px solid ${P1_COLOR}`,
                    padding: '9px 16px 9px 10px',
                    boxShadow: `0 0 18px rgba(31,126,149,.2)`,
                }}>
                    <div style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: '#10333d', border: `1.5px solid ${P1_COLOR}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: CHAKRA, fontWeight: 700, color: P1_ACCENT, fontSize: 14,
                    }}>
                        {players.player1.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: '#6fc3d6', letterSpacing: 1 }}>
                            J1{myPlayerId === 'player1' ? ' ▶' : ''} · {players.player1.name.toUpperCase()}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                            <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, color: P1_ACCENT, lineHeight: 1 }}>
                                {players.player1.vp}
                            </span>
                            <span style={{ fontFamily: MONO, fontSize: 10, color: '#7e8a92' }}>VP</span>
                        </div>
                    </div>
                </div>

                {/* Center turn bar */}
                <div style={{
                    flex: 1,
                    background: 'rgba(13,22,36,.86)',
                    backdropFilter: 'blur(6px)',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    {/* Turn indicator */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '7px 14px 6px', borderBottom: '1px solid #1a2836', flexShrink: 0,
                    }}>
                        <div style={{
                            fontFamily: CHAKRA, fontSize: 12, fontWeight: 600, letterSpacing: 1.5,
                            color: isMyTurn ? P1_ACCENT : P2_ACCENT,
                        }}>
                            ▸ {isMyTurn ? 'TU TURNO' : `TURNO DE ${activePlayerName.toUpperCase()}`}
                        </div>
                        <div style={{ fontFamily: CHAKRA, fontSize: 9, color: '#3f4d5c', letterSpacing: 1.5, fontWeight: 600 }}>
                            {phaseLabel}
                        </div>
                    </div>

                    {/* 3-lane grid: P1 · números · P2 */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {renderPhase(activeSlots)}
                    </div>
                </div>

                {/* J2 VP card */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexDirection: 'row-reverse',
                    background: 'linear-gradient(180deg, rgba(52,24,24,.9), rgba(34,16,16,.9))',
                    borderLeft: `2px solid ${P2_COLOR}`,
                    padding: '9px 10px 9px 16px',
                    boxShadow: `0 0 18px rgba(154,74,68,.18)`,
                }}>
                    <div style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: '#3a1818', border: `1.5px solid #c66`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: CHAKRA, fontWeight: 700, color: P2_ACCENT, fontSize: 14,
                    }}>
                        {players.player2.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: '#e3a0a0', letterSpacing: 1 }}>
                            {players.player2.name.toUpperCase()} · J2{myPlayerId === 'player2' ? ' ◀' : ''}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, justifyContent: 'flex-end' }}>
                            <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, color: P2_ACCENT, lineHeight: 1 }}>
                                {players.player2.vp}
                            </span>
                            <span style={{ fontFamily: MONO, fontSize: 10, color: '#7e8a92' }}>VP</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
