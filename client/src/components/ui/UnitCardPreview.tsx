import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { useUnitModel } from '../../three/useUnitModel'
import { modelUrlFor } from '../../three/models'
import { unitCardArt } from '../../cardArt'
import type { UnitCardData } from '../../api/gameData'
import { C, FONT, chip } from '../../theme'

function RotatingModel({ url, color }: { url: string | null; color: string }) {
  const groupRef = useRef<Group>(null)
  const geometry = useUnitModel(url)
  useFrame((_, d) => { if (groupRef.current) groupRef.current.rotation.y += d * 0.6 })
  return (
    <group ref={groupRef}>
      <mesh position={[0, -0.63, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
        <ringGeometry args={[0.6, 0.68, 6]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {geometry ? (
        <mesh geometry={geometry} position={[0, -0.62, 0]}>
          <meshStandardMaterial color="#d3dcea" roughness={0.5} metalness={0.3} flatShading emissive={color} emissiveIntensity={0.06} />
        </mesh>
      ) : (
        <group>
          <mesh position={[0, -0.15, 0]}><capsuleGeometry args={[0.24, 0.5, 6, 12]} /><meshStandardMaterial color="#d3dcea" roughness={0.5} metalness={0.3} /></mesh>
          <mesh position={[0, 0.36, 0]}><boxGeometry args={[0.3, 0.18, 0.26]} /><meshStandardMaterial color="#d3dcea" roughness={0.5} metalness={0.3} /></mesh>
        </group>
      )}
    </group>
  )
}

// Visor 3D de una unidad (uno solo en la pantalla: un Canvas por carta agotaría
// los contextos WebGL del navegador).
export function UnitModelViewer({ cardId, color = C.ally, distance = 3.9 }: { cardId: string; color?: string; distance?: number }) {
  return (
    <Canvas camera={{ position: [0, -0.04, distance], fov: 36 }} style={{ width: '100%', height: '100%' }} dpr={[1, 2]}>
      <hemisphereLight args={['#c4d2ff', '#2a2110', 1.1]} />
      <directionalLight position={[2, 4, 3]} intensity={2.2} color="#ffe9c9" />
      <directionalLight position={[-3, 1, -2]} intensity={1.2} color={color} />
      <RotatingModel url={modelUrlFor(cardId)} color={color} />
    </Canvas>
  )
}

interface UnitTileProps {
  card: UnitCardData
  copies: number
  canSelect: boolean
  focused: boolean
  onClick: () => void
  onFocus: () => void
}

// Ficha de unidad en la selección de escuadra
export function UnitCardPreview({ card, copies, canSelect, focused, onClick, onFocus }: UnitTileProps) {
  const isSelected = copies > 0
  const interactive = isSelected || canSelect
  const art = unitCardArt(card.cardId)
  if (art) return (
    <button type="button" onClick={interactive ? onClick : undefined} onMouseEnter={onFocus} onFocus={onFocus} aria-pressed={isSelected}
      aria-label={`${card.name}${isSelected ? ' (en la escuadra)' : ''}`}
      style={{
        position: 'relative', padding: 0, border: 'none', background: C.panelSolid, borderRadius: 10, overflow: 'hidden',
        cursor: interactive ? 'pointer' : 'not-allowed', aspectRatio: '800 / 567', width: '100%',
        outline: isSelected ? `2px solid ${C.ally}` : focused ? `1px solid ${C.lineStrong}` : 'none', outlineOffset: 2,
        boxShadow: isSelected ? `0 0 18px ${C.ally}66` : '0 6px 16px rgba(0,0,0,0.45)',
        opacity: !isSelected && !canSelect ? 0.4 : 1, transform: focused ? 'translateY(-2px)' : 'none', transition: 'transform 140ms, box-shadow 140ms',
      }}>
      <img src={art} alt="" draggable={false} loading="lazy" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
      {isSelected && (
        <span style={{ ...chip(C.ally), position: 'absolute', top: 8, right: 8, background: C.allyDeep }}>{copies > 1 ? `×${copies}` : 'En la escuadra'}</span>
      )}
    </button>
  )
  return (
    <button type="button"
      onClick={interactive ? onClick : undefined}
      onMouseEnter={onFocus} onFocus={onFocus}
      aria-pressed={isSelected}
      style={{
        textAlign: 'left', color: C.text, padding: 0, cursor: interactive ? 'pointer' : 'not-allowed',
        background: isSelected ? `${C.ally}14` : C.panelSolid,
        border: `1px solid ${isSelected ? C.ally : focused ? C.lineStrong : C.line}`,
        borderRadius: 8, overflow: 'hidden', opacity: !isSelected && !canSelect ? 0.45 : 1,
        boxShadow: isSelected ? `0 0 14px ${C.ally}40` : 'none', transition: 'border-color 120ms, box-shadow 120ms',
        display: 'flex', flexDirection: 'column', minWidth: 0,
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${C.line}`, gap: 6 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textDim }}>{card.cardId}</span>
        {isSelected
          ? <span style={chip(C.ally)}>{copies > 1 ? `×${copies}` : 'En la escuadra'}</span>
          : card.traits.includes('Mass Produced') ? <span style={chip(C.textSoft)}>Mass Produced</span> : null}
      </div>
      <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 15, lineHeight: 1.15 }}>{card.name}</span>
        {card.signature && <span style={{ color: C.textSoft, fontSize: 11, fontStyle: 'italic' }}>{card.signature}</span>}
        <span style={{ display: 'flex', gap: 10, fontFamily: FONT.mono, fontSize: 11, color: C.textSoft, marginTop: 4 }}>
          <span>HP <b style={{ color: C.text }}>{card.hp}</b></span>
          <span>VP <b style={{ color: C.amber }}>{card.vp}</b></span>
          <span>TL <b style={{ color: C.text }}>{card.tl}</b></span>
        </span>
      </div>
    </button>
  )
}
