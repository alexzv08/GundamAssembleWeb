import { useEffect, useRef, useState } from 'react'
import { C, button, sideColor } from '../../theme'

export interface ChatMessage { playerId: 'player1' | 'player2'; name: string; text: string; at: number }

interface ChatPanelProps {
  messages: ChatMessage[]
  myPlayerId: 'player1' | 'player2' | null
  onSend: (text: string) => void
}

// Chat de la partida (pestaña de la columna derecha).
export function ChatPanel({ messages, myPlayerId, onSend }: ChatPanelProps) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [messages.length])

  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div ref={listRef} style={{ overflowY: 'auto', flex: 1, minHeight: 0, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {messages.length === 0 && <div style={{ color: C.textDim, fontStyle: 'italic' }}>Sin mensajes todavía</div>}
        {messages.map(m => (
          <div key={m.at + m.text}>
            <span style={{ color: sideColor(m.playerId, myPlayerId), fontWeight: 600 }}>{m.playerId === myPlayerId ? 'Tú' : m.name}: </span>
            <span style={{ color: C.text, wordBreak: 'break-word' }}>{m.text}</span>
          </div>
        ))}
      </div>
      <form style={{ display: 'flex', gap: 6 }} onSubmit={e => { e.preventDefault(); send() }}>
        <input id="chat-input" value={text} maxLength={200} onChange={e => setText(e.target.value)} placeholder="Escribe un mensaje"
          style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.lineStrong}`, borderRadius: 6, color: C.text, padding: '6px 9px', fontSize: 12.5 }} />
        <button type="submit" style={button('primary')}>Enviar</button>
      </form>
    </div>
  )
}
