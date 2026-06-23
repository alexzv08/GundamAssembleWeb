import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const SITE_URL = window.location.origin

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style={{ flexShrink: 0 }}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.03.05a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  )
}

const IS_DEV = import.meta.env.DEV

export function AuthScreen() {
  const [loading, setLoading] = useState<'google' | 'discord' | 'email' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [devEmail, setDevEmail] = useState('')
  const [devPassword, setDevPassword] = useState('')

  async function signIn(provider: 'google' | 'discord') {
    setLoading(provider)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: SITE_URL },
    })
    if (error) {
      setError('Error al conectar con ' + (provider === 'google' ? 'Google' : 'Discord') + '. Inténtalo de nuevo.')
      setLoading(null)
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setLoading('email')
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: devEmail, password: devPassword })
    if (error) {
      setError(error.message)
      setLoading(null)
    }
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'linear-gradient(160deg, #0d0d1a 0%, #0a0a12 60%, #0d0d1a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Fondo decorativo */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute', top: '20%', left: '15%',
          width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(79,195,247,0.06) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '20%', right: '15%',
          width: 250, height: 250, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(239,83,80,0.06) 0%, transparent 70%)',
        }} />
      </div>

      <div style={{
        background: 'rgba(26,26,46,0.95)',
        border: '1px solid rgba(79,195,247,0.2)',
        borderRadius: 16, padding: '48px 44px',
        width: 380, textAlign: 'center',
        boxShadow: '0 0 60px rgba(79,195,247,0.08)',
        position: 'relative',
      }}>
        {/* Logo / título */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: '#4fc3f7', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12 }}>
            GUNDAM
          </div>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: 'white', letterSpacing: 1 }}>
            ASSEMBLE
          </div>
          <div style={{ fontSize: 11, color: '#555', letterSpacing: 3, marginTop: 4 }}>
            TACTICAL SIMULATOR
          </div>
        </div>

        <div style={{ width: 40, height: 1, background: 'rgba(79,195,247,0.3)', margin: '24px auto' }} />

        <div style={{ color: '#888', fontSize: 13, marginBottom: 32 }}>
          Accede para guardar tu progreso
        </div>

        {/* Google */}
        <button
          onClick={() => signIn('google')}
          disabled={loading !== null}
          style={{
            width: '100%', padding: '13px 20px',
            display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center',
            background: loading === 'google' ? '#e8e8e8' : 'white',
            color: '#3c4043', border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            marginBottom: 12, transition: 'background 0.15s',
            opacity: loading !== null && loading !== 'google' ? 0.5 : 1,
          }}
        >
          <GoogleIcon />
          {loading === 'google' ? 'Conectando…' : 'Continuar con Google'}
        </button>

        {/* Discord */}
        <button
          onClick={() => signIn('discord')}
          disabled={loading !== null}
          style={{
            width: '100%', padding: '13px 20px',
            display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center',
            background: loading === 'discord' ? '#4752c4' : '#5865F2',
            color: 'white', border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            marginBottom: 24, transition: 'background 0.15s',
            opacity: loading !== null && loading !== 'discord' ? 0.5 : 1,
          }}
        >
          <DiscordIcon />
          {loading === 'discord' ? 'Conectando…' : 'Continuar con Discord'}
        </button>

        {error && (
          <div style={{
            color: '#ef5350', fontSize: 12, marginBottom: 16,
            padding: '8px 12px', background: 'rgba(239,83,80,0.1)',
            borderRadius: 6, border: '1px solid rgba(239,83,80,0.2)',
          }}>
            {error}
          </div>
        )}

        {/* Formulario de email — solo en desarrollo */}
        {IS_DEV && (
          <form onSubmit={signInWithEmail} style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            }}>
              <div style={{ flex: 1, height: 1, background: '#222' }} />
              <span style={{ color: '#333', fontSize: 10, letterSpacing: 1, whiteSpace: 'nowrap' }}>
                DEV — email
              </span>
              <div style={{ flex: 1, height: 1, background: '#222' }} />
            </div>
            <input
              type="email"
              placeholder="email"
              value={devEmail}
              onChange={e => setDevEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '9px 12px', marginBottom: 8,
                background: '#0d0d1a', border: '1px solid #2a2a3a',
                borderRadius: 6, color: '#aaa', fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
            <input
              type="password"
              placeholder="contraseña"
              value={devPassword}
              onChange={e => setDevPassword(e.target.value)}
              required
              style={{
                width: '100%', padding: '9px 12px', marginBottom: 10,
                background: '#0d0d1a', border: '1px solid #2a2a3a',
                borderRadius: 6, color: '#aaa', fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              disabled={loading !== null}
              style={{
                width: '100%', padding: '9px',
                background: loading === 'email' ? '#1a2a1a' : '#1a2a1a',
                border: '1px solid #2a3a2a', borderRadius: 6,
                color: '#4caf50', fontSize: 13, fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading === 'email' ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}

        <div style={{ color: '#444', fontSize: 11, lineHeight: 1.5 }}>
          Al acceder aceptas el uso de tu perfil para identificarte en el juego.
          No compartimos tus datos con terceros.
        </div>
      </div>
    </div>
  )
}
