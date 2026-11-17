import type { PlaySuggestion } from '../../types/gameState'
import { C, FONT, eyebrow, button } from '../../theme'

interface AdvisorPanelProps {
  plays: PlaySuggestion[] | null      // null = cargando
  error: string | null
  onHover: (play: PlaySuggestion | null) => void
  onClose: () => void
  compact?: boolean
}

const fmt = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })}`

// Consejero: las 3 mejores activaciones según el bot experto, con de dónde sale su
// valor. Al pasar el ratón por una jugada se marcan en el tablero su casilla final y
// su objetivo. Solo informa: el jugador decide y hace las acciones él mismo.
export function AdvisorPanel({ plays, error, onHover, onClose, compact = false }: AdvisorPanelProps) {
  return (
    <div role="dialog" aria-label="Consejero" style={{
      // Junto a la ficha de la unidad (escritorio), para dejar a la vista el centro del tablero
      position: 'absolute', zIndex: 32, top: compact ? 8 : 12,
      ...(compact ? { left: 8, right: 8 } : { left: 324, width: 380 }),
      maxHeight: '70%', overflowY: 'auto',
      background: C.panel, border: `1px solid ${C.amber}88`, borderRadius: 12, padding: '12px 14px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...eyebrow, color: C.amber }}>Consejero</span>
        <span style={{ fontSize: 12, color: C.textDim, flex: 1 }}>Lo que haría el bot experto con esta unidad</span>
        <button type="button" onClick={onClose} style={button('ghost')} aria-label="Cerrar el consejero">Cerrar</button>
      </div>
      {error && <div style={{ fontSize: 13, color: C.textSoft }}>{error}</div>}
      {!error && plays === null && <div style={{ fontSize: 13, color: C.textSoft }}>Pensando…</div>}
      {!error && plays?.length === 0 && <div style={{ fontSize: 13, color: C.textSoft }}>No hay jugadas que proponer ahora.</div>}
      {plays?.map((p, i) => (
        <div key={i} tabIndex={0} onMouseEnter={() => onHover(p)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(p)} onBlur={() => onHover(null)}
          style={{ border: `1px solid ${i === 0 ? C.amber + '99' : C.line}`, borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, background: i === 0 ? C.amberDeep + '55' : 'transparent', outline: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 14 }}>{i === 0 ? 'Mejor jugada' : `Alternativa ${i}`}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: FONT.mono, fontSize: 12, color: C.textSoft }}>{p.tl} TL · valor {fmt(p.score)}</span>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {p.steps.map((s, j) => <li key={j}>{s}</li>)}
          </ol>
          {p.parts.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {p.parts.map((x, j) => (
                <li key={j} style={{ display: 'flex', gap: 8, color: C.textSoft }}>
                  <span style={{ fontFamily: FONT.mono, minWidth: 44, textAlign: 'right', color: x.value >= 0 ? C.ok : C.warn }}>{fmt(x.value)}</span>
                  <span>{x.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {plays && plays.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.textDim }}>
          Valores en VP aproximados: daño y derribos esperados, Objetivos, peligro de los enemigos que activan antes y Timeline gastado. Pasa el ratón por una jugada para verla en el tablero.
        </div>
      )}
    </div>
  )
}
