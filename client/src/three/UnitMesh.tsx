import { useRef, useState } from 'react'
import { Mesh } from 'three'
import type { Unit } from '../types'
import { hexToWorld } from './hexUtils'

interface UnitMeshProps {
  unit: Unit
  isActive?: boolean
  isSelected?: boolean
  onClick?: () => void
}

export function UnitMesh({ unit, isActive = false, isSelected = false, onClick }: UnitMeshProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)

  if (!unit.position || unit.currentHp <= 0) return null

  const { q, r } = unit.position
  const [x, y, z] = hexToWorld(q, r, 0)

  // Color según facción
  const baseColor = unit.playerId === 'player1' ? '#1565c0' : '#b71c1c'
  const color = isSelected ? '#f5c518' : hovered ? '#ffffff' : baseColor

  return (
    <group position={[x, y + 0.6, z]}>
      {/* Cuerpo de la unidad — esfera placeholder */}
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick?.() }}
        onPointerEnter={(e) => { e.stopPropagation(); setHovered(true) }}
        onPointerLeave={() => setHovered(false)}
      >
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
      </mesh>

      {/* Anillo indicador de unidad activa */}
      {isActive && (
        <mesh position={[0, -0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.45, 0.05, 8, 32]} />
          <meshStandardMaterial color="#f5c518" emissive="#f5c518" emissiveIntensity={0.5} />
        </mesh>
      )}

      {/* Barra de HP encima de la unidad */}
      <HPBar current={unit.currentHp} max={unit.maxHp} />
    </group>
  )
}

// Barra de HP en 3D
function HPBar({ current, max }: { current: number; max: number }) {
  const ratio = current / max
  const barWidth = 0.6
  const filled = barWidth * ratio

  return (
    <group position={[0, 0.5, 0]}>
      {/* Fondo gris */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[barWidth, 0.08, 0.05]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      {/* Barra verde/roja según HP */}
      <mesh position={[(filled - barWidth) / 2, 0, 0.01]}>
        <boxGeometry args={[filled, 0.08, 0.05]} />
        <meshStandardMaterial
          color={ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#ff9800' : '#e53935'}
        />
      </mesh>
    </group>
  )
}