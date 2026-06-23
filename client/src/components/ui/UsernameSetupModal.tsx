import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

interface Props {
  user: User
  suggestion: string
  onDone: (username: string) => void
}

export function UsernameSetupModal({ user, suggestion, onDone }: Props) {
  const [value, setValue] = useState(suggestion)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed.length < 3) { setError('Mínimo 3 caracteres.'); return }
    if (trimmed.length > 32) { setError('Máximo 32 caracteres.'); return }

    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('profiles')
      .update({ username: trimmed })
      .eq('id', user.id)
    setSaving(false)

    if (err) {
      setError(
        err.code === '23505'
          ? 'Ese nombre ya está en uso. Elige otro.'
          : 'Error al guardar. Inténtalo de nuevo.'
      )
    } else {
      onDone(trimmed)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(160deg, #0d0d1a 0%, #0a0a12 60%, #0d0d1a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        background: 'rgba(26,26,46,0.97)',
        border: '1px solid rgba(79,195,247,0.2)',
        borderRadius: 16, padding: '44px 40px',
        width: 360, textAlign: 'center',
        boxShadow: '0 0 60px rgba(79,195,247,0.08)',
      }}>
        <div style={{ fontSize: 13, color: '#4fc3f7', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12 }}>
          GUNDAM
        </div>
        <div style={{ fontSize: 28, fontWeight: 'bold', color: 'white', letterSpacing: 1, marginBottom: 6 }}>
          ASSEMBLE
        </div>

        <div style={{ width: 40, height: 1, background: 'rgba(79,195,247,0.3)', margin: '20px auto' }} />

        <div style={{ color: 'white', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Elige tu nombre de piloto
        </div>
        <div style={{ color: '#666', fontSize: 13, marginBottom: 28 }}>
          Este nombre te identificará en las partidas. Podrás cambiarlo después.
        </div>

        <form onSubmit={handleSubmit}>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Nombre de piloto"
            maxLength={32}
            autoFocus
            style={{
              width: '100%', padding: '13px 16px',
              background: '#0d0d1a', border: '1px solid rgba(79,195,247,0.25)',
              borderRadius: 8, color: 'white', fontSize: 15,
              boxSizing: 'border-box', marginBottom: 8,
              outline: 'none',
            }}
          />
          {error && (
            <div style={{
              color: '#ef5350', fontSize: 12, marginBottom: 12,
              padding: '8px 12px', background: 'rgba(239,83,80,0.1)',
              borderRadius: 6, border: '1px solid rgba(239,83,80,0.2)',
            }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={saving || value.trim().length < 3}
            style={{
              width: '100%', padding: '13px',
              background: saving || value.trim().length < 3 ? '#1a2030' : '#1565c0',
              color: saving || value.trim().length < 3 ? '#444' : 'white',
              border: 'none', borderRadius: 8,
              fontSize: 15, fontWeight: 600,
              cursor: saving ? 'wait' : value.trim().length < 3 ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Guardando...' : 'Entrar al juego'}
          </button>
        </form>
      </div>
    </div>
  )
}
