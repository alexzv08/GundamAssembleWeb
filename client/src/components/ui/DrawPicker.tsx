import { useState } from 'react'
import type { TacticsCard } from '../../types/tactics'
import { C, FONT, eyebrow, button } from '../../theme'
import { CardFace } from './TacticsHand'

interface DrawPickerProps {
  deck: TacticsCard[]
  count: number                 // cuántas has robado en la mesa
  onConfirm: (cardIds: string[]) => void
  onLater: () => void
  compact?: boolean
}

// Modo mesa: el mazo real está en la mesa. Cuando robas, eliges aquí qué cartas
// te han salido para que la app (y el consejero) sepan tu mano.
export function DrawPicker({ deck, count, onConfirm, onLater, compact = false }: DrawPickerProps) {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.length < count ? [...p, id] : p)
  return (
    <div role="dialog" aria-label="Cartas robadas" style={{ position: 'absolute', inset: 0, zIndex: 45, background: 'rgba(4,8,18,0.72)', display: 'grid', placeItems: compact ? 'end stretch' : 'center', backdropFilter: 'blur(3px)' }}>
      <div style={{
        background: C.panelSolid, border: `1px solid ${C.ally}88`, borderRadius: compact ? '14px 14px 0 0' : 14,
        padding: compact ? '14px max(14px, env(safe-area-inset-left, 0px)) calc(14px + env(safe-area-inset-bottom, 0px))' : 18,
        width: compact ? '100%' : 'min(760px, calc(100% - 32px))', maxHeight: compact ? '85%' : '86%', display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ ...eyebrow, color: C.ally }}>Robas {count} {count === 1 ? 'carta' : 'cartas'}</span>
          <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 18 }}>¿Cuáles te han salido?</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 13, color: picked.length === count ? C.ok : C.textSoft, marginLeft: 'auto' }}>{picked.length} / {count}</span>
        </div>
        <div style={{ overflowY: 'auto', display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 96 : 120}px, 1fr))`, gap: 10, padding: 2 }}>
          {deck.map(c => {
            const on = picked.includes(c.id)
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={on} title={c.name}
                style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', opacity: !on && picked.length >= count ? 0.45 : 1 }}>
                <CardFace card={c} playable selected={on} fluid />
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.textDim, flex: 1 }}>Puedes elegirlas luego desde la barra de la mesa.</span>
          <button type="button" onClick={onLater} style={button('ghost')}>Más tarde</button>
          <button type="button" disabled={!picked.length} onClick={() => onConfirm(picked)}
            style={{ ...button('primary', !picked.length), padding: '10px 18px', fontWeight: 600 }}>Confirmar</button>
        </div>
      </div>
    </div>
  )
}
