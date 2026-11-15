import { memo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { hexToWorld, terrainLook, HEX_SIZE, HEX_HEIGHT } from './hexUtils'
import type { Hex } from '../types/board'
import { C, sideColor } from '../theme'

interface HexTileProps {
    hex: Hex
    myPlayerId?: 'player1' | 'player2' | null
    isSelected?: boolean
    isReachable?: boolean
    isAttackable?: boolean
    isLogHighlighted?: boolean
    onClick?: () => void
    onTokenHover?: (info: string | null) => void
    onHover?: (on: boolean) => void
}

// Resaltados: colores que no existen en el terreno (H2)
const HL_REACH = C.ally
const HL_ATTACK = C.enemy
const HL_SELECT = C.amber
const HL_LOG = '#d9a520'

export const HexTile = memo(function HexTile({
    hex, myPlayerId = null, isSelected = false, isReachable = false, isAttackable = false, isLogHighlighted = false,
    onClick, onTokenHover, onHover,
}: HexTileProps) {
    const [hovered, setHovered] = useState(false)
    const look = terrainLook(hex.terrain, hex.elevation)
    const { q, r } = hex.coord
    const [x, y, z] = hexToWorld(q, r, hex.elevation)
    const height = HEX_HEIGHT + hex.elevation * 0.3

    const highlight = isAttackable ? HL_ATTACK : isReachable ? HL_REACH : isSelected ? HL_SELECT : isLogHighlighted ? HL_LOG : null
    const interactive = isAttackable || isReachable

    return (
        <group>
            {/* Cuerpo (laterales más oscuros) */}
            <mesh position={[x, y - height / 2, z]} castShadow receiveShadow
                onClick={e => { e.stopPropagation(); onClick?.() }}
                onPointerEnter={e => { e.stopPropagation(); setHovered(true); onHover?.(true) }}
                onPointerLeave={() => { setHovered(false); onHover?.(false) }}
            >
                <cylinderGeometry args={[HEX_SIZE * 0.97, HEX_SIZE * 0.99, height, 6, 1, false, 0]} />
                <meshStandardMaterial color={look.side} roughness={0.95} metalness={0.05} />
            </mesh>

            {/* Cara superior: color del terreno + resaltado */}
            <mesh position={[x, y + 0.006, z]} receiveShadow
                onClick={e => { e.stopPropagation(); onClick?.() }}
                onPointerEnter={e => { e.stopPropagation(); setHovered(true); onHover?.(true) }}
                onPointerLeave={() => { setHovered(false); onHover?.(false) }}
            >
                <cylinderGeometry args={[HEX_SIZE * 0.9, HEX_SIZE * 0.95, 0.03, 6, 1, false, 0]} />
                <meshStandardMaterial
                    color={highlight ? mix(look.top, highlight, 0.55) : hovered ? lighten(look.top, 0.18) : look.top}
                    roughness={0.85}
                    metalness={0.05}
                    emissive={highlight ?? look.emissive ?? '#000000'}
                    emissiveIntensity={highlight ? (hovered && interactive ? 0.75 : 0.42) : (look.emissiveIntensity ?? 0)}
                />
            </mesh>

            {/* Borde brillante en los hexes elegibles: se leen aunque estén en sombra */}
            {highlight && <HexOutline x={x} y={y + 0.03} z={z} color={highlight} pulse={interactive} />}

            {hex.deployZone && (
                <HexOutline x={x} y={y + 0.035} z={z} color={sideColor(hex.deployZone, myPlayerId)} radius={0.72} />
            )}

            {hex.objectiveToken && (
                <ObjectiveToken x={x} y={y} z={z}
                    color={hex.objectiveToken.controlledBy ? sideColor(hex.objectiveToken.controlledBy, myPlayerId) : C.amber}
                    onHover={on => onTokenHover?.(on ? `Objetivo: ${hex.objectiveToken!.vpValue} VP al final de cada fase para quien lo controle` : null)} />
            )}

            {hex.garrisonToken && (
                <group position={[x, y, z]}
                    onPointerEnter={e => {
                        e.stopPropagation()
                        onTokenHover?.(hex.garrisonToken!.owner === myPlayerId
                            ? 'Garrison aliada: rescátala para +2 VP'
                            : 'Garrison enemiga: destrúyela para +2 VP')
                    }}
                    onPointerLeave={() => onTokenHover?.(null)}
                >
                    <mesh position={[0, 0.1, 0]} castShadow>
                        <boxGeometry args={[0.42, 0.2, 0.32]} />
                        <meshStandardMaterial color="#2b3247" roughness={0.6} metalness={0.4} />
                    </mesh>
                    <mesh position={[0, 0.22, 0]}>
                        <boxGeometry args={[0.44, 0.04, 0.34]} />
                        <meshStandardMaterial color={sideColor(hex.garrisonToken.owner, myPlayerId)} emissive={sideColor(hex.garrisonToken.owner, myPlayerId)} emissiveIntensity={0.7} />
                    </mesh>
                </group>
            )}

            {hex.upgradeToken && !hex.upgradeToken.revealed && (
                <UpgradeToken x={x} y={y} z={z}
                    onHover={on => onTokenHover?.(on ? 'Token oculto: termina un movimiento aquí para revelarlo (Upgrade o Energy)' : null)} />
            )}
        </group>
    )
})

function HexOutline({ x, y, z, color, radius = 0.9, pulse = false }: { x: number; y: number; z: number; color: string; radius?: number; pulse?: boolean }) {
    const ref = useRef<Mesh>(null)
    useFrame(({ clock }) => {
        if (!pulse || !ref.current) return
        const m = ref.current.material as { opacity: number }
        m.opacity = 0.65 + Math.sin(clock.elapsedTime * 4) * 0.3
    })
    return (
        <mesh ref={ref} position={[x, y, z]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
            <ringGeometry args={[radius - 0.06, radius, 6]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
        </mesh>
    )
}

function ObjectiveToken({ x, y, z, color, onHover }: { x: number; y: number; z: number; color: string; onHover: (on: boolean) => void }) {
    const beam = useRef<Mesh>(null)
    useFrame(({ clock }) => {
        if (beam.current) (beam.current.material as { opacity: number }).opacity = 0.16 + Math.sin(clock.elapsedTime * 1.6) * 0.05
    })
    return (
        <group position={[x, y, z]}
            onPointerEnter={e => { e.stopPropagation(); onHover(true) }}
            onPointerLeave={() => onHover(false)}>
            <mesh position={[0, 0.06, 0]} castShadow>
                <cylinderGeometry args={[0.34, 0.38, 0.1, 6, 1, false, 0]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} metalness={0.5} roughness={0.35} />
            </mesh>
            <mesh ref={beam} position={[0, 1.1, 0]}>
                <cylinderGeometry args={[0.22, 0.34, 2, 6, 1, true, 0]} />
                <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    )
}

function UpgradeToken({ x, y, z, onHover }: { x: number; y: number; z: number; onHover: (on: boolean) => void }) {
    const ref = useRef<Mesh>(null)
    useFrame(({ clock }) => {
        if (!ref.current) return
        ref.current.rotation.y = clock.elapsedTime * 0.8
        ref.current.position.y = y + 0.28 + Math.sin(clock.elapsedTime * 2 + x) * 0.04
    })
    return (
        <mesh ref={ref} position={[x, y + 0.28, z]} castShadow
            onPointerEnter={e => { e.stopPropagation(); onHover(true) }}
            onPointerLeave={() => onHover(false)}>
            <octahedronGeometry args={[0.17]} />
            <meshStandardMaterial color="#c9d3ea" emissive="#7f8fb5" emissiveIntensity={0.35} metalness={0.7} roughness={0.25} />
        </mesh>
    )
}

// Mezcla de colores hex (#rrggbb)
function mix(a: string, b: string, t: number): string {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
    const ch = (p: number, s: number) => (p >> s) & 255
    const m = (s: number) => Math.round(ch(pa, s) * (1 - t) + ch(pb, s) * t)
    return '#' + ((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')
}
function lighten(a: string, t: number): string { return mix(a, '#ffffff', t) }
