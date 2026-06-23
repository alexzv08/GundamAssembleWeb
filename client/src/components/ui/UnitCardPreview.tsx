import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { useSTLModel } from '../../three/useSTLModel'
import type { UnitCardData } from '../../api/gameData'

const STL_MODELS: Record<string, string> = {
  'Gundam': '/models/Gundam.stl',
  'Guncannon': '/models/Guncannon.stl',
  'Guntank': '/models/GunTank.stl',
  "Char's Zaku II": "/models/Char's Zaku.stl",
  'Zaku II [Line Breaker]': '/models/Zaku II.stl',
  'Zaku II [Enforcer]': '/models/Zaku.stl',
  'Tallgeese': '/models/Tallgeese.stl',
}

const STL_SCALES: Record<string, [number, number, number]> = {
  'Gundam': [0.02, 0.02, 0.02],
  'Guncannon': [0.02, 0.02, 0.02],
  'Guntank': [0.02, 0.02, 0.02],
  "Char's Zaku II": [0.02, 0.02, 0.02],
  'Zaku II [Line Breaker]': [0.02, 0.02, 0.02],
  'Zaku II [Enforcer]': [0.02, 0.02, 0.02],
  'Tallgeese': [0.02, 0.02, 0.02],
}

function RotatingModel({ unitName, color }: { unitName: string; color: string }) {
  const groupRef = useRef<Group>(null)
  const stlUrl = STL_MODELS[unitName] ?? null
  const geometry = useSTLModel(stlUrl ?? '')
  const scale = STL_SCALES[unitName] ?? [0.02, 0.02, 0.02]

  useFrame(() => {
    if (groupRef.current) groupRef.current.rotation.y += 0.012
  })

  return (
    <group ref={groupRef}>
      {geometry && stlUrl ? (
        <mesh geometry={geometry} scale={scale} rotation={[-Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
        </mesh>
      ) : (
        <mesh>
          <sphereGeometry args={[0.4, 16, 16]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
        </mesh>
      )}
    </group>
  )
}

interface UnitCardPreviewProps {
  card: UnitCardData
  isSelected: boolean
  canSelect: boolean
  playerColor: string
  onClick: () => void
}

export function UnitCardPreview({ card, isSelected, canSelect, playerColor, onClick }: UnitCardPreviewProps) {
  const interactive = isSelected || canSelect
  const borderColor = isSelected ? playerColor : '#333'
  const modelColor = isSelected ? playerColor : '#9ab0cc'

  return (
    <div
      onClick={interactive ? onClick : undefined}
      style={{
        width: 160,
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: interactive ? 'pointer' : 'not-allowed',
        background: isSelected ? `${playerColor}11` : '#0d0d1a',
        opacity: !isSelected && !canSelect ? 0.35 : 1,
        boxShadow: isSelected ? `0 0 16px ${playerColor}55` : 'none',
        transition: 'opacity 0.15s, box-shadow 0.15s, border-color 0.15s',
        flexShrink: 0,
      }}
    >
      <div style={{ height: 150, background: '#0e1220', position: 'relative' }}>
        <Canvas
          camera={{ position: [0, 1.5, 4], fov: 45 }}
          style={{ width: '100%', height: '100%' }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight position={[3, 4, 3]} intensity={2.5} />
          <directionalLight position={[-2, 2, -1]} intensity={1.0} />
          <directionalLight position={[0, -2, 3]} intensity={0.5} />
          <RotatingModel unitName={card.unitName} color={modelColor} />
        </Canvas>
        {isSelected && (
          <div style={{
            position: 'absolute', top: 6, right: 8,
            width: 20, height: 20, borderRadius: '50%',
            background: playerColor, color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 'bold', pointerEvents: 'none',
          }}>✓</div>
        )}
      </div>
      <div style={{ padding: '10px 12px', background: '#111827' }}>
        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13, marginBottom: 2 }}>
          {card.unitName}
        </div>
        {card.pilot && card.pilot !== card.unitName && (
          <div style={{ color: '#888', fontSize: 10, marginBottom: 6 }}>{card.pilot}</div>
        )}
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#aaa' }}>
          <span>HP {card.hp}</span>
          <span>VP {card.vp}</span>
          <span>TL {card.tl}</span>
        </div>
      </div>
    </div>
  )
}
