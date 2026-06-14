import type { TacticsCard } from '../../types/tactics'
import type { ResponseTrigger } from '../../types/tactics'

interface TacticsHandProps {
    hand: TacticsCard[]
    isMyTurn: boolean
    selectedCardId: string | null
    onPlayCard: (cardId: string) => void
    pendingResponseTrigger?: ResponseTrigger | null
    onPassResponse?: () => void
}

const cardTypeColor = (type: 'command' | 'response', active: boolean) =>
    !active ? '#333' : type === 'command' ? '#e65100' : '#6a1b9a'

export function TacticsHand({ hand, isMyTurn, selectedCardId, onPlayCard, pendingResponseTrigger, onPassResponse }: TacticsHandProps) {
    if (hand.length === 0 && !pendingResponseTrigger) return null

    return (
        <div style={{
            position: 'absolute',
            top: 8,
            right: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            zIndex: 15,
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
        }}>
            {pendingResponseTrigger && (
                <div style={{
                    background: 'rgba(106,27,154,0.25)',
                    border: '1px solid #6a1b9a',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 10,
                    color: '#ce93d8',
                    textAlign: 'center',
                    marginBottom: 2,
                }}>
                    ¡Ventana RSP! Juega una carta o pasa
                </div>
            )}
            <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                Cartas ({hand.length})
            </div>
            {hand.map(card => {
                const isRspWindow = !!pendingResponseTrigger
                const rspMatch = card.type === 'response' && card.effectData?.trigger === pendingResponseTrigger
                const canPlay = isRspWindow
                    ? rspMatch
                    : isMyTurn && card.type === 'command'
                const isSelected = selectedCardId === card.id
                return (
                    <div
                        key={card.id}
                        onClick={() => canPlay && onPlayCard(card.id)}
                        title={card.effect}
                        style={{
                            width: 160,
                            background: isSelected ? 'rgba(230,81,0,0.25)'
                                : rspMatch ? 'rgba(106,27,154,0.15)'
                                : 'rgba(10,10,20,0.95)',
                            border: `1px solid ${isSelected ? '#ff6d00' : rspMatch ? '#9c27b0' : canPlay ? '#555' : '#2a2a2a'}`,
                            borderRadius: 8,
                            padding: '6px 10px',
                            color: canPlay ? 'white' : '#555',
                            cursor: canPlay ? 'pointer' : 'default',
                            fontSize: 11,
                            transition: 'border-color 0.15s',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                            <span style={{
                                background: cardTypeColor(card.type, canPlay),
                                borderRadius: 3, padding: '1px 5px',
                                fontSize: 9, fontWeight: 'bold', color: canPlay ? 'white' : '#555',
                            }}>
                                {card.type === 'command' ? 'CMD' : 'RSP'}
                            </span>
                            <span style={{ fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {card.name}
                            </span>
                        </div>
                        <div style={{ color: canPlay ? '#999' : '#444', fontSize: 10, lineHeight: 1.3 }}>
                            {card.effect}
                        </div>
                        {card.type === 'response' && !rspMatch && (
                            <div style={{ color: '#6a1b9a', fontSize: 9, marginTop: 3 }}>
                                RSP — turno enemigo
                            </div>
                        )}
                    </div>
                )
            })}
            {pendingResponseTrigger && onPassResponse && (
                <button
                    onClick={onPassResponse}
                    style={{
                        padding: '6px 10px',
                        background: 'rgba(40,40,60,0.9)',
                        border: '1px solid #555',
                        borderRadius: 6,
                        color: '#aaa',
                        cursor: 'pointer',
                        fontSize: 11,
                        marginTop: 2,
                    }}
                >
                    Pasar respuesta
                </button>
            )}
        </div>
    )
}
