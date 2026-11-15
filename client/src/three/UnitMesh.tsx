import { useEffect, useRef, useState } from 'react'
import { Group, Mesh, Vector3 } from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Unit } from '../types'
import { hexToWorld } from './hexUtils'
import { useUnitModel } from './useUnitModel'
import { modelUrlFor, DEFAULT_MODEL_SCALE } from './models'
import { C, FONT } from '../theme'
import { UnitToken } from '../components/ui/UnitToken'

interface UnitMeshProps {
  unit: Unit
  elevation?: number
  isActive?: boolean
  isSelected?: boolean
  isMine?: boolean
  onClick?: () => void
  onHover?: (on: boolean) => void
}

// Pieza de una unidad: peana del color del bando (tú cian, rival rojo), modelo
// en gris "gunpla" con un toque del color del bando, y etiqueta con nombre y HP.
export function UnitMesh({ unit, elevation = 0, isActive = false, isSelected = false, isMine = false, onClick, onHover }: UnitMeshProps) {
  const [hovered, setHovered] = useState(false)
  const model = useUnitModel(modelUrlFor(unit.cardId))
  const hits = useDamagePopups(unit.currentHp)

  if (!unit.position || unit.currentHp <= 0) return null

  const [x, y, z] = hexToWorld(unit.position.q, unit.position.r, elevation)
  const side = isMine ? C.ally : C.enemy
  const body = isSelected ? '#fff2c2' : hovered ? '#ffffff' : isMine ? '#cfd9e8' : '#e3d2d2'

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick?.() },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true); onHover?.(true); document.body.style.cursor = 'pointer' },
    onPointerLeave: () => { setHovered(false); onHover?.(false); document.body.style.cursor = '' },
  }

  return (
    <MovingGroup target={[x, y, z]}>
      {/* Aro del bando sobre el hex (los modelos traen su propia peana, como las miniaturas) */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
        <ringGeometry args={[0.6, 0.7, 6]} />
        <meshBasicMaterial color={side} toneMapped={false} transparent opacity={0.95} />
      </mesh>
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color={side} transparent opacity={0.16} depthWrite={false} toneMapped={false} />
      </mesh>
      {!model && (
        <mesh position={[0, 0.04, 0]} castShadow receiveShadow {...handlers}>
          <cylinderGeometry args={[0.42, 0.46, 0.08, 24]} />
          <meshStandardMaterial color="#cfd6e3" metalness={0.2} roughness={0.6} />
        </mesh>
      )}
      {isActive && <ActiveRing />}

      {/* Modelo o pieza genérica */}
      {model ? (
        <group position={[0, 0.005, 0]}>
          <mesh geometry={model} scale={DEFAULT_MODEL_SCALE} castShadow {...handlers}>
            <meshStandardMaterial color={body} roughness={0.5} metalness={0.3} flatShading emissive={side} emissiveIntensity={isSelected ? 0.18 : 0.05} />
          </mesh>
        </group>
      ) : (
        <group position={[0, 0.6, 0]}>
          <group {...handlers}>
            <mesh position={[0, -0.12, 0]} castShadow>
              <capsuleGeometry args={[0.2, 0.42, 6, 12]} />
              <meshStandardMaterial color={body} roughness={0.45} metalness={0.35} />
            </mesh>
            <mesh position={[0, 0.3, 0]} castShadow>
              <boxGeometry args={[0.26, 0.16, 0.22]} />
              <meshStandardMaterial color={body} roughness={0.45} metalness={0.35} />
            </mesh>
            <mesh position={[0, 0.3, 0.115]}>
              <boxGeometry args={[0.18, 0.04, 0.01]} />
              <meshBasicMaterial color={side} toneMapped={false} />
            </mesh>
          </group>
        </group>
      )}

      {/* Daño recibido: número que sube y se desvanece */}
      {hits.map(h => (
        <Html key={h.id} position={[0, 1.2, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 26, color: C.danger, textShadow: '0 0 8px #000, 0 0 2px #000', animation: 'ga-float 1.1s ease-out forwards', display: 'block' }}>
            −{h.amount}
          </span>
        </Html>
      ))}
      {hits.length > 0 && <pointLight position={[0, 0.8, 0]} color={C.danger} intensity={6} distance={2.5} />}

      {/* Etiqueta: nombre corto + HP */}
      <Html position={[0, 1.55, 0]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <UnitLabel unit={unit} side={side} active={isActive} />
      </Html>
    </MovingGroup>
  )
}

// Lleva la cuenta de las bajadas de HP para mostrar el daño un momento
function useDamagePopups(hp: number) {
  const prev = useRef(hp)
  const [hits, setHits] = useState<{ id: number; amount: number }[]>([])
  useEffect(() => {
    const diff = prev.current - hp
    prev.current = hp
    if (diff <= 0) return
    const id = Date.now() + Math.random()
    // Se programa fuera del efecto para no encadenar renders síncronos
    const add = setTimeout(() => setHits(h => [...h, { id, amount: diff }]), 0)
    const del = setTimeout(() => setHits(h => h.filter(x => x.id !== id)), 1100)
    return () => { clearTimeout(add); clearTimeout(del) }
  }, [hp])
  return hits
}

function UnitLabel({ unit, side, active }: { unit: Unit; side: string; active: boolean }) {
  const ratio = unit.currentHp / unit.maxHp
  const hp = ratio > 0.5 ? C.ok : ratio > 0.25 ? C.warn : C.danger
  return (
    <div style={{
      fontFamily: FONT.display, fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap',
      background: 'rgba(8,12,24,0.85)', border: `1px solid ${active ? C.amber : side}`, borderRadius: 20,
      padding: '2px 9px 2px 2px', display: 'flex', alignItems: 'center', gap: 6,
      boxShadow: active ? `0 0 10px ${C.amber}66` : 'none', userSelect: 'none',
    }}>
      <UnitToken unit={unit} color={side} size={26} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{unit.shortName ?? unit.name}</span>
        <span style={{ width: 54, height: 3, background: '#2a3350', borderRadius: 2, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${ratio * 100}%`, background: hp }} />
        </span>
      </span>
    </div>
  )
}

function ActiveRing() {
  const ref = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.06
    ref.current.scale.set(s, s, s)
  })
  return (
    <mesh ref={ref} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
      <ringGeometry args={[0.74, 0.82, 6]} />
      <meshBasicMaterial color={C.amber} toneMapped={false} transparent opacity={0.9} />
    </mesh>
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
    const dist = g.position.distanceTo(goal.current)
    g.position.lerp(goal.current, 1 - Math.exp(-delta * 7))
    g.position.y += Math.min(dist, 2) * 0.08
  })
  return <group ref={ref}>{children}</group>
}
