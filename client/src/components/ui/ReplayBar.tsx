import { useState } from 'react'
import type { ReplaySummary } from '../../types/gameState'
import { C, FONT, eyebrow, button } from '../../theme'
import { shareUrl, copyText } from '../../game/links'

interface ReplayBarProps {
  summary: ReplaySummary
  index: number
  total: number
  playing: boolean
  speed: number
  loading: boolean
  onSeek: (index: number) => void
  onTogglePlay: () => void
  onSpeed: (speed: number) => void
  onExit: () => void
  compact?: boolean
}

// Controles de la repetición: ir al principio / atrás / reproducir / adelante /
// al final, barra de posición, velocidad y enlace para compartirla.
export function ReplayBar({ summary, index, total, playing, speed, loading, onSeek, onTogglePlay, onSpeed, onExit, compact = false }: ReplayBarProps) {
  const [copied, setCopied] = useState(false)
  const last = Math.max(0, total - 1)
  const ctl = (label: string, title: string, onClick: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      style={{ ...button('subtle', disabled), minWidth: 36, padding: '6px 8px', fontFamily: FONT.mono }}>{label}</button>
  )
  return (
    <div role="region" aria-label="Repetición" style={{
      position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)', zIndex: 30,
      width: compact ? 'calc(100% - 16px)' : 'min(760px, calc(100% - 660px))', minWidth: compact ? 0 : 420,
      background: C.panel, border: `1px solid ${C.amber}88`, borderRadius: 12, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...eyebrow, color: C.amber }}>Repetición</span>
        <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary.players.player1} vs {summary.players.player2}
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: 12, color: C.textSoft }}>
          Paso {index} de {last}{loading ? ' …' : ''}
        </span>
      </div>
      <input type="range" min={0} max={last} value={index} onChange={e => onSeek(Number(e.target.value))} aria-label="Posición en la repetición"
        style={{ width: '100%', accentColor: C.amber }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {ctl('⏮', 'Al principio', () => onSeek(0), index === 0)}
        {ctl('◀', 'Paso anterior', () => onSeek(index - 1), index === 0)}
        <button type="button" onClick={onTogglePlay} style={{ ...button('amber'), minWidth: 92 }}>{playing ? 'Pausa' : index >= last ? 'Otra vez' : 'Reproducir'}</button>
        {ctl('▶', 'Paso siguiente', () => onSeek(index + 1), index >= last)}
        {ctl('⏭', 'Al final', () => onSeek(last), index >= last)}
        <span style={{ display: 'flex', gap: 4, marginLeft: 6 }} role="radiogroup" aria-label="Velocidad">
          {[1, 2, 4].map(v => (
            <button key={v} type="button" role="radio" aria-checked={speed === v} onClick={() => onSpeed(v)}
              style={{ ...button(speed === v ? 'primary' : 'subtle'), padding: '6px 8px', fontFamily: FONT.mono }}>×{v}</button>
          ))}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => copyText(shareUrl('repeticion', summary.id)).then(ok => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600) } })}
          style={button('ghost')}>{copied ? 'Enlace copiado' : 'Compartir'}</button>
        <button type="button" onClick={onExit} style={button('ghost')}>Salir</button>
      </div>
    </div>
  )
}
