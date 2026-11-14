import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { useUnitModel } from '../../three/useUnitModel'
import { modelUrlFor, DEFAULT_MODEL_SCALE } from '../../three/models'
import type { UnitCardData } from '../../api/gameData'

function RotatingModel({ url, color }: { url: string | null; color: string }) {
  const groupRef = useRef<Group>(null)
  const geometry = useUnitModel(url)
  useFrame(() => {
    if (groupRef.current) groupRef.current.rotation.y += 0.012
  })
  return (
    <group ref={groupRef}>
      {geometry && url ? (
        <mesh geometry={geometry} scale={DEFAULT_MODEL_SCALE} position={[0, -0.6, 0]}>
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} flatShading />
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
  copies: number
  canSelect: boolean
  playerColor: string
  onClick: () => void
}

// El visor 3D solo se monta mientras el ratón está encima: con muchas cartas,
// un Canvas por carta agotaría los contextos WebGL del navegador.
export function UnitCardPreview({ card, copies, canSelect, playerColor, onClick }: UnitCardPreviewProps) {
  const [hovered, setHovered] = useState(false)
  const isSelected = copies > 0
  const interactive = isSelected || canSelect
  const modelColor = isSelected ? playerColor : '#9ab0cc'
  const url = modelUrlFor(card.cardId)
  const affiliations = card.traits.filter((_, i) => i > 0 || card.traits.length === 1)

  return (
    <div
      onClick={interactive ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={card.abilities.map(a => `${a.name}: ${a.effect}`).join('\n')}
      style={{
        width: 168,
        border: `2px solid ${isSelected ? playerColor : '#333'}`,
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
      <div style={{ height: 120, background: '#0e1220', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {hovered ? (
          <Canvas camera={{ position: [0, 1.5, 4], fov: 45 }} style={{ width: '100%', height: '100%' }}>
            <ambientLight intensity={1.2} />
            <directionalLight position={[3, 4, 3]} intensity={2.5} />
            <directionalLight position={[-2, 2, -1]} intensity={1.0} />
            <RotatingModel url={url} color={modelColor} />
          </Canvas>
        ) : (
          <div style={{ textAlign: 'center', color: '#556', fontSize: 11, padding: 8 }}>
            <div style={{ fontSize: 26, marginBottom: 4, color: modelColor }}>◆</div>
            {card.model ?? card.cardId}
          </div>
        )}
        <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 9, color: '#778', letterSpacing: 0.5 }}>{card.cardId}</div>
        {isSelected && (
          <div style={{
            position: 'absolute', top: 6, right: 8, minWidth: 20, height: 20, borderRadius: 10,
            background: playerColor, color: '#000', padding: '0 4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 'bold', pointerEvents: 'none',
          }}>{copies > 1 ? `×${copies}` : '✓'}</div>
        )}
        {card.provisionalStats && (
          <div title="Valores de armas y Energy provisionales: revisar con la carta física"
            style={{ position: 'absolute', bottom: 4, right: 6, fontSize: 9, color: '#f5c518' }}>stats provisionales</div>
        )}
      </div>
      <div style={{ padding: '8px 10px', background: '#111827' }}>
        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13 }}>{card.name}</div>
        {card.signature && <div style={{ color: '#4fc3f7', fontSize: 10, fontStyle: 'italic' }}>{card.signature}</div>}
        <div style={{ color: '#888', fontSize: 10, margin: '2px 0 6px' }}>{affiliations.join(' · ')}</div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#aaa' }}>
          <span>HP {card.hp}</span>
          <span>VP {card.vp}</span>
          <span>TL {card.tl}</span>
        </div>
      </div>
    </div>
  )
}
