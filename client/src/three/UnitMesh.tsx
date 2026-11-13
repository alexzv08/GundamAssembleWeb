import { useRef, useState } from 'react'
import { Mesh, Group, Vector3 } from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { Unit } from '../types'
import { hexToWorld } from './hexUtils'
import { useSTLModel } from './useSTLModel'
import { modelUrlFor, DEFAULT_MODEL_SCALE } from './models'

interface UnitMeshProps {
  unit: Unit
  elevation?: number
  isActive?: boolean
  isSelected?: boolean
  onClick?: () => void
}

export function UnitMesh({ unit, elevation = 0, isActive = false, isSelected = false, onClick }: UnitMeshProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const stlUrl = modelUrlFor(unit.cardId)
  const stlScale = DEFAULT_MODEL_SCALE
  const stlGeometry = useSTLModel(stlUrl ?? '')

  if (!unit.position || unit.currentHp <= 0) return null

  const { q, r } = unit.position
  const [x, y, z] = hexToWorld(q, r, elevation)

  const baseColor = unit.playerId === 'player1' ? '#c0393a' : '#3a6bc0'
  const color = isSelected ? '#f5c518' : hovered ? '#ffffff' : baseColor

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick?.() },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true) },
    onPointerLeave: () => setHovered(false),
  }

  return (
    <MovingGroup target={[x, y + 0.6, z]}>
      {stlUrl && stlGeometry ? (
        <mesh
          ref={meshRef}
          geometry={stlGeometry}
          scale={stlScale}
          rotation={[-Math.PI / 2, 0, 0]}
          {...handlers}
        >
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
        </mesh>
      ) : (
        <mesh ref={meshRef} {...handlers}>
          <sphereGeometry args={[0.35, 16, 16]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
        </mesh>
      )}

      {isActive && (
        <mesh position={[0, -0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.45, 0.05, 8, 32]} />
          <meshStandardMaterial color="#f5c518" emissive="#f5c518" emissiveIntensity={0.5} />
        </mesh>
      )}

      <HPBar current={unit.currentHp} max={unit.maxHp} />
    </MovingGroup>
  )
}

// Grupo que se desliza hacia su posición objetivo en vez de teletransportarse.
// La primera vez (despliegue) aparece directamente en su sitio.
function MovingGroup({ target, children }: { target: [number, number, number]; children: React.ReactNode }) {
  const ref = useRef<Group>(null)
  const placed = useRef(false)
  const goal = useRef(new Vector3())
  useFrame((_, delta) => {
    const g = ref.current
    if (!g) return
    goal.current.set(target[0], target[1], target[2])
    if (!placed.current) { g.position.copy(goal.current); placed.current = true; return }
    // Arco suave: un pequeño salto mientras se desplaza
    const dist = g.position.distanceTo(goal.current)
    g.position.lerp(goal.current, 1 - Math.exp(-delta * 7))
    g.position.y += Math.min(dist, 2) * 0.08
  })
  return <group ref={ref}>{children}</group>
}

function HPBar({ current, max }: { current: number; max: number }) {
  const ratio = current / max
  const barWidth = 0.6
  const filled = barWidth * ratio

  return (
    <group position={[0, 0.5, 0]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[barWidth, 0.08, 0.05]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      <mesh position={[(filled - barWidth) / 2, 0, 0.01]}>
        <boxGeometry args={[filled, 0.08, 0.05]} />
        <meshStandardMaterial
          color={ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#ff9800' : '#e53935'}
        />
      </mesh>
    </group>
  )
}