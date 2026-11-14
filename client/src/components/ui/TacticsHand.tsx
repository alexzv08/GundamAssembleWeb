import { useState } from 'react'
import type { TacticsCard, ResponseTrigger } from '../../types/tactics'
import { C, FONT, button, eyebrow, CARD_TYPE } from '../../theme'
import { tacticsArt } from '../../cardArt'

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


// Mano de cartas de Tactics en abanico. Cada carta muestra su arte oficial; al
// pasar el ratón sube y se ve ampliada encima de la mano (en móvil, el primer
// toque la amplía y el botón "Jugar" la juega).
export function TacticsHand({ hand, isMyTurn, selectedCardId, deckCount, onPlayCard, pendingResponseTrigger, onPassResponse, cardPlayed = false, canRespond, responseAbilities = [], compact = false }: TacticsHandProps) {
    const isRspWindow = !!pendingResponseTrigger
    const [preview, setPreview] = useState<{ card: TacticsCard; x: number } | null>(null)

    const playable = (card: TacticsCard) => {
        const rspMatch = canRespond ? canRespond(card) : card.type === 'response' && card.effectData?.trigger === pendingResponseTrigger
        return isRspWindow ? rspMatch : isMyTurn && card.type !== 'response' && !cardPlayed
    }

    const W = compact ? 74 : 104, H = Math.round(W * 1.4)
    const n = hand.length
    const spread = Math.min(7, 34 / Math.max(n - 1, 1))      // grados entre cartas
    const step = Math.min(W * 0.82, 520 / Math.max(n, 1))    // solape horizontal

    const show = (card: TacticsCard, el: HTMLElement) => {
        const r = el.getBoundingClientRect()
        setPreview({ card, x: r.left + r.width / 2 })
    }

    return (
        <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'stretch' }}>
            {/* Estado de la mano */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, minWidth: compact ? 76 : 150, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: '8px 12px' }}>
                {isRspWindow ? (
                    <>
                        <span style={{ ...eyebrow, color: C.response, animation: 'ga-pulse 1.6s infinite' }}>Ventana Response</span>
                        {!compact && <span style={{ fontSize: 11, color: C.textSoft, lineHeight: 1.3 }}>{TRIGGER_LABEL[pendingResponseTrigger!] ?? ''}: juega una o pasa</span>}
                        {responseAbilities.map(ra => (
                            <button key={ra.key} onClick={ra.onUse} title="Habilidad Response de tu unidad" style={{ ...button('primary'), borderColor: C.response, whiteSpace: 'normal', textAlign: 'left' }}>
                                Usar {ra.label}
                            </button>
                        ))}
                        {onPassResponse && <button onClick={onPassResponse} style={button('ghost')}>Pasar</button>}
                    </>
                ) : <span style={eyebrow}>Tactics</span>}
                <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textSoft }}>Mano {hand.length} · Mazo {deckCount}</span>
                {!isRspWindow && cardPlayed && isMyTurn && !compact && <span style={{ fontSize: 10.5, color: C.textDim }}>Ya jugaste una carta esta activación</span>}
            </div>

            {/* Abanico */}
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }} onMouseLeave={() => !compact && setPreview(null)}>
                {hand.map((card, i) => {
                    const canPlay = playable(card)
                    const selected = selectedCardId === card.id
                    const mid = (n - 1) / 2
                    const off = i - mid
                    const lifted = selected || preview?.card.id === card.id
                    return (
                        <button key={card.id} type="button"
                            onClick={e => {
                                if (compact && preview?.card.id !== card.id) { show(card, e.currentTarget); return }
                                if (canPlay) { onPlayCard(card.id); setPreview(null) }
                            }}
                            onMouseEnter={e => !compact && show(card, e.currentTarget)}
                            onFocus={e => show(card, e.currentTarget)}
                            aria-label={`${card.name}: ${card.effect}`}
                            style={{
                                position: 'absolute', left: `calc(50% + ${off * step - W / 2}px)`, bottom: compact ? -H * 0.32 : -H * 0.28,
                                width: W, height: H, padding: 0, border: 'none', background: 'none', cursor: canPlay ? 'pointer' : 'default',
                                transformOrigin: '50% 140%',
                                transform: `rotate(${off * spread}deg) translateY(${lifted ? -26 : canPlay ? -8 : 0}px)`,
                                transition: 'transform 160ms ease-out, filter 160ms', zIndex: lifted ? 50 : 10 + i,
                                filter: canPlay ? 'none' : 'brightness(0.5) saturate(0.6)',
                            }}>
                            <CardArt card={card} playable={canPlay} selected={selected} highlight={isRspWindow && canPlay} />
                        </button>
                    )
                })}
            </div>

            {/* Carta ampliada */}
            {preview && (
                <div style={{
                    position: 'fixed', bottom: (compact ? 132 : 140) + 10, zIndex: 60,
                    left: `clamp(8px, ${preview.x - (compact ? 120 : 150)}px, calc(100vw - ${compact ? 248 : 308}px))`,
                    width: compact ? 240 : 300, pointerEvents: compact ? 'auto' : 'none',
                    display: 'flex', flexDirection: 'column', gap: 6, animation: 'ga-rise 120ms ease-out',
                }}>
                    <CardArt card={preview.card} playable large />
                    {compact && (
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button disabled={!playable(preview.card)} onClick={() => { onPlayCard(preview.card.id); setPreview(null) }}
                                style={{ ...button('amber', !playable(preview.card)), flex: 1 }}>Jugar</button>
                            <button onClick={() => setPreview(null)} style={{ ...button('ghost'), flex: 1 }}>Cerrar</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// Carta con su arte oficial si lo hay; si no, el diseño de texto (CardFace).
export function CardArt({ card, playable, selected = false, highlight = false, large = false }: {
    card: TacticsCard; playable: boolean; selected?: boolean; highlight?: boolean; large?: boolean
}) {
    const src = tacticsArt(card.id)
    const t = CARD_TYPE[card.type]
    if (!src) return <CardFace card={card} playable={playable} selected={selected} highlight={highlight} large={large} fluid />
    return (
        <img src={src} alt={card.name} draggable={false} loading="lazy" style={{
            display: 'block', width: '100%', height: large ? 'auto' : '100%', aspectRatio: large ? '560 / 783' : undefined, objectFit: 'cover', borderRadius: large ? 12 : 7,
            outline: selected ? `2px solid ${C.amber}` : highlight ? `2px solid ${t.color}` : 'none', outlineOffset: 1,
            boxShadow: large ? '0 18px 44px rgba(0,0,0,0.65)' : selected ? `0 0 16px ${C.amber}88` : highlight ? `0 0 14px ${t.color}88` : '0 4px 12px rgba(0,0,0,0.55)',
            background: C.panelSolid,
        }} />
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
