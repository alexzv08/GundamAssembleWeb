import { useState } from 'react'
import type { GameState, PlayerId } from '../../types/gameState'
import { C, FONT } from '../../theme'
import { ObjectivesPanel } from './ObjectivesPanel'
import { ActionLog } from './ActionLog'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { LegendPanel } from './LegendPanel'

type Tab = 'log' | 'chat' | 'legend'

interface SideRailProps {
  gameState: GameState
  myPlayerId: PlayerId | null
  chat: ChatMessage[]
  onSendChat: (text: string) => void
  onHoverHexes: (hexes: string[] | null) => void
  muted: boolean
  onToggleMute: () => void
}

// Columna derecha del HUD (H5): Objetivos siempre visibles y, debajo, una zona
// con pestañas para el registro, el chat y la leyenda. Se puede plegar.
export function SideRail({ gameState, myPlayerId, chat, onSendChat, onHoverHexes, muted, onToggleMute }: SideRailProps) {
  const [tab, setTab] = useState<Tab>('log')
  const [open, setOpen] = useState(true)
  const [seenChat, setSeenChat] = useState(0)
  const unread = tab === 'chat' && open ? 0 : chat.length - seenChat
  const objectiveHexes = Object.values(gameState.board).filter(h => h.objectiveToken)

  const pick = (t: Tab) => {
    if (t === tab && open) { setOpen(false); return }
    setTab(t); setOpen(true)
    if (t === 'chat') setSeenChat(chat.length)
  }
  if (tab === 'chat' && open && seenChat !== chat.length) setSeenChat(chat.length)

  const tabBtn = (t: Tab, label: string, badge?: number) => (
    <button type="button" onClick={() => pick(t)} aria-pressed={tab === t && open}
      style={{
        flex: 1, background: 'none', border: 'none', borderBottom: `2px solid ${tab === t && open ? C.ally : 'transparent'}`,
        color: tab === t && open ? C.text : C.textSoft, fontFamily: FONT.mono, fontSize: 10.5, letterSpacing: '0.1em',
        textTransform: 'uppercase', padding: '8px 4px 6px', cursor: 'pointer',
      }}>
      {label}{badge ? <span style={{ color: C.amber, marginLeft: 4 }}>{badge}</span> : null}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0, pointerEvents: 'none' }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px', pointerEvents: 'auto', backdropFilter: 'blur(6px)' }}>
        <ObjectivesPanel objectiveHexes={objectiveHexes} players={gameState.players} myPlayerId={myPlayerId} />
      </div>
      <div style={{
        background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, pointerEvents: 'auto', backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column', minHeight: 0, flex: open ? 1 : '0 0 auto', maxHeight: open ? 520 : undefined,
      }}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, alignItems: 'stretch' }}>
          {tabBtn('log', 'Registro')}
          {tabBtn('chat', 'Chat', unread > 0 ? unread : undefined)}
          {tabBtn('legend', 'Leyenda')}
          <button type="button" onClick={onToggleMute} aria-label={muted ? 'Activar sonido' : 'Silenciar'} title={muted ? 'Activar sonido' : 'Silenciar'}
            style={{ background: 'none', border: 'none', borderLeft: `1px solid ${C.line}`, color: muted ? C.textDim : C.textSoft, padding: '0 10px', cursor: 'pointer', fontSize: 13 }}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
        {open && (
          <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            {tab === 'log' && <ActionLog log={gameState.log} myPlayerId={myPlayerId} onHoverHexes={onHoverHexes} />}
            {tab === 'chat' && <ChatPanel messages={chat} myPlayerId={myPlayerId} onSend={onSendChat} />}
            {tab === 'legend' && <div style={{ overflowY: 'auto' }}><LegendPanel /></div>}
          </div>
        )}
      </div>
    </div>
  )
}
