import { useState } from 'react'
import type { TacticsCard, ResponseTrigger } from '../../types/tactics'
import { C, FONT, button, eyebrow, CARD_TYPE } from '../../theme'

const TRIGGER_LABEL: Partial<Record<ResponseTrigger, string>> = {
    before_attack_roll: 'antes de tirar los dados',
    after_attack_roll: 'con los dados tirados, antes del daño',
    after_combat_damage: 'tras el daño',
    after_rescue: 'tras un rescate',
    after_enemy_advance: 'un enemigo se ha movido',
}

interface TacticsHandProps {
    hand: TacticsCard[]
    isMyTurn: boolean
    selectedCardId: string | null
    deckCount: number
    onPlayCard: (cardId: string) => void
    pendingResponseTrigger?: ResponseTrigger | null
    onPassResponse?: () => void
    cardPlayed?: boolean
    canRespond?: (card: TacticsCard) => boolean
    responseAbilities?: { key: string; label: string; onUse: () => void }[]
    compact?: boolean
}


// Mano de cartas de Tactics. Al pasar el ratón por una carta se ve ampliada y
// completa encima de la mano (H13).
export function TacticsHand({ hand, isMyTurn, selectedCardId, deckCount, onPlayCard, pendingResponseTrigger, onPassResponse, cardPlayed = false, canRespond, responseAbilities = [], compact = false }: TacticsHandProps) {
    const isRspWindow = !!pendingResponseTrigger
    const [hovered, setHovered] = useState<TacticsCard | null>(null)

    const playable = (card: TacticsCard) => {
        const rspMatch = canRespond ? canRespond(card) : card.type === 'response' && card.effectData?.trigger === pendingResponseTrigger
        return isRspWindow ? rspMatch : isMyTurn && card.type !== 'response' && !cardPlayed
    }

    return (
        <div style={{ position: 'relative', height: '100%' }}>
            {hovered && !compact && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 10px)', left: 128, zIndex: 40, pointerEvents: 'none' }}>
                    <CardFace card={hovered} playable={playable(hovered)} large />
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: 8, padding: '8px 12px', overflowX: 'auto', overflowY: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, minWidth: compact ? 70 : 104, flexShrink: 0, borderRight: `1px solid ${C.line}`, paddingRight: 12 }}>
                    {isRspWindow ? (
                        <>
                            <span style={{ ...eyebrow, color: C.response, animation: 'ga-pulse 1.6s infinite' }}>Ventana Response</span>
                            <span style={{ fontSize: 11, color: C.textSoft, lineHeight: 1.3 }}>{TRIGGER_LABEL[pendingResponseTrigger!] ?? ''}: juega una o pasa</span>
                        </>
                    ) : <span style={eyebrow}>Tactics</span>}
                    <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textSoft }}>Mano {hand.length} · Mazo {deckCount}</span>
                    {!isRspWindow && cardPlayed && isMyTurn && <span style={{ fontSize: 10.5, color: C.textDim }}>Ya jugaste una carta esta activación</span>}
                </div>

                {hand.map(card => {
                    const canPlay = playable(card)
                    const selected = selectedCardId === card.id
                    return (
                        <button key={card.id} type="button"
                            onClick={() => canPlay && onPlayCard(card.id)}
                            onMouseEnter={() => setHovered(card)} onMouseLeave={() => setHovered(null)}
                            onFocus={() => setHovered(card)} onBlur={() => setHovered(null)}
                            aria-label={`${card.name}: ${card.effect}`}
                            style={{ padding: 0, border: 'none', background: 'none', flexShrink: 0, cursor: canPlay ? 'pointer' : 'default', textAlign: 'left', color: 'inherit' }}>
                            <CardFace card={card} playable={canPlay} selected={selected} highlight={isRspWindow && canPlay} compact={compact} />
                        </button>
                    )
                })}

                {isRspWindow && responseAbilities.map(ra => (
                    <button key={ra.key} onClick={ra.onUse} title="Habilidad Response de tu unidad"
                        style={{ ...button('primary'), alignSelf: 'center', borderColor: C.response }}>
                        Usar {ra.label}
                    </button>
                ))}
                {isRspWindow && onPassResponse && (
                    <button onClick={onPassResponse} style={{ ...button('ghost'), alignSelf: 'center' }}>Pasar</button>
                )}
            </div>
        </div>
    )
}

export function CardFace({ card, playable, selected = false, highlight = false, large = false, compact = false, fluid = false }: {
    card: TacticsCard; playable: boolean; selected?: boolean; highlight?: boolean; large?: boolean; compact?: boolean; fluid?: boolean
}) {
    const t = CARD_TYPE[card.type]
    const w = fluid ? '100%' : large ? 250 : compact ? 112 : 136
    return (
        <div style={{
            width: w, height: large ? 'auto' : '100%', minHeight: large ? 220 : undefined,
            display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 8,
            background: `linear-gradient(180deg, ${t.color}22, ${C.panelSolid} 38%)`,
            border: `1px solid ${selected ? C.amber : highlight ? t.color : playable ? C.lineStrong : C.line}`,
            boxShadow: large ? '0 16px 40px rgba(0,0,0,0.6)' : highlight ? `0 0 12px ${t.color}55` : selected ? `0 0 12px ${C.amber}55` : 'none',
            opacity: playable || large ? 1 : 0.5, transition: 'transform 120ms, border-color 120ms',
            transform: selected ? 'translateY(-3px)' : 'none',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: large ? '8px 12px' : '6px 8px', borderBottom: `1px solid ${t.color}55` }}>
                <span style={{ color: t.color, fontSize: large ? 13 : 10 }} aria-hidden>{t.glyph}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: large ? 10.5 : 9, letterSpacing: '0.1em', color: t.color, textTransform: 'uppercase' }}>{t.label}</span>
                {card.signature && <span style={{ marginLeft: 'auto', fontSize: large ? 10.5 : 9, color: C.textDim, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{card.signature}</span>}
            </div>
            <div style={{ padding: large ? '10px 12px 12px' : '6px 8px 8px', display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minHeight: 0 }}>
                <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: large ? 17 : 12.5, lineHeight: 1.15, color: C.text }}>{card.name}</span>
                {card.weapon && (
                    <span style={{ fontFamily: FONT.mono, fontSize: large ? 11.5 : 10, color: C.textSoft }}>
                        R{card.weapon.range} · S{card.weapon.strength}{card.weapon.tlCost != null ? ` · TL${card.weapon.tlCost}` : ''}
                    </span>
                )}
                <span style={{
                    fontSize: large ? 13 : 10.5, lineHeight: 1.4, color: C.textSoft,
                    ...(large ? {} : { display: '-webkit-box', WebkitLineClamp: compact ? 3 : 4, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }),
                }}>{card.effect}</span>
                {card.faction && large && <span style={{ fontSize: 11, color: C.textDim, marginTop: 'auto' }}>Requiere: {card.faction}</span>}
            </div>
        </div>
    )
}
