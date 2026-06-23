import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

interface MatchRow {
  match_id: string
  outcome: 'win' | 'loss' | 'draw' | null
  final_score: number | null
  opponent_name: string | null
  started_at: string | null
  finished_at: string | null
  map_code: string | null
}

interface Props {
  user: User
  profile: { username: string; avatar_url: string | null } | null
  onClose: () => void
  onProfileUpdated: (p: { username: string; avatar_url: string | null }) => void
}

export function ProfileModal({ user, profile, onClose, onProfileUpdated }: Props) {
  const [tab, setTab] = useState<'profile' | 'history'>('profile')
  const [newUsername, setNewUsername] = useState(profile?.username ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  const [matches, setMatches] = useState<MatchRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [deletePhase, setDeletePhase] = useState<'idle' | 'confirm'>('idle')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (tab !== 'history') return
    setHistoryLoading(true)

    type RawPlayer = { seat: number; display_name: string | null; user_id: string | null }
    type RawMatch = { started_at: string | null; finished_at: string | null; map_code: string | null; status: string; match_players: RawPlayer[] }
    type RawRow = { match_id: string; outcome: 'win' | 'loss' | 'draw' | null; final_score: number | null; seat: number; matches: RawMatch }

    supabase
      .from('match_players')
      .select(`
        match_id,
        outcome,
        final_score,
        seat,
        matches!inner(started_at, finished_at, map_code, status, match_players(seat, display_name, user_id))
      `)
      .eq('user_id', user.id)
      .eq('matches.status', 'finished')
      .order('match_id', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        setHistoryLoading(false)
        if (error || !data) return
        const rows: MatchRow[] = (data as unknown as RawRow[]).map(row => {
          const m = row.matches
          const opponent = m.match_players.find(p => p.user_id !== user.id)
          return {
            match_id: row.match_id,
            outcome: row.outcome,
            final_score: row.final_score,
            opponent_name: opponent?.display_name ?? null,
            started_at: m.started_at,
            finished_at: m.finished_at,
            map_code: m.map_code,
          }
        })
        setMatches(rows)
      })
  }, [tab, user.id, profile?.username])

  async function handleSaveUsername() {
    const trimmed = newUsername.trim()
    if (trimmed.length < 3 || trimmed.length > 32) {
      setSaveError('El nombre debe tener entre 3 y 32 caracteres.')
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    const { error } = await supabase
      .from('profiles')
      .update({ username: trimmed })
      .eq('id', user.id)
    setSaving(false)
    if (error) {
      setSaveError(
        error.code === '23505'
          ? 'Ese nombre ya está en uso. Elige otro.'
          : 'Error al guardar. Inténtalo de nuevo.'
      )
    } else {
      setSaveOk(true)
      onProfileUpdated({ username: trimmed, avatar_url: profile?.avatar_url ?? null })
      setTimeout(() => setSaveOk(false), 2500)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/auth/delete-account', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
      })
      if (!res.ok) throw new Error('server error')
      await supabase.auth.signOut()
    } catch {
      setDeleting(false)
      setDeletePhase('idle')
      setSaveError('Error al borrar la cuenta. Inténtalo más tarde.')
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })
  }

  function outcomeColor(o: string | null) {
    if (o === 'win') return '#4caf50'
    if (o === 'loss') return '#ef5350'
    return '#aaa'
  }

  function outcomeLabel(o: string | null) {
    if (o === 'win') return 'Victoria'
    if (o === 'loss') return 'Derrota'
    if (o === 'draw') return 'Empate'
    return '—'
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#1a1a2e',
        border: '1px solid rgba(79,195,247,0.2)',
        borderRadius: 16,
        width: 480,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 0 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 0',
          borderBottom: '1px solid #222',
          paddingBottom: 0,
        }}>
          <div style={{ display: 'flex', gap: 0 }}>
            {(['profile', 'history'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '12px 20px',
                  background: 'none', border: 'none',
                  color: tab === t ? '#4fc3f7' : '#555',
                  fontSize: 13, fontWeight: tab === t ? 700 : 400,
                  cursor: 'pointer',
                  borderBottom: tab === t ? '2px solid #4fc3f7' : '2px solid transparent',
                  transition: 'color 0.15s',
                }}
              >
                {t === 'profile' ? 'Perfil' : 'Historial'}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#555',
              fontSize: 20, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>

          {tab === 'profile' && (
            <>
              {/* Avatar + info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid #333' }}
                  />
                ) : (
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: '#0d0d1a', border: '2px solid #333',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, color: '#4fc3f7',
                  }}>
                    {(profile?.username ?? '?')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>
                    {profile?.username ?? '—'}
                  </div>
                  <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>{user.email}</div>
                </div>
              </div>

              {/* Cambiar nombre */}
              <div style={{ marginBottom: 28 }}>
                <label style={{ display: 'block', color: '#888', fontSize: 12, marginBottom: 8, letterSpacing: 1 }}>
                  NOMBRE DE PILOTO
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    maxLength={32}
                    style={{
                      flex: 1, padding: '10px 14px',
                      background: '#0d0d1a', border: '1px solid #333', borderRadius: 8,
                      color: 'white', fontSize: 14,
                    }}
                  />
                  <button
                    onClick={handleSaveUsername}
                    disabled={saving || newUsername.trim() === profile?.username}
                    style={{
                      padding: '10px 18px',
                      background: saving ? '#1a2a1a' : '#1565c0',
                      color: 'white', border: 'none', borderRadius: 8,
                      cursor: saving ? 'wait' : 'pointer', fontSize: 14,
                      opacity: newUsername.trim() === profile?.username ? 0.4 : 1,
                    }}
                  >
                    {saving ? '...' : 'Guardar'}
                  </button>
                </div>
                {saveError && (
                  <div style={{ color: '#ef5350', fontSize: 12, marginTop: 8 }}>{saveError}</div>
                )}
                {saveOk && (
                  <div style={{ color: '#4caf50', fontSize: 12, marginTop: 8 }}>¡Nombre actualizado!</div>
                )}
              </div>

              <div style={{ height: 1, background: '#222', marginBottom: 24 }} />

              {/* Cerrar sesión */}
              <button
                onClick={() => supabase.auth.signOut()}
                style={{
                  width: '100%', padding: '11px',
                  background: 'transparent', border: '1px solid #333', borderRadius: 8,
                  color: '#aaa', fontSize: 14, cursor: 'pointer', marginBottom: 12,
                }}
              >
                Cerrar sesión
              </button>

              {/* Borrar cuenta */}
              {deletePhase === 'idle' ? (
                <button
                  onClick={() => setDeletePhase('confirm')}
                  style={{
                    width: '100%', padding: '11px',
                    background: 'transparent', border: '1px solid #3a1515', borderRadius: 8,
                    color: '#ef5350', fontSize: 13, cursor: 'pointer',
                  }}
                >
                  Borrar cuenta
                </button>
              ) : (
                <div style={{
                  padding: '16px',
                  background: 'rgba(239,83,80,0.08)',
                  border: '1px solid rgba(239,83,80,0.3)',
                  borderRadius: 8,
                }}>
                  <div style={{ color: '#ef5350', fontSize: 13, marginBottom: 12 }}>
                    ¿Seguro? Esto borrará tu cuenta y todos tus datos permanentemente.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                      style={{
                        flex: 1, padding: '9px',
                        background: '#c62828', border: 'none', borderRadius: 6,
                        color: 'white', fontSize: 13, cursor: deleting ? 'wait' : 'pointer',
                      }}
                    >
                      {deleting ? 'Borrando...' : 'Sí, borrar'}
                    </button>
                    <button
                      onClick={() => setDeletePhase('idle')}
                      style={{
                        flex: 1, padding: '9px',
                        background: 'transparent', border: '1px solid #333', borderRadius: 6,
                        color: '#aaa', fontSize: 13, cursor: 'pointer',
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'history' && (
            <>
              {historyLoading ? (
                <div style={{ color: '#555', textAlign: 'center', padding: '40px 0' }}>
                  Cargando historial...
                </div>
              ) : matches.length === 0 ? (
                <div style={{ color: '#555', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
                  Aún no tienes partidas registradas.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#555', fontSize: 11, letterSpacing: 1 }}>
                      <th style={{ textAlign: 'left', padding: '0 0 10px', fontWeight: 400 }}>RESULTADO</th>
                      <th style={{ textAlign: 'left', padding: '0 0 10px', fontWeight: 400 }}>OPONENTE</th>
                      <th style={{ textAlign: 'center', padding: '0 0 10px', fontWeight: 400 }}>VP</th>
                      <th style={{ textAlign: 'left', padding: '0 0 10px', fontWeight: 400 }}>MAPA</th>
                      <th style={{ textAlign: 'right', padding: '0 0 10px', fontWeight: 400 }}>FECHA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map(m => (
                      <tr
                        key={m.match_id}
                        style={{ borderTop: '1px solid #1e1e30' }}
                      >
                        <td style={{ padding: '10px 0', color: outcomeColor(m.outcome), fontWeight: 600 }}>
                          {outcomeLabel(m.outcome)}
                        </td>
                        <td style={{ padding: '10px 0', color: '#ccc' }}>
                          {m.opponent_name ?? '—'}
                        </td>
                        <td style={{ padding: '10px 0', color: '#888', textAlign: 'center' }}>
                          {m.final_score ?? '—'}
                        </td>
                        <td style={{ padding: '10px 0', color: '#666', fontSize: 11 }}>
                          {m.map_code ?? '—'}
                        </td>
                        <td style={{ padding: '10px 0', color: '#555', textAlign: 'right' }}>
                          {formatDate(m.started_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
