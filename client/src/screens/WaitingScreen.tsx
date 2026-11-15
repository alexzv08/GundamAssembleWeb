import { useState } from 'react'
import { C, FONT, eyebrow, button } from '../theme'
import { shareUrl, copyText } from '../game/links'

interface WaitingScreenProps {
  roomId: string
}

export function WaitingScreen({ roomId }: WaitingScreenProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const copy = (what: 'code' | 'link') => {
    copyText(what === 'code' ? roomId : shareUrl('sala', roomId)).then(ok => { if (ok) { setCopied(what); setTimeout(() => setCopied(null), 1800) } })
  }
  return (
    <div style={{ width: '100vw', height: '100dvh', background: `radial-gradient(800px 480px at 50% 30%, ${C.allyDeep}66, ${C.bg} 65%)`, color: C.text, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <span style={eyebrow}>Sala creada · código</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 44, fontWeight: 600, letterSpacing: '0.3em', color: C.amber, userSelect: 'all' }}>{roomId}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => copy('link')} style={button('amber')}>{copied === 'link' ? 'Enlace copiado' : 'Copiar enlace de invitación'}</button>
          <button onClick={() => copy('code')} style={button('primary')}>{copied === 'code' ? 'Copiado' : 'Copiar código'}</button>
        </div>
        <p style={{ color: C.textSoft, fontSize: 14 }}>Con el enlace tu rival entra directamente; con el código, desde «Sala privada».</p>
        <p style={{ color: C.textDim, fontSize: 13, animation: 'ga-pulse 1.8s infinite' }}>Esperando al segundo jugador…</p>
      </div>
    </div>
  )
}
