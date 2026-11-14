import { useEffect, useRef } from 'react'
import type { LogEntry, LogCategory, PlayerId } from '../../types/gameState'
import { C, FONT, sideColor } from '../../theme'

interface ActionLogProps {
  log: LogEntry[]
  myPlayerId: PlayerId | null
  onHoverHexes: (hexes: string[] | null) => void
}

const CATEGORY: Record<LogCategory, { label: string; color: string }> = {
  move: { label: 'Mueve', color: C.ally },
  attack: { label: 'Ataca', color: C.danger },
  ability: { label: 'Habilidad', color: C.response },
  card: { label: 'Carta', color: C.command },
  objective: { label: 'Objetivo', color: C.amber },
  end: { label: 'Fin', color: C.textDim },
}

// Registro de la partida. Al pasar el ratón por una línea se resaltan sus hexes.
export function ActionLog({ log, myPlayerId, onHoverHexes }: ActionLogProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [log.length])

  return (
    <div ref={ref} style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, flex: 1 }}>
      {log.length === 0 && <div style={{ color: C.textDim, fontSize: 12, fontStyle: 'italic' }}>Sin acciones todavía</div>}
      {log.map((entry, i) => {
        const cat = CATEGORY[entry.category]
        const hasHexes = entry.hexes.length > 0
        return (
          <div key={i}
            onMouseEnter={() => hasHexes && onHoverHexes(entry.hexes)}
            onMouseLeave={() => onHoverHexes(null)}
            style={{
              display: 'grid', gridTemplateColumns: '3px auto 1fr auto', gap: 7, alignItems: 'baseline',
              padding: '4px 4px', borderRadius: 4, cursor: hasHexes ? 'crosshair' : 'default',
              background: entry.category === 'end' ? 'transparent' : i === log.length - 1 ? `${C.amber}0f` : 'transparent',
            }}>
            <span style={{ alignSelf: 'stretch', background: sideColor(entry.playerId, myPlayerId), borderRadius: 2 }} />
            <span style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: cat.color }}>{cat.label}</span>
            <span style={{ fontSize: 12, lineHeight: 1.4, color: entry.category === 'end' ? C.textDim : C.text }}>{entry.message}</span>
            {entry.round !== null && <span style={{ fontFamily: FONT.mono, fontSize: 9.5, color: C.textDim }}>R{entry.round}</span>}
          </div>
        )
      })}
    </div>
  )
}
