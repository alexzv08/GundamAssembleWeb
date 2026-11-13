import { useEffect, useRef, useState } from 'react'

export interface ChatMessage { playerId: 'player1' | 'player2'; name: string; text: string; at: number }

interface ChatPanelProps {
  messages: ChatMessage[]
  myPlayerId: 'player1' | 'player2' | null
  onSend: (text: string) => void
}

// Chat de la partida: botón flotante arriba a la derecha que despliega el panel.
export function ChatPanel({ messages, myPlayerId, onSend }: ChatPanelProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [seen, setSeen] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const unread = open ? 0 : messages.length - seen

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length, open])

  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  return (
    <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
      <button
        onClick={() => { setOpen(o => !o); setSeen(messages.length) }}
        aria-label="Chat"
        style={{
          background: 'rgba(10,10,20,0.9)', border: '1px solid #444', borderRadius: 8, color: 'white',
          padding: '6px 10px', cursor: 'pointer', fontSize: 13,
        }}
      >
        💬{unread > 0 && <span style={{ color: '#f5c518', marginLeft: 4 }}>{unread}</span>}
      </button>
      {open && (
        <div style={{
          width: 'min(300px, calc(100vw - 32px))', background: 'rgba(10,10,20,0.95)', border: '1px solid #333',
          borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div ref={listRef} style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {messages.length === 0 && <div style={{ color: '#666' }}>Sin mensajes todavía</div>}
            {messages.map(m => (
              <div key={m.at + m.text}>
                <span style={{ color: m.playerId === 'player1' ? '#ef5350' : '#4fc3f7', fontWeight: 'bold' }}>
                  {m.playerId === myPlayerId ? 'Tú' : m.name}:
                </span>{' '}
                <span style={{ color: '#ddd', wordBreak: 'break-word' }}>{m.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={text}
              maxLength={200}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder="Escribe un mensaje"
              style={{ flex: 1, background: '#0d0d1a', border: '1px solid #444', borderRadius: 6, color: 'white', padding: '6px 8px', fontSize: 12 }}
            />
            <button onClick={send} style={{ background: '#1565c0', border: 'none', borderRadius: 6, color: 'white', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
