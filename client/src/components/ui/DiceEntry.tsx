import { useEffect, useState } from 'react'
import type { PendingDice } from '../../types/gameState'
import { C, FONT, eyebrow, button } from '../../theme'

interface DiceEntryProps {
  pending: PendingDice
  rollerName: string          // quién tira ("Tú" o el nombre del rival)
  mine: boolean               // tira el jugador (colores)
  onSubmit: (values: number[]) => void
  compact?: boolean
}

// Modo mesa: el jugador mete los dados que han salido en la mesa real.
// Teclado grande del 1 al 10 (el 0 del d10 es un 10); con teclado físico también
// valen los números, el 0 y Retroceso. Tocar un dado ya puesto lo quita.
export function DiceEntry({ pending, rollerName, mine, onSubmit, compact = false }: DiceEntryProps) {
  const [values, setValues] = useState<number[]>([])
  const full = values.length >= pending.count
  const add = (v: number) => setValues(prev => (prev.length >= pending.count ? prev : [...prev, v]))
  const color = mine ? C.ally : C.enemy

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); add(e.key === '0' ? 10 : Number(e.key)) }
      else if (e.key === 'Backspace') { e.preventDefault(); setValues(prev => prev.slice(0, -1)) }
      else if (e.key === 'Enter' && values.length === pending.count) { e.preventDefault(); onSubmit(values) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div role="dialog" aria-label="Introducir dados" style={{
      position: 'absolute', zIndex: 40,
      ...(compact
        ? { left: 0, right: 0, bottom: 0, borderRadius: '14px 14px 0 0', padding: '14px max(14px, env(safe-area-inset-left, 0px)) calc(14px + env(safe-area-inset-bottom, 0px))' }
        : { left: '50%', bottom: 16, transform: 'translateX(-50%)', width: 440, borderRadius: 14, padding: 16 }),
      background: C.panelSolid, border: `1px solid ${color}aa`, boxShadow: '0 -8px 40px rgba(0,0,0,0.55)',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...eyebrow, color }}>{mine ? 'Tiras tú' : `Tira ${rollerName}`}</span>
        <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 20 }}>{pending.count} {pending.count === 1 ? 'dado' : 'dados'}</span>
        <span style={{ fontSize: 13, color: C.textSoft, flexBasis: '100%' }}>{pending.reason}</span>
      </div>

      {/* Dados puestos (tocar para quitar) */}
      <div aria-live="polite" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 44 }}>
        {Array.from({ length: pending.count }, (_, i) => {
          const v = values[i]
          return (
            <button key={i} type="button" disabled={v === undefined} onClick={() => setValues(prev => prev.filter((_, j) => j !== i))}
              aria-label={v === undefined ? `Dado ${i + 1} sin poner` : `Dado ${i + 1}: ${v}. Tocar para quitarlo`}
              style={{
                width: 42, height: 42, borderRadius: 8, fontFamily: FONT.mono, fontWeight: 700, fontSize: 17,
                background: v === undefined ? 'transparent' : v >= 9 ? C.amberDeep : C.panelRaised,
                color: v === 1 ? C.textDim : v !== undefined && v >= 9 ? C.amber : C.text,
                border: `1px ${v === undefined ? 'dashed' : 'solid'} ${v === undefined ? C.lineStrong : v >= 9 ? C.amber : C.lineStrong}`,
                cursor: v === undefined ? 'default' : 'pointer',
              }}>{v ?? ''}</button>
          )
        })}
      </div>

      {/* Teclado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
          <button key={n} type="button" disabled={full} onClick={() => add(n)}
            style={{ ...button(n >= 9 ? 'amber' : 'subtle', full), minHeight: compact ? 52 : 44, fontFamily: FONT.mono, fontSize: 18, fontWeight: 700 }}>
            {n}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: C.textDim, flex: 1 }}>El 0 del dado es un 10. Pon los dados en cualquier orden.</span>
        <button type="button" onClick={() => setValues(prev => prev.slice(0, -1))} disabled={!values.length} style={button('ghost', !values.length)}>Borrar</button>
        <button type="button" disabled={values.length !== pending.count} onClick={() => onSubmit(values)}
          style={{ ...button('primary', values.length !== pending.count), padding: '10px 18px', fontWeight: 600 }}>Confirmar</button>
      </div>
    </div>
  )
}
