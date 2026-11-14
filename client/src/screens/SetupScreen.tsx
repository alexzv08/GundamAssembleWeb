import { useState } from 'react'
import type { GameState } from '../types/gameState'
import { C, FONT, eyebrow, button, sideColor } from '../theme'

interface SetupScreenProps {
  gameState: GameState
  myPlayerId: 'player1' | 'player2' | null
  setupConfirmed: boolean
  onConfirm: () => void
  onReorderSlot: (slotRound: number, unitIds: string[]) => void
}

// Orden inicial de la Timeline (H14): se dibujan las primeras rondas con las
// fichas de los dos jugadores; las tuyas que comparten ronda se arrastran (o se
// mueven con los botones) para decidir cuál actúa antes.
export function SetupScreen({ gameState, myPlayerId, setupConfirmed, onConfirm, onReorderSlot }: SetupScreenProps) {
  const [drag, setDrag] = useState<{ round: number; unitId: string } | null>(null)
  const slots = gameState.timeline.slots.filter(s => s.round <= 5)
  const shared = slots.filter(s => s.tokens.filter(t => t.playerId === myPlayerId).length > 1)

  const move = (round: number, ids: string[], from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return
    const next = [...ids]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    onReorderSlot(round, next)
  }

  return (
    <div style={{ width: '100vw', height: '100dvh', overflowY: 'auto', background: `radial-gradient(900px 500px at 50% -10%, ${C.allyDeep}66, ${C.bg} 65%)`, color: C.text, display: 'grid', placeItems: 'center', padding: '24px max(16px, env(safe-area-inset-left, 0px))' }}>
      <div style={{ width: '100%', maxWidth: 860, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24 }}>Orden de la Timeline</h1>
          <p style={{ color: C.textSoft, fontSize: 13.5, marginTop: 4 }}>
            Cada unidad empieza en la ronda de su TL inicial. Si varias tuyas comparten ronda, decide cuál actúa primero: la de arriba va antes.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`, gap: 8, overflowX: 'auto' }}>
          {slots.map(slot => {
            const mine = slot.tokens.filter(t => t.playerId === myPlayerId)
            const theirs = slot.tokens.filter(t => t.playerId !== myPlayerId)
            const ids = mine.map(t => t.unitId)
            return (
              <div key={slot.round} style={{ background: C.panelSolid, border: `1px solid ${mine.length > 1 ? C.amber : C.line}`, borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 120 }}>
                <span style={{ ...eyebrow, color: mine.length > 1 ? C.amber : C.textDim }}>Ronda {slot.round}</span>
                {theirs.map(t => (
                  <span key={t.unitId} style={{ fontSize: 12, color: sideColor(t.playerId, myPlayerId), borderLeft: `3px solid ${sideColor(t.playerId, myPlayerId)}`, paddingLeft: 6 }}>
                    {gameState.units[t.unitId]?.shortName ?? gameState.units[t.unitId]?.name}
                  </span>
                ))}
                {mine.map((t, i) => (
                  <div key={t.unitId} draggable={mine.length > 1 && !setupConfirmed}
                    onDragStart={() => setDrag({ round: slot.round, unitId: t.unitId })}
                    onDragOver={e => { if (drag?.round === slot.round) e.preventDefault() }}
                    onDrop={() => { if (drag?.round === slot.round) move(slot.round, ids, ids.indexOf(drag.unitId), i); setDrag(null) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px', borderRadius: 6,
                      background: `${C.ally}14`, border: `1px solid ${C.ally}88`, cursor: mine.length > 1 ? 'grab' : 'default', fontSize: 12.5,
                    }}>
                    <span style={{ fontFamily: FONT.mono, color: C.textDim, fontSize: 11 }}>{mine.length > 1 ? `${i + 1}.` : ''}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gameState.units[t.unitId]?.shortName ?? gameState.units[t.unitId]?.name}</span>
                    {mine.length > 1 && !setupConfirmed && (
                      <>
                        <button aria-label="Subir" disabled={i === 0} onClick={() => move(slot.round, ids, i, i - 1)} style={{ ...button('subtle', i === 0), padding: '0 5px' }}>▲</button>
                        <button aria-label="Bajar" disabled={i === mine.length - 1} onClick={() => move(slot.round, ids, i, i + 1)} style={{ ...button('subtle', i === mine.length - 1), padding: '0 5px' }}>▼</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <p style={{ color: C.textDim, fontSize: 12.5 }}>
          {shared.length === 0 ? 'Tus unidades no comparten ronda: no hay nada que ordenar.' : 'Las rondas con borde ámbar tienen varias unidades tuyas.'}
          {' '}En caso de empate entre jugadores actúa primero quien no actuó el último.
        </p>

        {setupConfirmed
          ? <div style={{ color: C.ok }}>Orden confirmado. Esperando al rival…</div>
          : <button onClick={onConfirm} style={{ ...button('amber'), alignSelf: 'flex-start', padding: '11px 24px', fontSize: 14.5, fontWeight: 600 }}>Confirmar y empezar</button>}
      </div>
    </div>
  )
}
