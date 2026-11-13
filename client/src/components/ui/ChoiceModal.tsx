import { useState } from 'react'

import type { ChoiceOption } from './choiceOptions'

// Petición de elección al jugador:
//  - single: elegir una opción (p.ej. el tipo de Upgrade)
//  - rows:   asignar una opción a cada fila (p.ej. qué unidad se queda cada Upgrade)
export type ChoiceRequest =
  | { kind: 'single'; title: string; options: ChoiceOption[]; onPick: (value: string) => void }
  | { kind: 'rows'; title: string; rows: { id: string; label: string }[]; options: ChoiceOption[]; initial?: string[]; onConfirm: (values: string[]) => void }

const box: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const panel: React.CSSProperties = {
  background: '#141428', border: '1px solid #4fc3f7', borderRadius: 10, padding: '18px 22px',
  minWidth: 320, maxWidth: 'calc(100vw - 32px)', color: 'white', fontSize: 13,
}
const btn = (active = false): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
  border: `1px solid ${active ? '#4fc3f7' : '#444'}`, background: active ? '#1565c0' : '#222', color: 'white',
})

export function ChoiceModal({ request, onCancel }: { request: ChoiceRequest; onCancel: () => void }) {
  const [values, setValues] = useState<string[]>(
    request.kind === 'rows' ? (request.initial ?? request.rows.map(() => request.options[0].value)) : [])

  return (
    <div style={box} onClick={onCancel}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 'bold', color: '#4fc3f7', marginBottom: 12 }}>{request.title}</div>

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
                  <span style={{ minWidth: 120, color: '#ccc' }}>{row.label}</span>
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
