import { useLayoutEffect, useMemo, useRef } from 'react'
import { InstancedMesh, Object3D, Color } from 'three'
import type { BoardMap } from '../types/board'
import { hexToWorld } from './hexUtils'

// Decorado del terreno (solo visual, no afecta a las reglas): rocas en las
// elevaciones, chatarra en Debris y matas en el llano. Va pegado a las esquinas
// de cada hex para no tapar fichas ni unidades. Es determinista: cada hex tiene
// siempre el mismo decorado.
interface Prop { x: number; y: number; z: number; s: number; ry: number; rx: number; tint: number }

function rand(q: number, r: number, k: number): number {
  const v = Math.sin(q * 127.1 + r * 311.7 + k * 74.7) * 43758.5453
  return v - Math.floor(v)
}

function corner(x: number, z: number, q: number, r: number, k: number, reach = 0.68): [number, number] {
  const a = (Math.floor(rand(q, r, k) * 6) * 60 + 30 + (rand(q, r, k + 9) - 0.5) * 24) * Math.PI / 180
  const d = reach + (rand(q, r, k + 3) - 0.5) * 0.1
  return [x + Math.cos(a) * d, z + Math.sin(a) * d]
}

export function TerrainProps({ board }: { board: BoardMap }) {
  const { rocks, scrap, grass } = useMemo(() => {
    const rocks: Prop[] = [], scrap: Prop[] = [], grass: Prop[] = []
    for (const h of Object.values(board)) {
      const { q, r } = h.coord
      const [x, y, z] = hexToWorld(q, r, h.elevation)
      if (h.terrain === 'impassable' || h.terrain === 'water') continue
      if (h.terrain === 'debris') {
        for (let k = 0; k < 3; k++) {
          const [px, pz] = corner(x, z, q, r, k * 5)
          scrap.push({ x: px, y: y + 0.05, z: pz, s: 0.1 + rand(q, r, k) * 0.08, ry: rand(q, r, k + 1) * 6, rx: rand(q, r, k + 2) * 0.8, tint: rand(q, r, k + 4) })
        }
        continue
      }
      const n = h.elevation >= 2 ? 3 : h.elevation === 1 ? (rand(q, r, 1) < 0.45 ? 1 : 0) : 0
      for (let k = 0; k < n; k++) {
        const [px, pz] = corner(x, z, q, r, k * 7)
        rocks.push({ x: px, y: y + 0.02, z: pz, s: 0.09 + rand(q, r, k + 5) * (h.elevation >= 2 ? 0.12 : 0.07), ry: rand(q, r, k) * 6, rx: rand(q, r, k + 6) * 0.6, tint: rand(q, r, k + 8) })
      }
      if (h.elevation <= 1 && rand(q, r, 21) < 0.35) {
        const [px, pz] = corner(x, z, q, r, 33, 0.7)
        grass.push({ x: px, y: y + 0.02, z: pz, s: 0.07 + rand(q, r, 22) * 0.05, ry: rand(q, r, 23) * 6, rx: 0, tint: rand(q, r, 24) })
      }
    }
    return { rocks, scrap, grass }
  }, [board])

  return (
    <group>
      <Instances items={rocks} geometry="rock" base="#6f6a60" tintTo="#8f8676" />
      <Instances items={scrap} geometry="scrap" base="#4a4f5a" tintTo="#7a6a52" metal />
      <Instances items={grass} geometry="grass" base="#3c5a33" tintTo="#5a7a40" />
    </group>
  )
}

function Instances({ items, geometry, base, tintTo, metal = false }: { items: Prop[]; geometry: 'rock' | 'scrap' | 'grass'; base: string; tintTo: string; metal?: boolean }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new Object3D(), c = new Color(), a = new Color(base), b = new Color(tintTo)
    items.forEach((p, i) => {
      o.position.set(p.x, p.y + (geometry === 'grass' ? p.s * 0.9 : p.s * 0.45), p.z)
      o.rotation.set(p.rx, p.ry, 0)
      if (geometry === 'scrap') o.scale.set(p.s * 2.2, p.s * 0.5, p.s)
      else if (geometry === 'grass') o.scale.set(p.s, p.s * 2.2, p.s)
      else o.scale.set(p.s, p.s * 0.75, p.s)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, c.copy(a).lerp(b, p.tint))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [items, geometry, base, tintTo])
  if (!items.length) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow raycast={() => null}>
      {geometry === 'rock' && <dodecahedronGeometry args={[1, 0]} />}
      {geometry === 'scrap' && <boxGeometry args={[1, 1, 1]} />}
      {geometry === 'grass' && <coneGeometry args={[1, 1, 5]} />}
      <meshStandardMaterial flatShading roughness={metal ? 0.45 : 0.95} metalness={metal ? 0.6 : 0.05} />
    </instancedMesh>
  )
}
