import { useState } from 'react'

import type { ChoiceOption } from './choiceOptions'
import { C, FONT, button } from '../../theme'

// Petición de elección al jugador:
//  - single: elegir una opción (p.ej. el tipo de Upgrade)
//  - rows:   asignar una opción a cada fila (p.ej. qué unidad se queda cada Upgrade)
export type ChoiceRequest =
  | { kind: 'single'; title: string; options: ChoiceOption[]; onPick: (value: string) => void }
  | { kind: 'rows'; title: string; rows: { id: string; label: string }[]; options: ChoiceOption[]; initial?: string[]; onConfirm: (values: string[]) => void }

const box: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(4,7,15,0.7)', zIndex: 100, backdropFilter: 'blur(3px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const panel: React.CSSProperties = {
  background: C.panel, border: `1px solid ${C.ally}`, borderRadius: 12, padding: '18px 22px',
  minWidth: 320, maxWidth: 'calc(100vw - 32px)', color: C.text, fontSize: 13, boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
}
const btn = (active = false): React.CSSProperties => button(active ? 'primary' : 'subtle')

export function ChoiceModal({ request, onCancel }: { request: ChoiceRequest; onCancel: () => void }) {
  const [values, setValues] = useState<string[]>(
    request.kind === 'rows' ? (request.initial ?? request.rows.map(() => request.options[0].value)) : [])

  return (
    <div style={box} onClick={onCancel}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 16, color: C.ally, marginBottom: 12 }}>{request.title}</div>

        {request.kind === 'single' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {request.options.map(o => (
              <button key={o.value} style={btn()} onClick={() => request.onPick(o.value)}>{o.label}</button>
            ))}
          </div>
        )}

        {request.kind === 'rows' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {request.rows.map((row, i) => (
                <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 120, color: C.textSoft }}>{row.label}</span>
                  {request.options.map(o => (
                    <button key={o.value} style={btn(values[i] === o.value)}
                      onClick={() => setValues(v => v.map((x, j) => (j === i ? o.value : x)))}>{o.label}</button>
                  ))}
                </div>
              ))}
            </div>
            <button style={btn(true)} onClick={() => request.onConfirm(values)}>Confirmar</button>
          </>
        )}

        <button style={{ ...btn(), marginLeft: request.kind === 'rows' ? 8 : 0, marginTop: request.kind === 'single' ? 12 : 0 }} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
