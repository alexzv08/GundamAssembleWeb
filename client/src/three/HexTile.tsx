import { useRef, useState } from 'react'
import { Mesh } from 'three'
import { hexToWorld, terrainColor, HEX_SIZE, HEX_HEIGHT } from './hexUtils'
import type { Hex } from '../types'

interface HexTileProps {
    hex: Hex
    isSelected?: boolean
    isReachable?: boolean
    isAttackable?: boolean
    onClick?: () => void
    onHover?: () => void
}

export function HexTile({
    hex,
    isSelected = false,
    isReachable = false,
    isAttackable = false,
    onClick,
    onHover,
}: HexTileProps) {
    const meshRef = useRef<Mesh>(null)
    const [hovered, setHovered] = useState(false)

    const { q, r } = hex.coord
    const [x, y, z] = hexToWorld(q, r, hex.elevation)

    let color = terrainColor(hex.terrain, hex.elevation)
    if (isSelected) color = '#f5c518'
    if (isReachable) color = '#4caf50'
    if (isAttackable) color = '#e53935'
    if (hovered && !isSelected) color = '#ffffff'

    const height = HEX_HEIGHT + hex.elevation * 0.3

    return (
        <mesh
            ref={meshRef}
            position={[x, y - height / 2, z]}
            onClick={(e) => { e.stopPropagation(); onClick?.() }}
            onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); onHover?.() }}
            onPointerLeave={() => setHovered(false)}
        >
            <cylinderGeometry args={[HEX_SIZE * 0.96, HEX_SIZE * 0.96, height, 6, 1, false, Math.PI / 6]} />
            <meshStandardMaterial
                color={color}
                roughness={0.8}
                metalness={0.1}
                transparent={isReachable || isAttackable}
                opacity={isReachable || isAttackable ? 0.75 : 1}
            />
        </mesh>
    )
}