import { useState } from 'react'
import type { ReplaySummary } from '../types/gameState'
import type { User } from '@supabase/supabase-js'
import { ProfileModal } from '../components/ui/ProfileModal'
import { MapThumb } from '../components/ui/MapThumb'
import { UnitModelViewer } from '../components/ui/UnitCardPreview'
import { C, FONT, eyebrow, button } from '../theme'
import { useIsMobile } from '../game/useIsMobile'
import { Disclaimer, BetaBadge } from '../components/ui/Disclaimer'

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
  onPlayBot: (level: 'facil' | 'normal' | 'dificil' | 'experto') => void
  maps: { id: string; name: string; description?: string }[]
  mapId: string
  onMapIdChange: (id: string) => void
  squadSize: number
  onSquadSizeChange: (n: number) => void
  onSpectate: () => void
  onListReplays: () => Promise<ReplaySummary[]>
  onOpenReplay: (id: string) => void
}

const input: React.CSSProperties = {
  width: '100%', padding: '10px 12px', background: C.bgDeep, border: `1px solid ${C.lineStrong}`,
  borderRadius: 8, color: C.text, fontSize: 14,
}

// Lobby: portada con un modelo girando y, al lado, la partida a preparar
// (mapa con vista previa y tamaño de escuadra) y las tres formas de jugar.
export function LobbyScreen({
  user, profile, connected, playerName, onPlayerNameChange, isSearching, lobbyMode, onSetLobbyMode,
  lobbyError, onClearLobbyError, roomInput, onRoomInputChange, showProfile, onShowProfile, onProfileUpdated,
  onFindMatch, onCancelMatch, onCreateRoom, onJoinRoom, onPlayBot, maps, mapId, onMapIdChange, squadSize, onSquadSizeChange,
  onSpectate, onListReplays, onOpenReplay,
}: LobbyScreenProps) {
  const mobile = useIsMobile()
  // Contra la máquina también deja elegir mapa y tamaño antes de empezar
  const [botSetup, setBotSetup] = useState(false)
  const [botLevel, setBotLevel] = useState<'facil' | 'normal' | 'dificil' | 'experto'>('normal')
  const canPlay = playerName.trim().length > 0 && connected
  const [replays, setReplays] = useState<ReplaySummary[] | null>(null)
  const [loadingReplays, setLoadingReplays] = useState(false)
  const openReplays = () => {
    setLoadingReplays(true)
    onListReplays().then(setReplays).catch(() => setReplays([])).finally(() => setLoadingReplays(false))
  }

  return (
    <div style={{
      width: '100vw', minHeight: '100dvh', height: '100dvh', overflowY: 'auto', color: C.text,
      background: `radial-gradient(900px 520px at 22% 40%, ${C.allyDeep}88, transparent 70%), radial-gradient(700px 400px at 90% 110%, ${C.enemyDeep}66, transparent 70%), ${C.bg}`,
      display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 1.1fr) minmax(360px, 440px)', alignItems: 'center',
      gap: 24, padding: '24px max(16px, env(safe-area-inset-left, 0px))',
    }}>
      {showProfile && <ProfileModal user={user} profile={profile} onClose={() => onShowProfile(false)} onProfileUpdated={onProfileUpdated} />}

      {/* Portada */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: mobile ? 'center' : 'flex-start', gap: 6, minWidth: 0 }}>
        <span style={{ ...eyebrow, color: C.ally, letterSpacing: '0.4em' }}>Gundam</span>
        <h1 style={{ fontSize: mobile ? 44 : 76, lineHeight: 0.95, fontWeight: 700, letterSpacing: '0.04em' }}>ASSEMBLE</h1>
        <span style={{ fontFamily: FONT.mono, fontSize: 12, color: C.textSoft, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Simulador táctico · Core Rulebook v1.2</span>
        <BetaBadge />
        {!mobile && (
          <div style={{ width: '100%', maxWidth: 560, height: 420, marginTop: 8 }} aria-hidden>
            <UnitModelViewer cardId="ST01-U01" distance={2.75} />
          </div>
        )}
      </div>

      {/* Panel de juego */}
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {profile?.avatar_url
            ? <img src={profile.avatar_url} alt="" style={{ width: 34, height: 34, borderRadius: '50%' }} />
            : <span style={{ width: 34, height: 34, borderRadius: '50%', background: C.allyDeep, display: 'grid', placeItems: 'center', fontFamily: FONT.display, fontWeight: 700 }}>{(playerName || '?')[0]?.toUpperCase()}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="pilot-name" style={eyebrow}>Piloto</label>
            <input id="pilot-name" value={playerName} onChange={e => onPlayerNameChange(e.target.value)} placeholder="Tu nombre de piloto" maxLength={32}
              style={{ ...input, padding: '4px 0', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.line}`, borderRadius: 0, fontFamily: FONT.display, fontWeight: 600, fontSize: 17 }} />
          </div>
          <button onClick={() => onShowProfile(true)} style={button('subtle')} title={profile?.username ?? user.email ?? 'Perfil'}>Perfil</button>
        </div>
        <span style={{ fontSize: 12, color: connected ? C.ok : C.danger }}>{connected ? '● Conectado al servidor' : '● Sin conexión con el servidor'}</span>

        {isSearching ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '20px 0' }}>
            <span style={{ fontFamily: FONT.display, fontSize: 20, color: C.amber, animation: 'ga-pulse 1.6s infinite' }}>Buscando rival…</span>
            <span style={{ color: C.textSoft, fontSize: 13 }}>Te emparejamos con el siguiente jugador que entre en cola.</span>
            <button onClick={onCancelMatch} style={{ ...button('ghost'), width: '100%', padding: 11 }}>Cancelar búsqueda</button>
          </div>
        ) : (
          <>
            {lobbyMode === 'main' && replays ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700 }}>Tus repeticiones</span>
                {replays.length === 0 && <span style={{ color: C.textSoft, fontSize: 13 }}>Aún no hay partidas terminadas. Al acabar una, aparecerá aquí.</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                  {replays.map(r => {
                    const me = r.mySide ?? null
                    const result = !r.winner ? 'Empate' : me ? (r.winner === me ? 'Victoria' : 'Derrota') : `Gana ${r.players[r.winner]}`
                    const color = !r.winner ? C.textSoft : me ? (r.winner === me ? C.amber : C.enemy) : C.text
                    return (
                      <button key={r.id} type="button" onClick={() => onOpenReplay(r.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: C.text, background: C.panelSolid, border: `1px solid ${C.line}` }}>
                        <MapThumb mapId={r.mapId} size={44} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                          <b style={{ fontFamily: FONT.display, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.players.player1} vs {r.players.player2}</b>
                          <span style={{ fontSize: 11.5, color: C.textSoft }}>{new Date(r.createdAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })} · {r.steps} {r.steps === 1 ? 'paso' : 'pasos'}{r.vsBot ? ' · contra la máquina' : ''}</span>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 13, color, textTransform: 'uppercase' }}>{result}</span>
                          <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.textSoft }}>{r.vp.player1}–{r.vp.player2} VP</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button onClick={() => setReplays(null)} style={button('ghost')}>Volver</button>
              </div>
            ) : lobbyMode === 'main' && botSetup ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700 }}>Partida contra la máquina</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={eyebrow}>Mapa</span>
                  <MapPicker maps={maps} mapId={mapId} onChange={onMapIdChange} />
                  <span style={eyebrow}>Tamaño de escuadra</span>
                  <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label="Tamaño de escuadra">
                {[3, 5].map(n => (
                  <button key={n} type="button" role="radio" aria-checked={squadSize === n} onClick={() => onSquadSizeChange(n)}
                    style={{ ...button(squadSize === n ? 'primary' : 'subtle'), flex: 1 }}>Escuadras de {n}</button>
                ))}
              </div>
            </div>
                <span style={eyebrow}>Dificultad</span>
                <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label="Dificultad de la máquina">
                  {([['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil'], ['experto', 'Experto']] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={botLevel === v} onClick={() => setBotLevel(v)}
                      style={{ ...button(botLevel === v ? 'primary' : 'subtle'), flex: 1 }}>{label}</button>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: C.textDim }}>
                  {botLevel === 'experto' ? 'Planifica cada activación completa: concentra el fuego, se cubre y pelea los Objetivos.' : botLevel === 'dificil' ? 'Elige el mejor ataque y la mejor casilla, paso a paso.' : botLevel === 'normal' ? 'Juega con sentido, pero se equivoca a veces.' : 'Ataca lo que tiene a mano y avanza hacia ti.'}
                  {' '}En las partidas contra la máquina tienes un consejero que te propone jugadas.
                </span>
                <button disabled={!canPlay} onClick={() => onPlayBot(botLevel)} style={{ ...button('amber', !canPlay), padding: 12, fontWeight: 600 }}>Empezar</button>
                <button onClick={() => setBotSetup(false)} style={button('ghost')}>Volver</button>
              </div>
            ) : lobbyMode === 'main' ? (
              <nav aria-label="Modos de juego" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={eyebrow}>¿Cómo quieres jugar?</span>
                <ModeOption disabled={!canPlay} onClick={onFindMatch} icon="⚔"
                  title="Buscar partida" text="Contra otro jugador conectado. Escuadras de 3." />
                <ModeOption disabled={!canPlay} onClick={() => setBotSetup(true)} icon="◎"
                  title="Contra la máquina" text="Práctica contra la IA: eliges tamaño de escuadra y dificultad." />
                <ModeOption disabled={!canPlay} onClick={() => onSetLobbyMode('private')} icon="⌂"
                  title="Sala privada" text="Crea una sala y comparte el enlace, o únete con un código." />
                <ModeOption disabled={!connected || loadingReplays} onClick={openReplays} icon="▶" compact
                  title={loadingReplays ? 'Cargando…' : 'Repeticiones'} text="Vuelve a ver tus partidas terminadas." />
              </nav>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700 }}>Sala privada</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={eyebrow}>Mapa</span>
                  <MapPicker maps={maps} mapId={mapId} onChange={onMapIdChange} />
                  <span style={eyebrow}>Tamaño de escuadra</span>
                  <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label="Tamaño de escuadra">
                {[3, 5].map(n => (
                  <button key={n} type="button" role="radio" aria-checked={squadSize === n} onClick={() => onSquadSizeChange(n)}
                    style={{ ...button(squadSize === n ? 'primary' : 'subtle'), flex: 1 }}>Escuadras de {n}</button>
                ))}
              </div>
            </div>
                <button onClick={onCreateRoom} disabled={!canPlay} style={{ ...button('amber', !canPlay), padding: 12, fontWeight: 600 }}>Crear sala con este mapa</button>
                <span style={eyebrow}>O únete a la sala de otro jugador</span>
                <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); onJoinRoom() }}>
                  <input id="room-code" value={roomInput} onChange={e => onRoomInputChange(e.target.value.toUpperCase())} placeholder="Código de sala" maxLength={6}
                    style={{ ...input, flex: 1, minWidth: 0, fontFamily: FONT.mono, letterSpacing: '0.2em' }} />
                  <button type="submit" disabled={!canPlay || !roomInput.trim()} style={{ ...button('primary', !canPlay || !roomInput.trim()), padding: '0 16px' }}>Unirse</button>
                </form>
                <button type="button" disabled={!connected || !roomInput.trim()} onClick={onSpectate} style={button('subtle', !connected || !roomInput.trim())}
                  title="Mira una partida en curso sin jugar">Ver como espectador</button>
                <button onClick={() => { onSetLobbyMode('main'); onClearLobbyError() }} style={button('ghost')}>Volver</button>
                {lobbyError && <div role="alert" style={{ color: C.danger, fontSize: 13 }}>{lobbyError}</div>}
              </div>
            )}
          </>
        )}
      </div>

      <Disclaimer style={{ gridColumn: '1 / -1', alignSelf: 'end', paddingTop: 8 }} />
    </div>
  )
}

// Opción del menú principal: todas iguales y sin destacar ninguna (antes parecían
// botones ya pulsados); se iluminan solo al pasar el ratón o con el foco del teclado.
function ModeOption({ title, text, icon, onClick, disabled = false, compact = false }: {
  title: string; text: string; icon: string; onClick: () => void; disabled?: boolean; compact?: boolean
}) {
  const [hot, setHot] = useState(false)
  const lit = hot && !disabled
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)} onBlur={() => setHot(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
        padding: compact ? '8px 12px' : '12px 14px', borderRadius: 10, color: C.text,
        background: lit ? C.panelRaised : 'transparent', border: `1px solid ${lit ? C.ally : C.line}`,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
        transition: 'background 120ms, border-color 120ms', outline: 'none',
      }}>
      <span aria-hidden style={{ width: 30, textAlign: 'center', fontSize: compact ? 15 : 19, color: lit ? C.ally : C.textSoft }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <b style={{ fontFamily: FONT.display, fontSize: compact ? 14 : 16, fontWeight: 600 }}>{title}</b>
        <span style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.35 }}>{text}</span>
      </span>
      <span aria-hidden style={{ color: lit ? C.ally : C.textDim, fontSize: 18 }}>›</span>
    </button>
  )
}

// Selector de mapa. Con un solo mapa es solo informativo (no un botón "marcado").
function MapPicker({ maps, mapId, onChange }: { maps: { id: string; name: string; description?: string }[]; mapId: string; onChange: (id: string) => void }) {
  const card = (selected: boolean): React.CSSProperties => ({
    display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left', padding: 8, borderRadius: 10, color: C.text,
    background: selected ? `${C.ally}14` : C.panelSolid, border: `1px solid ${selected ? C.ally : C.line}`,
  })
  const body = (m: { id: string; name: string; description?: string }) => (
    <>
      <MapThumb mapId={m.id} size={74} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <b style={{ fontFamily: FONT.display, fontSize: 14.5 }}>{m.name}</b>
        {m.description && <span style={{ fontSize: 12, color: C.textSoft, lineHeight: 1.35 }}>{m.description}</span>}
      </span>
    </>
  )
  if (maps.length === 1) return <div style={card(false)}>{body(maps[0])}</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }} role="radiogroup" aria-label="Mapa">
      {maps.map(m => (
        <button key={m.id} type="button" role="radio" aria-checked={mapId === m.id} onClick={() => onChange(m.id)}
          style={{ ...card(mapId === m.id), cursor: 'pointer' }}>{body(m)}</button>
      ))}
    </div>
  )
}

