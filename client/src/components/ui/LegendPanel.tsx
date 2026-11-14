import { C } from '../../theme'
import { terrainLook } from '../../three/hexUtils'

// Leyenda del tablero, con las mismas formas y colores que la escena 3D.
const SWATCH = (color: string, shape: 'hex' | 'ring' | 'square' | 'diamond') => ({
  width: 12, height: 12, flexShrink: 0,
  background: shape === 'ring' ? 'transparent' : color,
  border: shape === 'ring' ? `2px solid ${color}` : 'none',
  borderRadius: shape === 'ring' ? '50%' : 2,
  clipPath: shape === 'hex' ? 'polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)' : undefined,
  transform: shape === 'diamond' ? 'rotate(45deg) scale(0.8)' : undefined,
})

export function LegendPanel() {
  const items: { color: string; shape: 'hex' | 'ring' | 'square' | 'diamond'; label: string }[] = [
    { color: C.ally, shape: 'ring', label: 'Tus unidades (peana cian)' },
    { color: C.enemy, shape: 'ring', label: 'Unidades del rival (peana roja)' },
    { color: C.amber, shape: 'hex', label: 'Objetivo libre (haz de luz)' },
    { color: C.ally, shape: 'square', label: 'Tu Garrison: rescátala (+2 VP)' },
    { color: C.enemy, shape: 'square', label: 'Garrison rival: destrúyela (+2 VP)' },
    { color: '#c9d3ea', shape: 'diamond', label: 'Token oculto: Upgrade o Energy' },
    { color: C.ally, shape: 'hex', label: 'Hex al que puedes moverte' },
    { color: C.enemy, shape: 'hex', label: 'Objetivo de ataque' },
  ]
  const terrain = [terrainLook('normal', 0), terrainLook('normal', 1), terrainLook('normal', 2), terrainLook('normal', 3),
    terrainLook('water', 0), terrainLook('debris', 0), terrainLook('minovsky', 0), terrainLook('impassable', 0)]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, fontSize: 12 }}>
      {items.map(it => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={SWATCH(it.color, it.shape)} />
          <span style={{ color: C.textSoft }}>{it.label}</span>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', marginTop: 4 }}>
        {terrain.map(t => (
          <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={SWATCH(t.top, 'hex')} />
            <span style={{ color: C.textSoft, fontSize: 11.5 }}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
