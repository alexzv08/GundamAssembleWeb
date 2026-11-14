import { useState } from 'react'
import { C, FONT, eyebrow, button } from '../theme'

interface WaitingScreenProps {
  roomId: string
}

export function WaitingScreen({ roomId }: WaitingScreenProps) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(roomId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }
  return (
    <div style={{ width: '100vw', height: '100dvh', background: `radial-gradient(800px 480px at 50% 30%, ${C.allyDeep}66, ${C.bg} 65%)`, color: C.text, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <span style={eyebrow}>Sala creada · código</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 44, fontWeight: 600, letterSpacing: '0.3em', color: C.amber, userSelect: 'all' }}>{roomId}</span>
        <button onClick={copy} style={button('primary')}>{copied ? 'Copiado' : 'Copiar código'}</button>
        <p style={{ color: C.textSoft, fontSize: 14 }}>Pásaselo a tu rival para que se una desde «Sala privada».</p>
        <p style={{ color: C.textDim, fontSize: 13, animation: 'ga-pulse 1.8s infinite' }}>Esperando al segundo jugador…</p>
      </div>
    </div>
  )
}
