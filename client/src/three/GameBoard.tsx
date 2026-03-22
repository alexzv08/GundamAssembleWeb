import type { BoardMap } from '../types'
import { HexTile } from './HexTile'
import { hexKey } from '../game/hexGrid'


interface GameBoardProps {
    board: BoardMap
    selectedHex?: string | null        // hexKey del hex seleccionado
    reachableHexes?: Set<string>       // hexes a los que se puede mover
    attackableHexes?: Set<string>      // hexes en rango de ataque
    onHexClick?: (key: string) => void
}

export function GameBoard({
    board,
    selectedHex = null,
    reachableHexes = new Set(),
    attackableHexes = new Set(),
    onHexClick,
}: GameBoardProps) {
    return (
        <group>
            {Object.entries(board).map(([key, hex]) => (
                <HexTile
                    key={key}
                    hex={hex}
                    isSelected={selectedHex === key}
                    isReachable={reachableHexes.has(key)}
                    isAttackable={attackableHexes.has(key)}
                    onClick={() => onHexClick?.(key)}
                />
            ))}
        </group>
    )
}