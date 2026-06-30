import { UnitCardPreview } from '../components/ui/UnitCardPreview'
import type { UnitCardData, TacticsCardData } from '../api/gameData'

const MAX_SQUAD = 3
const DECK_SIZE = 9

interface SquadSelectionScreenProps {
  playerName: string
  myPlayerId: 'player1' | 'player2'
  availableUnitCards: UnitCardData[]
  availableTacticsCards: TacticsCardData[]
  selectedSquad: string[]
  onToggleUnit: (cardId: string) => void
  selectedDeck: string[]
  onToggleCard: (cardId: string) => void
  squadStep: 'units' | 'deck'
  onSetSquadStep: (step: 'units' | 'deck') => void
  squadSubmitted: boolean
  onConfirm: (unitCardIds: string[], cardIds: string[]) => void
}

export function SquadSelectionScreen({
  playerName, myPlayerId,
  availableUnitCards, availableTacticsCards,
  selectedSquad, onToggleUnit,
  selectedDeck, onToggleCard,
  squadStep, onSetSquadStep,
  squadSubmitted, onConfirm,
}: SquadSelectionScreenProps) {
  const canGoToDeck = selectedSquad.length === MAX_SQUAD
  const canConfirm = selectedDeck.length === DECK_SIZE && !squadSubmitted
  const playerColor = myPlayerId === 'player1' ? '#ef5350' : '#4fc3f7'

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0d0d1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a2e', border: '1px solid #333', borderRadius: 12,
        padding: '32px 40px', maxWidth: 1100, width: '100%', color: 'white',
      }}>
        {/* Cabecera */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#4fc3f7' }}>
              {squadStep === 'units' ? 'Selección de Escuadra' : 'Mazo de Tácticas'}
            </div>
            <div style={{
              fontSize: 11, marginTop: 2,
              color: playerColor, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase',
            }}>
              {playerName}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {(['units', 'deck'] as const).map((step, i) => (
              <div key={step} style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 'bold',
                background: squadStep === step ? '#1565c0' : '#333',
                color: squadStep === step ? 'white' : '#888',
                border: `2px solid ${squadStep === step ? '#4fc3f7' : '#444'}`,
              }}>{i + 1}</div>
            ))}
          </div>
        </div>

        <div style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
          {squadStep === 'units'
            ? `Elige ${MAX_SQUAD} unidades (${selectedSquad.length}/${MAX_SQUAD})`
            : `Elige exactamente ${DECK_SIZE} cartas (${selectedDeck.length}/${DECK_SIZE})`}
        </div>

        {/* Paso 1: Unidades */}
        {squadStep === 'units' && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
              {availableUnitCards.map(card => {
                const isSelected = selectedSquad.includes(card.cardId)
                const canSelect = !isSelected && selectedSquad.length < MAX_SQUAD
                return (
                  <UnitCardPreview
                    key={card.cardId}
                    card={card}
                    isSelected={isSelected}
                    canSelect={canSelect}
                    playerColor={playerColor}
                    onClick={() => onToggleUnit(card.cardId)}
                  />
                )
              })}
            </div>
            <button
              disabled={!canGoToDeck}
              onClick={() => onSetSquadStep('deck')}
              style={{
                padding: '12px 32px', background: canGoToDeck ? '#1565c0' : '#333',
                color: 'white', border: 'none', borderRadius: 8,
                cursor: canGoToDeck ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 'bold',
              }}
            >
              Siguiente →
            </button>
          </>
        )}

        {/* Paso 2: Mazo */}
        {squadStep === 'deck' && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
              {availableTacticsCards.map(card => {
                const isSelected = selectedDeck.includes(card.cardId)
                const isFull = selectedDeck.length >= DECK_SIZE
                const isCommand = card.type === 'command'
                const isFed = card.faction === 'Earth Federation'
                const artColor = isFed
                  ? (isCommand ? 'linear-gradient(160deg, #0d47a1 0%, #1565c0 50%, #29b6f6 100%)'
                               : 'linear-gradient(160deg, #004d40 0%, #00695c 50%, #4db6ac 100%)')
                  : (isCommand ? 'linear-gradient(160deg, #b71c1c 0%, #c62828 50%, #ef9a9a 100%)'
                               : 'linear-gradient(160deg, #4a148c 0%, #6a1b9a 50%, #ce93d8 100%)')
                const borderColor = isSelected ? '#4fc3f7' : isFull && !isSelected ? '#222' : '#444'
                const canToggle = !squadSubmitted && (isSelected || !isFull)

                return (
                  <div
                    key={card.cardId}
                    onClick={() => canToggle && onToggleCard(card.cardId)}
                    style={{
                      width: 118, borderRadius: 8, overflow: 'hidden',
                      border: `2px solid ${borderColor}`,
                      cursor: canToggle ? 'pointer' : 'default',
                      opacity: isFull && !isSelected ? 0.35 : 1,
                      position: 'relative',
                      boxShadow: isSelected ? '0 0 10px rgba(79,195,247,0.4)' : 'none',
                      transition: 'opacity 0.15s, box-shadow 0.15s',
                      flexShrink: 0,
                    }}
                  >
                    <div style={{
                      height: 72, background: artColor,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 4,
                      position: 'relative',
                    }}>
                      <div style={{ fontSize: 22, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
                        {isCommand ? '⚔️' : '🛡️'}
                      </div>
                      {isSelected && (
                        <div style={{
                          position: 'absolute', top: 4, right: 6,
                          width: 18, height: 18, borderRadius: '50%',
                          background: '#4fc3f7', color: '#000',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 'bold',
                        }}>✓</div>
                      )}
                    </div>
                    <div style={{ background: '#111827', padding: '7px 8px' }}>
                      <div style={{
                        fontSize: 11, fontWeight: 'bold', color: 'white',
                        lineHeight: 1.3, marginBottom: 4,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {card.name}
                      </div>
                      <div style={{
                        display: 'inline-block', fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        background: isCommand ? 'rgba(21,101,192,0.5)' : 'rgba(123,31,162,0.5)',
                        color: isCommand ? '#90caf9' : '#ce93d8',
                        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5,
                      }}>
                        {isCommand ? 'Comando' : 'Respuesta'}
                      </div>
                      <div style={{
                        fontSize: 9.5, color: '#9ca3af', lineHeight: 1.35,
                        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {card.effect}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                onClick={() => onSetSquadStep('units')}
                disabled={squadSubmitted}
                style={{
                  padding: '12px 20px', background: '#333', color: '#aaa',
                  border: 'none', borderRadius: 8,
                  cursor: squadSubmitted ? 'not-allowed' : 'pointer', fontSize: 14,
                }}
              >
                ← Volver
              </button>
              {squadSubmitted ? (
                <div style={{ color: '#4caf50', flex: 1, textAlign: 'center' }}>
                  Selección confirmada — esperando al oponente...
                </div>
              ) : (
                <button
                  disabled={!canConfirm}
                  onClick={() => onConfirm(selectedSquad, selectedDeck)}
                  style={{
                    flex: 1, padding: '12px 32px',
                    background: canConfirm ? '#1565c0' : '#333',
                    color: 'white', border: 'none', borderRadius: 8,
                    cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 'bold',
                  }}
                >
                  Confirmar selección
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
