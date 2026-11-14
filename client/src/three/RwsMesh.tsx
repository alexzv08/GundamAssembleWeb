import type { RemoteWeapon } from '../types'
import { hexToWorld } from './hexUtils'
import { C } from '../theme'

const LABEL: Record<RemoteWeapon['kind'], string> = {
  bit_stave: 'BIT Stave — aliados adyacentes reciben −1 de daño',
  corax: 'Corax — aliados +1 Accuracy contra enemigos adyacentes',
  isvara: 'Iśvara B Type — 1 de daño a un enemigo adyacente al desplegarse',
}

interface RwsMeshProps {
  rws: RemoteWeapon
  elevation: number
  isMine: boolean
  onClick: () => void
  onHover?: (info: string | null) => void
}

// Remote Weapon System: octaedro pequeño del color del jugador, flotando sobre el hex.
export function RwsMesh({ rws, elevation, isMine, onClick, onHover }: RwsMeshProps) {
  if (!rws.position) return null
  const [x, y, z] = hexToWorld(rws.position.q, rws.position.r, elevation)
  const color = isMine ? C.ally : C.enemy
  return (
    <mesh
      castShadow
      position={[x, y + 0.6, z]}
      onClick={e => { e.stopPropagation(); onClick() }}
      onPointerEnter={e => { e.stopPropagation(); onHover?.(`${isMine ? '' : 'Enemigo: '}${LABEL[rws.kind]} (1 HP, ${rws.vp} VP)`) }}
      onPointerLeave={() => onHover?.(null)}
    >
      <octahedronGeometry args={[0.32]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
    </mesh>
  )
}
