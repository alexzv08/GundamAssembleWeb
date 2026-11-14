import { useState } from 'react'
import { UnitCardPreview, UnitModelViewer } from '../components/ui/UnitCardPreview'
import { CardFace } from '../components/ui/TacticsHand'
import type { UnitCardData, TacticsCardData } from '../api/gameData'
import type { TacticsCard } from '../types/tactics'
import { DEFAULT_SQUAD_SIZE, requiredDeckSize, cardRestriction, validateSquad, type DeckCard } from '../game/deckRules'
import { C, FONT, eyebrow, button, chip, ABILITY_TYPE } from '../theme'
import { useIsMobile } from '../game/useIsMobile'

const toDeckCard = (c: TacticsCardData): DeckCard => ({ id: c.cardId, name: c.name, faction: c.faction, signature: c.signature })
const toTactics = (c: TacticsCardData): TacticsCard => ({
  id: c.cardId, name: c.name, type: (c.type === 'attack' || c.type === 'response' ? c.type : 'command'),
  faction: c.faction, signature: c.signature, effect: c.effect, effectData: null,
  weapon: c.weapon ? { name: c.name, range: c.weapon.range, strength: c.weapon.strength, tlCost: c.weapon.tlCost, effectData: null, critData: null } : undefined,
} as TacticsCard)

