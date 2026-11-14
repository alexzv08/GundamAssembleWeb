import { useEffect, useState } from 'react'
import { fetchMap, type MapData } from '../../api/gameData'
import { terrainLook } from '../../three/hexUtils'
import { C } from '../../theme'

type Scenario = { objectives?: { col: number; row: number }[]; garrisons?: { col: number; row: number; owner: string }[] }
const cache = new Map<string, Promise<MapData & { scenario?: Scenario }>>()

// Miniatura del mapa (hexes pointy-top, filas impares desplazadas) para el lobby.
export function MapThumb({ mapId, size = 120 }: { mapId: string; size?: number }) {
  const [map, setMap] = useState<(MapData & { scenario?: Scenario }) | null>(null)
  useEffect(() => {
    let alive = true
    let p = cache.get(mapId)
    if (!p) { p = fetchMap(mapId) as Promise<MapData & { scenario?: Scenario }>; cache.set(mapId, p) }
    p.then(m => { if (alive) setMap(m) }).catch(() => {})
    return () => { alive = false }
  }, [mapId])

  if (!map) return <div style={{ width: size, height: size, background: C.bgDeep, borderRadius: 6 }} />
  const R = 1, W = Math.sqrt(3) * R
  const pts = (cx: number, cy: number) => Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 180 * (60 * i - 30)
    return `${(cx + R * 0.94 * Math.cos(a)).toFixed(2)},${(cy + R * 0.94 * Math.sin(a)).toFixed(2)}`
  }).join(' ')
  const center = (c: number, r: number) => [c * W + (r % 2 ? W / 2 : 0) + W / 2, r * 1.5 * R + R]
  const vw = map.cols * W + W / 2, vh = map.rows * 1.5 * R + R / 2
  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} width={size} height={size * vh / vw} role="img" aria-label="Vista previa del mapa" style={{ display: 'block' }}>
      {map.grid.map((row, r) => row.map((cell, c) => {
        const [x, y] = center(c, r)
        const elev = Math.max(0, (cell.elevation ?? 1) - 1)
        return <polygon key={`${c},${r}`} points={pts(x, y)} fill={terrainLook(cell.terrain === 'plains' ? 'normal' : cell.terrain, elev).top} />
      }))}
      {map.scenario?.objectives?.map((o, i) => {
        const [x, y] = center(o.col, o.row)
        return <circle key={i} cx={x} cy={y} r={0.55} fill={C.amber} />
      })}
    </svg>
  )
}
