import type { User } from '@supabase/supabase-js'
import { ProfileModal } from '../components/ui/ProfileModal'

interface LobbyScreenProps {
  user: User
  profile: { username: string; avatar_url: string | null } | null
  connected: boolean
  playerName: string
  onPlayerNameChange: (name: string) => void
  isSearching: boolean
  lobbyMode: 'main' | 'private'
  onSetLobbyMode: (mode: 'main' | 'private') => void
  lobbyError: string
  onClearLobbyError: () => void
  roomInput: string
  onRoomInputChange: (value: string) => void
  showProfile: boolean
  onShowProfile: (show: boolean) => void
  onProfileUpdated: (p: { username: string; avatar_url: string | null }) => void
  onFindMatch: () => void
  onCancelMatch: () => void
  onCreateRoom: () => void
  onJoinRoom: () => void
}

export function LobbyScreen({
  user, profile, connected, playerName, onPlayerNameChange,
  isSearching, lobbyMode, onSetLobbyMode,
  lobbyError, onClearLobbyError, roomInput, onRoomInputChange,
  showProfile, onShowProfile, onProfileUpdated,
  onFindMatch, onCancelMatch, onCreateRoom, onJoinRoom,
}: LobbyScreenProps) {
  const canPlay = playerName.trim().length > 0 && connected

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0d0d1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a2e', border: '1px solid #333', borderRadius: 14,
        padding: '36px 44px', width: 380, color: 'white',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28, position: 'relative' }}>
          <button
            onClick={() => onShowProfile(true)}
            title="Perfil"
            style={{
              position: 'absolute', top: 0, right: 0,
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 4, padding: 4,
            }}
          >
            {[0, 1, 2].map(i => (
              <span key={i} style={{ display: 'block', width: 18, height: 2, background: '#555', borderRadius: 1 }} />
            ))}
          </button>

          <div style={{ fontSize: 26, fontWeight: 'bold', color: '#4fc3f7', letterSpacing: 2 }}>
            GUNDAM ASSEMBLE
          </div>
          <div style={{ fontSize: 12, color: connected ? '#4caf50' : '#ef5350', marginTop: 6 }}>
            {connected ? '● Conectado' : '● Desconectado'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
            {profile?.avatar_url && (
              <img src={profile.avatar_url} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
            )}
            <span style={{ fontSize: 11, color: '#666' }}>{profile?.username ?? user.email}</span>
          </div>
        </div>

        {showProfile && (
          <ProfileModal
            user={user}
            profile={profile}
            onClose={() => onShowProfile(false)}
            onProfileUpdated={onProfileUpdated}
          />
        )}

        <input
          value={playerName}
          onChange={e => onPlayerNameChange(e.target.value)}
          placeholder="Tu nombre de piloto"
          style={{
            width: '100%', padding: '11px 14px', marginBottom: 24,
            background: '#0d0d1a', border: '1px solid #444', borderRadius: 8,
            color: 'white', fontSize: 14, boxSizing: 'border-box',
          }}
        />

        {isSearching ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, color: '#f5c518', marginBottom: 8, fontWeight: 'bold' }}>
              Buscando oponente...
            </div>
            <div style={{ color: '#555', fontSize: 12, marginBottom: 20 }}>
              Esperando que alguien más entre en cola
            </div>
            <button
              onClick={onCancelMatch}
              style={{
                width: '100%', padding: '11px',
                background: 'transparent', color: '#aaa',
                border: '1px solid #444', borderRadius: 8,
                cursor: 'pointer', fontSize: 14,
              }}
            >
              Cancelar búsqueda
            </button>
          </div>
        ) : lobbyMode === 'main' ? (
          <>
            <button
              disabled={!canPlay}
              onClick={onFindMatch}
              style={{
                width: '100%', padding: '14px', marginBottom: 12,
                background: canPlay ? '#1565c0' : '#222',
                color: canPlay ? 'white' : '#555',
                border: 'none', borderRadius: 8,
                cursor: canPlay ? 'pointer' : 'not-allowed',
                fontSize: 15, fontWeight: 'bold',
              }}
            >
              Buscar partida
            </button>
            <button
              disabled={!canPlay}
              onClick={() => onSetLobbyMode('private')}
              style={{
                width: '100%', padding: '11px',
                background: 'transparent',
                color: canPlay ? '#aaa' : '#444',
                border: `1px solid ${canPlay ? '#444' : '#2a2a2a'}`,
                borderRadius: 8,
                cursor: canPlay ? 'pointer' : 'not-allowed',
                fontSize: 14,
              }}
            >
              Sala privada →
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onCreateRoom}
              disabled={!canPlay}
              style={{
                width: '100%', padding: '12px', marginBottom: 12,
                background: '#2e7d32', color: 'white', border: 'none',
                borderRadius: 8, cursor: canPlay ? 'pointer' : 'not-allowed',
                fontSize: 14, fontWeight: 'bold',
                opacity: canPlay ? 1 : 0.4,
              }}
            >
              Crear sala
            </button>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                value={roomInput}
                onChange={e => onRoomInputChange(e.target.value.toUpperCase())}
                placeholder="Código de sala"
                style={{
                  flex: 1, padding: '10px 14px',
                  background: '#0d0d1a', border: '1px solid #444', borderRadius: 8,
                  color: 'white', fontSize: 14,
                }}
              />
              <button
                onClick={onJoinRoom}
                disabled={!canPlay || !roomInput.trim()}
                style={{
                  padding: '10px 18px', background: '#1565c0', color: 'white',
                  border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
                }}
              >
                Unirse
              </button>
            </div>
            <button
              onClick={() => { onSetLobbyMode('main'); onClearLobbyError() }}
              style={{
                width: '100%', padding: '9px',
                background: 'transparent', color: '#666',
                border: '1px solid #2a2a2a', borderRadius: 8,
                cursor: 'pointer', fontSize: 13,
              }}
            >
              ← Volver
            </button>
            {lobbyError && (
              <div style={{ color: '#ef5350', fontSize: 13, marginTop: 10, textAlign: 'center' }}>
                {lobbyError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
