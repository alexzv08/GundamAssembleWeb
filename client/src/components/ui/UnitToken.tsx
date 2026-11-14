import type { Unit } from '../../types/units'
import { unitPortrait } from '../../cardArt'
import { C, FONT } from '../../theme'

// Ficha circular de una unidad (como las de la mesa): retrato de la carta, aro
// del color del bando y, por fuera, un arco con los HP que le quedan.
export function UnitToken({ unit, color, size = 36, active = false, dim = false, title }: {
  unit: Unit; color: string; size?: number; active?: boolean; dim?: boolean; title?: string
}) {
  const src = unitPortrait(unit.cardId)
  const hp = Math.max(0, unit.currentHp / unit.maxHp)
  const hpColor = hp > 0.5 ? C.ok : hp > 0.25 ? C.warn : C.danger
  const ring = 3
  return (
    <span title={title ?? `${unit.name} · HP ${unit.currentHp}/${unit.maxHp}`} style={{
      position: 'relative', width: size, height: size, flexShrink: 0, borderRadius: '50%', display: 'inline-block',
      background: `conic-gradient(${hpColor} ${hp * 360}deg, ${C.line} 0)`, padding: ring,
      boxShadow: active ? `0 0 0 2px ${C.amber}, 0 0 14px ${C.amber}aa` : '0 2px 6px rgba(0,0,0,0.5)',
      opacity: dim ? 0.55 : 1, transition: 'box-shadow 160ms',
    }}>
      <span style={{
        display: 'grid', placeItems: 'center', width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
        border: `2px solid ${color}`, background: `radial-gradient(circle at 40% 35%, ${color}55, ${C.panelSolid})`,
        fontFamily: FONT.display, fontWeight: 700, fontSize: size * 0.34, color: C.text,
      }}>
        {src
          ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : (unit.shortName ?? unit.name).slice(0, 2).toUpperCase()}
      </span>
    </span>
  )
}
