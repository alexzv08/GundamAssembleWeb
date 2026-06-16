import type { TacticsCard } from '../../types/tactics'
import type { ResponseTrigger } from '../../types/tactics'

interface TacticsHandProps {
    hand: TacticsCard[]
    isMyTurn: boolean
    selectedCardId: string | null
    deckCount: number
    onPlayCard: (cardId: string) => void
    pendingResponseTrigger?: ResponseTrigger | null
    onPassResponse?: () => void
}

const cardTypeColor = (type: 'command' | 'response', active: boolean) =>
    !active ? '#333' : type === 'command' ? '#e65100' : '#6a1b9a'

export function TacticsHand({ hand, isMyTurn, selectedCardId, deckCount, onPlayCard, pendingResponseTrigger, onPassResponse }: TacticsHandProps) {
    const isRspWindow = !!pendingResponseTrigger

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            height: '100%',
            gap: 8,
            padding: '8px 12px',
            overflowX: 'auto',
            overflowY: 'hidden',
        }}>
            {/* Panel izquierdo: estado + mazo */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 4,
                minWidth: 90,
                flexShrink: 0,
                borderRight: '1px solid #222',
                paddingRight: 12,
            }}>
                {isRspWindow ? (
                    <div style={{
                        color: '#ce93d8',
                        fontSize: 11,
                        fontWeight: 'bold',
                        lineHeight: 1.3,
                        textAlign: 'center',
                    }}>
                        ¡Ventana RSP!<br />
                        <span style={{ fontWeight: 'normal', fontSize: 10 }}>Juega o pasa</span>
                    </div>
                ) : (
                    <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
                        Cartas
                    </div>
                )}
                <div style={{ color: '#555', fontSize: 10, textAlign: 'center' }}>
                    Mano: <span style={{ color: '#aaa' }}>{hand.length}</span>
                </div>
                <div style={{ color: '#555', fontSize: 10, textAlign: 'center' }}>
                    Mazo: <span style={{ color: '#aaa' }}>{deckCount}</span>
                </div>
            </div>

            {/* Cartas */}
            {hand.map(card => {
                const rspMatch = card.type === 'response' && card.effectData?.trigger === pendingResponseTrigger
                const canPlay = isRspWindow ? rspMatch : isMyTurn && card.type === 'command'
                const isSelected = selectedCardId === card.id
                return (
                    <div
                        key={card.id}
                        onClick={() => canPlay && onPlayCard(card.id)}
                        title={card.effect}
                        style={{
                            width: 128,
                            flexShrink: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            background: isSelected ? 'rgba(230,81,0,0.25)'
                                : rspMatch ? 'rgba(106,27,154,0.2)'
                                : 'rgba(20,20,35,0.95)',
                            border: `1px solid ${isSelected ? '#ff6d00' : rspMatch ? '#9c27b0' : canPlay ? '#555' : '#2a2a2a'}`,
                            borderRadius: 7,
                            padding: '6px 8px',
                            color: canPlay ? 'white' : '#555',
                            cursor: canPlay ? 'pointer' : 'default',
                            fontSize: 11,
                            boxShadow: rspMatch ? '0 0 8px rgba(156,39,176,0.4)' : 'none',
                            transition: 'border-color 0.15s',
                            overflow: 'hidden',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                            <span style={{
                                background: cardTypeColor(card.type, canPlay),
                                borderRadius: 3, padding: '1px 4px',
                                fontSize: 9, fontWeight: 'bold',
                                color: canPlay ? 'white' : '#555',
                                flexShrink: 0,
                            }}>
                                {card.type === 'command' ? 'CMD' : 'RSP'}
                            </span>
                            <span style={{
                                fontWeight: 'bold', fontSize: 10,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                                {card.name}
                            </span>
                        </div>
                        <div style={{
                            color: canPlay ? '#999' : '#444', fontSize: 10, lineHeight: 1.35,
                            flex: 1,
                            display: '-webkit-box' as const,
                            WebkitLineClamp: 4,
                            WebkitBoxOrient: 'vertical' as const,
                            overflow: 'hidden',
                        }}>
                            {card.effect}
                        </div>
                        {card.type === 'response' && !rspMatch && !isRspWindow && (
                            <div style={{ color: '#6a1b9a', fontSize: 9, marginTop: 3 }}>
                                RSP — turno enemigo
                            </div>
                        )}
                    </div>
                )
            })}

            {/* Botón pasar respuesta */}
            {isRspWindow && onPassResponse && (
                <button
                    onClick={onPassResponse}
                    style={{
                        flexShrink: 0,
                        alignSelf: 'center',
                        padding: '8px 14px',
                        background: 'rgba(40,40,60,0.9)',
                        border: '1px solid #555',
                        borderRadius: 6,
                        color: '#aaa',
                        cursor: 'pointer',
                        fontSize: 11,
                        marginLeft: 4,
                        whiteSpace: 'nowrap',
                    }}
                >
                    Pasar →
                </button>
            )}
        </div>
    )
}
