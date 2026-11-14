import type { GameState, PlayerId } from '../../types/gameState'
import { C, FONT, sideColor } from '../../theme'

interface TimelineBarProps {
    gameState: GameState
    myPlayerId: PlayerId | null
    compact?: boolean
}

// Timeline de 20 rondas (Fase 1 = 1-10, Fase 2 = 11-20). El rival arriba y tú
// abajo, como en la mesa. Cada ficha lleva el nombre corto de la unidad; al pasar
// el ratón se ve el nombre completo, HP y la ronda. Se muestran la ronda actual y
// las siguientes (la línea ámbar marca el paso a la Fase 2).
export function TimelineBar({ gameState, myPlayerId, compact = false }: TimelineBarProps) {
    const { timeline, units, players, activeUnitId, phase } = gameState
    const me: PlayerId = myPlayerId ?? 'player1'
    const rival: PlayerId = me === 'player1' ? 'player2' : 'player1'
    const current = timeline.slots.find(s => s.tokens.length > 0)?.round ?? 1
    // Ventana de rondas: la actual y las siguientes (las fichas nunca retroceden).
    // En escritorio caben 12 columnas con el nombre corto entero; en móvil, 4.
    const first = Math.max(1, Math.min(current, 21 - (compact ? 4 : 12)))
    const slots = timeline.slots.filter(s => s.round >= first && s.round < first + (compact ? 4 : 12))

    const lane = (player: PlayerId) => (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`, minHeight: compact ? 26 : 30 }}>
            {slots.map(slot => (
                <div key={slot.round} style={{
                    display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 2px',
                    borderLeft: slot.round === 11 ? `2px solid ${C.amber}88` : `1px solid ${C.line}55`,
                    background: slot.round === current ? `${C.amber}0f` : 'transparent',
                }}>
                    {slot.tokens.filter(t => t.playerId === player).map(t => {
                        const u = units[t.unitId]
                        if (!u) return null
                        const color = sideColor(player, myPlayerId)
                        const active = t.unitId === activeUnitId
                        const hp = u.currentHp / u.maxHp
                        return (
                            <div key={t.unitId}
                                title={`${u.name} · HP ${u.currentHp}/${u.maxHp} · ronda ${slot.round}${u.position ? '' : ' · en la Reserva'}`}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
                                    background: active ? `${C.amber}26` : `${color}1a`,
                                    border: `1px solid ${active ? C.amber : color + '88'}`,
                                    borderRadius: 3, padding: '1px 4px',
                                    boxShadow: active ? `0 0 8px ${C.amber}66` : 'none',
                                    opacity: u.position || active ? 1 : 0.7,
                                }}>
                                <span style={{
                                    fontFamily: FONT.body, fontSize: 10.5, fontWeight: active ? 600 : 500,
                                    color: active ? C.text : C.textSoft, flex: 1, minWidth: 0,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>{u.shortName ?? u.name}</span>
                                {!compact && <span style={{ width: 14, height: 3, background: C.line, borderRadius: 2, flexShrink: 0, overflow: 'hidden' }}>
                                    <span style={{ display: 'block', height: '100%', width: `${hp * 100}%`, background: hp > 0.5 ? C.ok : hp > 0.25 ? C.warn : C.danger }} />
                                </span>}
                            </div>
                        )
                    })}
                </div>
            ))}
        </div>
    )

    const vpCard = (player: PlayerId) => {
        const color = sideColor(player, myPlayerId)
        return (
            <div style={{
                width: compact ? 54 : 104, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                alignItems: 'center', gap: 1, padding: '4px 6px',
                background: `linear-gradient(180deg, ${color}1c, transparent)`, borderBottom: `2px solid ${color}`,
            }}>
                <span style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: '0.12em', color, textTransform: 'uppercase', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {player === me ? 'Tú' : players[player].name}
                </span>
                <span style={{ fontFamily: FONT.display, fontSize: compact ? 22 : 28, fontWeight: 700, lineHeight: 1, color: C.text }}>{players[player].vp}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textDim }}>VP</span>
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', alignItems: 'stretch', background: C.panelSolid, borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
            {vpCard(rival)}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 6px' }}>
                {lane(rival)}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`, borderBlock: `1px solid ${C.line}` }}>
                    {slots.map(s => (
                        <div key={s.round} style={{
                            textAlign: 'center', fontFamily: FONT.mono, fontSize: 10.5, padding: '1px 0',
                            color: s.round === current ? C.amber : s.round > 10 ? C.textDim : C.textSoft,
                            fontWeight: s.round === current ? 600 : 400,
                            borderLeft: s.round === 11 ? `2px solid ${C.amber}88` : 'none',
                            background: s.round === current ? `${C.amber}1a` : 'transparent',
                        }}>
                            {s.round === 11 ? 'F2 · 11' : s.round}
                        </div>
                    ))}
                </div>
                {lane(me)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {!compact && (
                    <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: '0.12em', color: C.amber, textAlign: 'center', padding: '3px 0', textTransform: 'uppercase' }}>
                        {phase === 'phase2' ? 'Fase 2' : phase === 'finished' ? 'Fin' : 'Fase 1'}
                    </div>
                )}
                {vpCard(me)}
            </div>
        </div>
    )
}
