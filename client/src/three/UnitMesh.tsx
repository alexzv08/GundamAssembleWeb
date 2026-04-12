import { useRef, useState } from 'react'
import { Mesh } from 'three'
import type { Unit } from '../types'
import { hexToWorld } from './hexUtils'
import { useSTLModel } from './useSTLModel'

interface UnitMeshProps {
  unit: Unit
  isActive?: boolean
  isSelected?: boolean
  onClick?: () => void
}

// Mapa de modelos STL por nombre de unidad
const STL_MODELS: Record<string, string> = {
  'Gundam': '/models/tallgeese.stl',
}

export function UnitMesh({ unit, isActive = false, isSelected = false, onClick }: UnitMeshProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const stlUrl = STL_MODELS[unit.name] ?? null
  const stlGeometry = useSTLModel(stlUrl ?? '')

  if (!unit.position || unit.currentHp <= 0) return null

  const { q, r } = unit.position
  const [x, y, z] = hexToWorld(q, r, 0)

  const baseColor = unit.playerId === 'player1' ? '#1565c0' : '#b71c1c'
  const color = isSelected ? '#f5c518' : hovered ? '#ffffff' : baseColor

  const handlers = {
    onClick: (e: any) => { e.stopPropagation(); onClick?.() },
    onPointerEnter: (e: any) => { e.stopPropagation(); setHovered(true) },
    onPointerLeave: () => setHovered(false),
  }

  return (
    <group position={[x, y + 0.6, z]}>

      {/* Modelo STL si está disponible, sino esfera placeholder */}
      {stlUrl && stlGeometry ? (
        <mesh
          ref={meshRef}
          geometry={stlGeometry}
          scale={[0.02, 0.02, 0.02]}
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

      {/* Anillo indicador de unidad activa */}
      {isActive && (
        <mesh position={[0, -0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.45, 0.05, 8, 32]} />
          <meshStandardMaterial color="#f5c518" emissive="#f5c518" emissiveIntensity={0.5} />
        </mesh>
      )}

      {/* Barra de HP */}
      <HPBar current={unit.currentHp} max={unit.maxHp} />
    </group>
  )
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