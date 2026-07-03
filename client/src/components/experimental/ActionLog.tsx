import { useEffect, useRef, useState } from 'react'
import type { LogEntry, LogCategory, PlayerId } from '../../types/gameState'

interface ActionLogProps {
    log: LogEntry[]
    myPlayerId: PlayerId | null
    player1Name: string
    player2Name: string
    onHoverHexes: (hexes: string[] | null) => void
}

const MONO = "'IBM Plex Mono', monospace"
const CHAKRA = "'Chakra Petch', sans-serif"
const PLEX = "'IBM Plex Sans', system-ui, sans-serif"

const P1_COLOR = '#8fe6f7'
const P2_COLOR = '#f0a8a8'

const CATEGORY_STYLE: Record<LogCategory, { label: string; color: string }> = {
    move:      { label: 'MUEVE',    color: '#5fb0e0' },
    attack:    { label: 'ATACA',    color: '#ee8888' },
    ability:   { label: 'HABILIDAD',color: '#ce93d8' },
    card:      { label: 'CARTA',    color: '#5fc97a' },
    objective: { label: 'OBJETIVO', color: '#e0a94b' },
    end:       { label: 'FIN',      color: '#5e6a72' },
}

type Panel = 'log' | 'chat' | null

export function ActionLog({ log, myPlayerId, onHoverHexes }: ActionLogProps) {
    const [open, setOpen] = useState<Panel>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const countRef = useRef(0)

    useEffect(() => {
        if (log.length !== countRef.current) {
            countRef.current = log.length
            if (open === 'log' && scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            }
        }
    }, [log.length, open])

    useEffect(() => {
        if (open === 'log' && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [open])

    const toggle = (panel: 'log' | 'chat') =>
        setOpen(prev => prev === panel ? null : panel)

    const btnStyle = (active: boolean): React.CSSProperties => ({
        width: 36, height: 36, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontSize: 14, cursor: 'pointer',
        border: `1px solid ${active ? '#2f9fbd' : '#2a3a52'}`,
        background: active ? 'rgba(31,143,168,.18)' : 'rgba(18,28,44,.8)',
        color: active ? '#8fe6f7' : '#9fb0bc',
        userSelect: 'none' as const,
    })

    return (
        <div style={{
            position: 'absolute', right: 16, bottom: 18, zIndex: 20,
            display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
        }}>
            {/* Log panel */}
            {open === 'log' && (
                <div style={{
                    width: 248, marginBottom: 4,
                    background: 'rgba(13,22,36,.94)',
                    border: '1px solid #2f9fbd',
                    borderRadius: 11, padding: '12px 13px',
                    backdropFilter: 'blur(8px)',
                    animation: 'popIn .14s ease',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
                        <span style={{ fontFamily: CHAKRA, fontSize: 10, color: '#8fe6f7', letterSpacing: 1.5, fontWeight: 600 }}>
                            LOG DE PARTIDA
                        </span>
                        <span
                            onClick={() => setOpen(null)}
                            style={{ fontFamily: MONO, fontSize: 12, color: '#7e8a92', cursor: 'pointer' }}
                        >×</span>
                    </div>
                    <div ref={scrollRef} style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {log.length === 0 && (
                            <span style={{ fontFamily: MONO, fontSize: 10, color: '#3f4d5c', fontStyle: 'italic' }}>
                                Sin acciones aún
                            </span>
                        )}
                        {log.map((entry, i) => {
                            const playerColor = entry.playerId === 'player1' ? P1_COLOR : P2_COLOR
                            const cat = CATEGORY_STYLE[entry.category]
                            const hasHexes = entry.hexes.length > 0
                            return (
                                <div
                                    key={i}
                                    onMouseEnter={() => hasHexes && onHoverHexes(entry.hexes)}
                                    onMouseLeave={() => onHoverHexes(null)}
                                    style={{
                                        display: 'flex', gap: 7, alignItems: 'flex-start',
                                        cursor: hasHexes ? 'crosshair' : 'default',
                                    }}
                                >
                                    <span style={{ color: playerColor, fontFamily: MONO, fontSize: 10, flexShrink: 0, marginTop: 1 }}>▸</span>
                                    <span style={{ fontSize: 11, color: '#9aa8b2', lineHeight: 1.4, flex: 1 }}>
                                        <span style={{
                                            fontFamily: MONO, fontSize: 9, color: cat.color,
                                            border: `1px solid ${cat.color}44`, borderRadius: 3,
                                            padding: '0 4px', marginRight: 5, lineHeight: '14px',
                                        }}>{cat.label}</span>
                                        {entry.message}
                                    </span>
                                    {entry.round != null && (
                                        <span style={{ fontFamily: MONO, fontSize: 8, color: '#3f4d5c', flexShrink: 0, marginTop: 2 }}>
                                            R{entry.round}
                                        </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Chat panel */}
            {open === 'chat' && (
                <div style={{
                    width: 248, marginBottom: 4,
                    background: 'rgba(13,22,36,.94)',
                    border: '1px solid #2a3a52',
                    borderRadius: 11, padding: '12px 13px',
                    backdropFilter: 'blur(8px)',
                    animation: 'popIn .14s ease',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
                        <span style={{ fontFamily: CHAKRA, fontSize: 10, color: '#8fe6f7', letterSpacing: 1.5, fontWeight: 600 }}>
                            CHAT
                        </span>
                        <span
                            onClick={() => setOpen(null)}
                            style={{ fontFamily: MONO, fontSize: 12, color: '#7e8a92', cursor: 'pointer' }}
                        >×</span>
                    </div>
                    <div style={{ fontFamily: PLEX, fontSize: 11, color: '#5e6a72', fontStyle: 'italic', padding: '8px 0' }}>
                        Chat no implementado aún.
                    </div>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        border: '1px solid #2a3a52', borderRadius: 8, padding: '7px 10px', marginTop: 8,
                    }}>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: '#5e6a72', flex: 1 }}>escribe…</span>
                        <span style={{ color: '#8fe6f7' }}>▸</span>
                    </div>
                </div>
            )}

            {/* Toggle buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
                <div onClick={() => toggle('log')} style={btnStyle(open === 'log')} title="Log de partida">
                    ≣
                    {open !== 'log' && log.length > 0 && (
                        <span style={{
                            position: 'absolute', top: -4, right: -4,
                            background: '#1f8fa8', borderRadius: 8,
                            fontFamily: MONO, fontSize: 8, color: '#fff',
                            padding: '1px 4px', lineHeight: 1.4,
                        }}>{log.length}</span>
                    )}
                </div>
                <div onClick={() => toggle('chat')} style={btnStyle(open === 'chat')} title="Chat">
                    ✉
                </div>
            </div>
        </div>
    )
}
