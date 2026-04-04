import { useRef, useState } from 'react'
import { Mesh } from 'three'
import { hexToWorld, terrainColor, HEX_SIZE, HEX_HEIGHT } from './hexUtils'
import type { Hex } from '../types/board'

interface HexTileProps {
    hex: Hex
    isSelected?: boolean
    isReachable?: boolean
    isAttackable?: boolean
    onClick?: () => void
    onHover?: () => void
    onTokenHover?: (info: string | null) => void
}

export function HexTile({
    hex,
    isSelected = false,
    isReachable = false,
    isAttackable = false,
    onClick,
    onHover,
    onTokenHover,
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

    const objColor = hex.objectiveToken?.controlledBy === 'player1' ? '#4fc3f7'
        : hex.objectiveToken?.controlledBy === 'player2' ? '#ef9a9a'
            : '#f5c518'

    return (
        <group>
            {/* Hex principal */}
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

            {/* Objetivo */}
            {hex.objectiveToken && (
                <mesh
                    position={[x, y + 0.15, z]}
                    onPointerEnter={(e) => {
                        e.stopPropagation()
                        onTokenHover?.(`🎯 Objetivo — ${hex.objectiveToken!.vpValue} VP al final de fase`)
                    }}
                    onPointerLeave={() => onTokenHover?.(null)}
                >
                    <cylinderGeometry args={[0.3, 0.3, 0.08, 6, 1, false, Math.PI / 6]} />
                    <meshStandardMaterial color={objColor} emissive={objColor} emissiveIntensity={0.4} />
                </mesh>
            )}

            {/* Garrison */}
            {hex.garrisonToken && (
                <mesh
                    position={[x, y + 0.15, z]}
                    onPointerEnter={(e) => {
                        e.stopPropagation()
                        onTokenHover?.(
                            `🏠 Garrison ${hex.garrisonToken!.owner === 'player1' ? '(Federación)' : '(Zeon)'} — Rescátala para 2 VP`
                        )
                    }}
                    onPointerLeave={() => onTokenHover?.(null)}
                >
                    <boxGeometry args={[0.25, 0.25, 0.25]} />
                    <meshStandardMaterial
                        color={hex.garrisonToken.owner === 'player1' ? '#4fc3f7' : '#ef9a9a'}
                        emissive={hex.garrisonToken.owner === 'player1' ? '#4fc3f7' : '#ef9a9a'}
                        emissiveIntensity={0.3}
                    />
                </mesh>
            )}

            {/* Upgrade / Energy token */}
            {hex.upgradeToken && (
                <mesh
                    position={[x, y + 0.15, z]}
                    onPointerEnter={(e) => {
                        e.stopPropagation()
                        const labels: Record<string, string> = {
                            attack: '⚔ Upgrade de Ataque — +1 Strength permanente',
                            shield: '🛡 Upgrade de Escudo — absorbe 1 daño',
                            movement: '👟 Upgrade de Movimiento — +1 hex de movimiento',
                            energy: '⚡ Energía — gana 1 token de energía',
                        }
                        onTokenHover?.(
                            hex.upgradeToken!.revealed
                                ? labels[hex.upgradeToken!.type]
                                : '❓ Token oculto — muévete aquí para revelarlo'
                        )
                    }}
                    onPointerLeave={() => onTokenHover?.(null)}
                >
                    <octahedronGeometry args={[0.2]} />
                    <meshStandardMaterial
                        color={
                            hex.upgradeToken.revealed
                                ? hex.upgradeToken.type === 'attack' ? '#ef9a9a'
                                    : hex.upgradeToken.type === 'shield' ? '#4fc3f7'
                                        : hex.upgradeToken.type === 'energy' ? '#f5c518'
                                            : '#81c784'
                                : '#555555'
                        }
                        emissive={
                            hex.upgradeToken.revealed
                                ? hex.upgradeToken.type === 'attack' ? '#ef9a9a'
                                    : hex.upgradeToken.type === 'shield' ? '#4fc3f7'
                                        : hex.upgradeToken.type === 'energy' ? '#f5c518'
                                            : '#81c784'
                                : '#000000'
                        }
                        emissiveIntensity={hex.upgradeToken.revealed ? 0.3 : 0}
                    />
                </mesh>
            )}
        </group>
    )
}