import { useEffect, useRef, useState } from 'react'
import type { LogEntry, LogCategory, PlayerId } from '../../types/gameState'

interface ActionLogProps {
  log: LogEntry[]
  myPlayerId: PlayerId | null
  player1Name: string
  player2Name: string
  onHoverHexes: (hexes: string[] | null) => void
}

const P1_COLOR = '#ef5350'
const P2_COLOR = '#4fc3f7'

const CATEGORY_STYLE: Record<LogCategory, { label: string; color: string; bg: string }> = {
  move:      { label: 'MUEVE',   color: '#29b6f6', bg: 'rgba(41,182,246,0.12)' },
  attack:    { label: 'ATACA',   color: '#ff7043', bg: 'rgba(255,112,67,0.12)' },
  ability:   { label: 'HABILIDAD', color: '#ab47bc', bg: 'rgba(171,71,188,0.12)' },
  card:      { label: 'CARTA',   color: '#26a69a', bg: 'rgba(38,166,154,0.12)' },
  objective: { label: 'OBJETIVO', color: '#ffa726', bg: 'rgba(255,167,38,0.15)' },
  end:       { label: 'FIN',     color: '#757575', bg: 'transparent' },
}

export function ActionLog({ log, myPlayerId, onHoverHexes }: ActionLogProps) {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const countRef = useRef(0)

  useEffect(() => {
    if (log.length !== countRef.current) {
      countRef.current = log.length
      if (open && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    }
  }, [log.length, open])

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [open])

  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      right: 16,
      zIndex: 999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      pointerEvents: 'auto',
    }}>
      {open && (
        <div style={{
          width: 320,
          maxHeight: 300,
          background: 'rgba(8,8,18,0.96)',
          border: '1px solid #2a2a3a',
          borderRadius: '8px 8px 0 0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '5px 10px',
            borderBottom: '1px solid #1a1a2a',
            color: '#555',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 1,
            flexShrink: 0,
          }}>
            Registro de acciones
          </div>
          <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {log.length === 0 && (
              <div style={{ color: '#333', fontSize: 11, padding: '6px 10px', fontStyle: 'italic' }}>
                Sin acciones aún
              </div>
            )}
            {log.map((entry, i) => {
              const playerColor = entry.playerId === 'player1' ? P1_COLOR : P2_COLOR
              const cat = CATEGORY_STYLE[entry.category]
              const isMe = entry.playerId === myPlayerId
              const hasHexes = entry.hexes.length > 0
              return (
                <div
                  key={i}
                  onMouseEnter={() => hasHexes && onHoverHexes(entry.hexes)}
                  onMouseLeave={() => onHoverHexes(null)}
                  style={{
                    padding: '4px 10px',
                    display: 'flex',
                    gap: 6,
                    alignItems: 'flex-start',
                    background: isMe ? 'rgba(255,255,255,0.025)' : 'transparent',
                    cursor: hasHexes ? 'crosshair' : 'default',
                    transition: 'background 0.1s',
                  }}
                  onMouseOver={e => {
                    if (hasHexes) (e.currentTarget as HTMLDivElement).style.background = cat.bg
                  }}
                  onMouseOut={e => {
                    (e.currentTarget as HTMLDivElement).style.background = isMe ? 'rgba(255,255,255,0.025)' : 'transparent'
                  }}
                >
                  <span style={{ color: playerColor, fontSize: 8, flexShrink: 0, marginTop: 3 }}>●</span>
                  <span style={{
                    color: cat.color,
                    fontSize: 9,
                    fontWeight: 'bold',
                    letterSpacing: 0.5,
                    flexShrink: 0,
                    marginTop: 2,
                    border: `1px solid ${cat.color}44`,
                    borderRadius: 3,
                    padding: '0 4px',
                    lineHeight: '14px',
                  }}>
                    {cat.label}
                  </span>
                  <span style={{ color: '#c8c8d8', fontSize: 11, lineHeight: 1.4, flex: 1 }}>
                    {entry.message}
                  </span>
                  {entry.round !== null && (
                    <span style={{ color: '#3a3a4a', fontSize: 9, flexShrink: 0, marginTop: 2 }}>
                      R{entry.round}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'rgba(8,8,18,0.96)',
          border: '1px solid #2a2a3a',
          borderTop: open ? 'none' : '1px solid #2a2a3a',
          borderRadius: open ? '0 0 8px 8px' : 8,
          color: '#666',
          fontSize: 11,
          padding: '5px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        {open ? '▼' : '▲'} Log
        {!open && log.length > 0 && (
          <span style={{
            background: '#1e1e2e',
            borderRadius: 10,
            padding: '0 5px',
            fontSize: 10,
            color: '#555',
          }}>
            {log.length}
          </span>
        )}
      </button>
    </div>
  )
}