interface SquadSelectionScreenProps {
  squadSize?: number
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

type TypeFilter = 'all' | 'attack' | 'command' | 'response'

// Selección de escuadra (paso 1) y de mazo de Tactics (paso 2).
// H6: panel de detalle con el modelo 3D, armas y habilidades de la unidad bajo el
// ratón, filtros por set y resumen fijo de la escuadra.
// H7: filtros por tipo, carta ampliada al pasar el ratón y contador bien visible.
export function SquadSelectionScreen({
  squadSize: MAX_SQUAD = DEFAULT_SQUAD_SIZE, playerName,
  availableUnitCards, availableTacticsCards, selectedSquad, onToggleUnit, selectedDeck, onToggleCard,
  squadStep, onSetSquadStep, squadSubmitted, onConfirm,
}: SquadSelectionScreenProps) {
  const mobile = useIsMobile()
  const [focusUnit, setFocusUnit] = useState<string | null>(null)
  const [focusCard, setFocusCard] = useState<string | null>(null)
  const [setFilter, setSetFilter] = useState<string>('Todas')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [onlyLegal, setOnlyLegal] = useState(true)

  const squadError = validateSquad(selectedSquad, availableUnitCards, MAX_SQUAD)
  const squadCards = selectedSquad.map(id => availableUnitCards.find(u => u.cardId === id)).filter((u): u is UnitCardData => !!u)
  const deckCards = availableTacticsCards.map(toDeckCard)
  const deckSize = requiredDeckSize(selectedSquad, availableUnitCards, deckCards)
  const canConfirm = selectedDeck.length === deckSize && !squadSubmitted
  const sets = ['Todas', ...new Set(availableUnitCards.map(c => c.set))]
  const units = availableUnitCards.filter(c => setFilter === 'Todas' || c.set === setFilter)
  const detail = availableUnitCards.find(c => c.cardId === (focusUnit ?? selectedSquad[selectedSquad.length - 1])) ?? availableUnitCards[0]

  const rank = (c: TacticsCardData) => (cardRestriction(toDeckCard(c), squadCards) ? 4 : 0) + (c.source === 'demo' ? 2 : 0)
  const cards = [...availableTacticsCards]
    .filter(c => typeFilter === 'all' || c.type === typeFilter || (typeFilter === 'command' && c.type !== 'attack' && c.type !== 'response'))
    .filter(c => !onlyLegal || !cardRestriction(toDeckCard(c), squadCards))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const preview = availableTacticsCards.find(c => c.cardId === focusCard)

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 24, color: C.text }}>{squadStep === 'units' ? 'Elige tu escuadra' : 'Mazo de Tactics'}</h1>
        <div style={{ ...eyebrow, color: C.ally }}>{playerName}</div>
      </div>
      <ol style={{ marginLeft: 'auto', display: 'flex', gap: 6, listStyle: 'none' }} aria-label="Pasos">
        {(['units', 'deck'] as const).map((s, i) => (
          <li key={s} style={{ ...chip(squadStep === s ? C.amber : C.textDim), padding: '3px 8px', fontSize: 10.5 }}>
            {i + 1} · {s === 'units' ? 'Escuadra' : 'Mazo'}
          </li>
        ))}
      </ol>
    </div>
  )

  const counter = (n: number, total: number, label: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 26, color: n === total ? C.ok : C.text }}>{n}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: 14, color: C.textSoft }}>/ {total}</span>
      <span style={{ ...eyebrow, marginLeft: 4 }}>{label}</span>
    </div>
  )

  const filterChip = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} aria-pressed={active}
      style={{ ...button(active ? 'primary' : 'subtle'), padding: '4px 10px', fontSize: 11.5 }}>{label}</button>
  )

  return (
    <div style={{ width: '100vw', height: '100dvh', background: `radial-gradient(1200px 600px at 70% -10%, ${C.allyDeep}55, ${C.bg} 60%)`, color: C.text, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px max(16px, env(safe-area-inset-left, 0px)) 12px', borderBottom: `1px solid ${C.line}` }}>{header}</div>

      {squadStep === 'units' && (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 1fr) 360px', overflow: mobile ? 'auto' : 'hidden' }}>
          <div style={{ minHeight: 0, overflowY: mobile ? 'visible' : 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sets.map(s => filterChip(setFilter === s, s === 'Todas' ? 'Todos los sets' : s, () => setSetFilter(s)))}
            </div>
            <p style={{ color: C.textSoft, fontSize: 13 }}>
              Elige {MAX_SQUAD} unidades. No se repiten, salvo las Mass Produced (vuelve a pulsarla para añadir otra copia). Pulsa una elegida para quitarla.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
              {units.map(card => {
                const copies = selectedSquad.filter(id => id === card.cardId).length
                const canSelect = selectedSquad.length < MAX_SQUAD && (copies === 0 || card.traits.includes('Mass Produced'))
                return (
                  <UnitCardPreview key={card.cardId} card={card} copies={copies} canSelect={canSelect}
                    focused={detail?.cardId === card.cardId}
                    onClick={() => onToggleUnit(card.cardId)} onFocus={() => setFocusUnit(card.cardId)} />
                )
              })}
            </div>
          </div>

          {/* Detalle de la unidad */}
          {detail && (
            <aside style={{ borderLeft: mobile ? 'none' : `1px solid ${C.line}`, borderTop: mobile ? `1px solid ${C.line}` : 'none', background: C.panelSolid, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ height: 220, flexShrink: 0, background: `radial-gradient(circle at 50% 60%, ${C.allyDeep}, ${C.bgDeep} 70%)` }}>
                <UnitModelViewer key={detail.cardId} cardId={detail.cardId} />
              </div>
              <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <h2 style={{ fontSize: 20 }}>{detail.name}</h2>
                  {detail.signature && <div style={{ color: C.textSoft, fontStyle: 'italic', fontSize: 12.5 }}>{detail.signature}</div>}
                  <div style={{ color: C.textDim, fontSize: 12 }}>{detail.traits.join(' · ')}</div>
                </div>
                <div style={{ display: 'flex', gap: 14, fontFamily: FONT.mono, fontSize: 12.5 }}>
                  <span>HP <b>{detail.hp}</b></span><span>VP <b style={{ color: C.amber }}>{detail.vp}</b></span><span>TL inicial <b>{detail.tl}</b></span>
                </div>
                <div style={eyebrow}>Armas</div>
                {detail.weapons.map(w => (
                  <div key={w.name} style={{ fontSize: 12.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <b>{w.name}</b>
                      <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.textSoft }}>R{w.range} · S{w.strength} · TL{w.tlCost}</span>
                    </div>
                    {w.effect && <div style={{ color: C.textSoft }}>{w.effect}</div>}
                    {w.crit && <div style={{ color: C.warn }}>★ Crit: {w.crit}</div>}
                  </div>
                ))}
                <div style={eyebrow}>Habilidades</div>
                {detail.abilities.map(a => (
                  <div key={a.name} style={{ fontSize: 12.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={chip(ABILITY_TYPE[a.type].color)}>{ABILITY_TYPE[a.type].label}</span>
                      <b>{a.name}</b>
                      {a.energyCost ? <span style={{ fontFamily: FONT.mono, color: C.amber, fontSize: 11 }}>{'◆'.repeat(a.energyCost)}</span> : null}
                    </div>
                    <div style={{ color: C.textSoft, marginTop: 2 }}>{a.effect}</div>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
      )}

      {squadStep === 'deck' && (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 1fr) 300px', overflow: mobile ? 'auto' : 'hidden' }}>
          <div style={{ minHeight: 0, overflowY: mobile ? 'visible' : 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {([['all', 'Todas'], ['attack', 'Attack'], ['command', 'Command'], ['response', 'Response']] as [TypeFilter, string][])
                .map(([t, l]) => filterChip(typeFilter === t, l, () => setTypeFilter(t)))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSoft, marginLeft: 8 }}>
                <input id="only-legal" type="checkbox" checked={onlyLegal} onChange={e => setOnlyLegal(e.target.checked)} />
                Solo las que puede llevar tu escuadra
              </label>
            </div>
            <p style={{ color: C.textSoft, fontSize: 13 }}>
              {deckSize === 0
                ? 'Ninguna carta del catálogo es compatible con esta escuadra: jugarás sin mazo de Tactics.'
                : deckSize < 9
                  ? `Tu escuadra solo puede usar ${deckSize} cartas: inclúyelas todas.`
                  : `Elige ${deckSize} cartas distintas. Las que tienen rasgo o firma exigen una unidad que lo tenga.`}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {cards.map(card => {
                const isSelected = selectedDeck.includes(card.cardId)
                const restriction = cardRestriction(toDeckCard(card), squadCards)
                const blocked = restriction !== null || (!isSelected && selectedDeck.length >= deckSize)
                const canToggle = !squadSubmitted && (isSelected || !blocked)
                return (
                  <button key={card.cardId} type="button" aria-pressed={isSelected}
                    title={restriction ?? undefined}
                    onClick={() => canToggle && onToggleCard(card.cardId)}
                    onMouseEnter={() => setFocusCard(card.cardId)} onFocus={() => setFocusCard(card.cardId)}
                    style={{ padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: canToggle ? 'pointer' : 'not-allowed', height: 176, position: 'relative', color: 'inherit' }}>
                    <CardFace card={toTactics(card)} playable={!blocked || isSelected} selected={isSelected} fluid />
                    {isSelected && <span style={{ ...chip(C.amber), position: 'absolute', bottom: 8, right: 8, background: C.amberDeep }}>En el mazo</span>}
                    {restriction && <span style={{ ...chip(C.textDim), position: 'absolute', bottom: 8, left: 8, background: C.panelSolid }}>No disponible</span>}
                  </button>
                )
              })}
            </div>
          </div>
          {!mobile && (
            <aside style={{ borderLeft: `1px solid ${C.line}`, background: C.panelSolid, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              <div style={eyebrow}>Carta</div>
              {preview
                ? <CardFace card={toTactics(preview)} playable large fluid />
                : <p style={{ color: C.textDim, fontSize: 13 }}>Pasa el ratón por una carta para leerla entera.</p>}
              {preview && cardRestriction(toDeckCard(preview), squadCards) && (
                <p style={{ color: C.warn, fontSize: 12.5 }}>{cardRestriction(toDeckCard(preview), squadCards)}</p>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Barra inferior fija: resumen y paso siguiente */}
      <div style={{ borderTop: `1px solid ${C.line}`, background: C.panelSolid, padding: '10px max(16px, env(safe-area-inset-left, 0px))', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {squadStep === 'units' ? (
          <>
            {counter(selectedSquad.length, MAX_SQUAD, 'unidades')}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              {squadCards.map((u, i) => (
                <button key={`${u.cardId}-${i}`} onClick={() => onToggleUnit(u.cardId)} title="Quitar de la escuadra"
                  style={{ ...button('subtle'), borderColor: C.ally, color: C.text }}>{u.name} ✕</button>
              ))}
            </div>
            {squadError && selectedSquad.length === MAX_SQUAD && <span style={{ color: C.warn, fontSize: 12.5 }}>{squadError}</span>}
            <button disabled={squadError !== null} onClick={() => onSetSquadStep('deck')}
              style={{ ...button('amber', squadError !== null), padding: '10px 22px', fontSize: 14, fontWeight: 600 }}>
              Elegir mazo
            </button>
          </>
        ) : (
          <>
            {counter(selectedDeck.length, deckSize, 'cartas')}
            <span style={{ flex: 1 }} />
            <button onClick={() => onSetSquadStep('units')} disabled={squadSubmitted} style={{ ...button('ghost', squadSubmitted), padding: '10px 18px' }}>Volver a la escuadra</button>
            {squadSubmitted
              ? <span style={{ color: C.ok, fontSize: 13.5 }}>Selección confirmada. Esperando al rival…</span>
              : <button disabled={!canConfirm} onClick={() => onConfirm(selectedSquad, selectedDeck)}
                  style={{ ...button('amber', !canConfirm), padding: '10px 22px', fontSize: 14, fontWeight: 600 }}>Confirmar y entrar</button>}
          </>
        )}
      </div>
    </div>
  )
}
