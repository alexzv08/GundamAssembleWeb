import type { BoardMap } from '../types/board'
import { HexTile } from './HexTile'
import { hexKey } from '../game/hexGrid'

interface GameBoardProps {
    board: BoardMap
    selectedHex?: string | null
    reachableHexes?: Set<string>
    attackableHexes?: Set<string>
    onHexClick?: (key: string) => void
    onTokenHover?: (info: string | null) => void
}

export function GameBoard({
    board,
    selectedHex = null,
    reachableHexes = new Set(),
    attackableHexes = new Set(),
    onHexClick,
    onTokenHover,
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
                    onTokenHover={onTokenHover}
                />
            ))}
        </group>
    )
}