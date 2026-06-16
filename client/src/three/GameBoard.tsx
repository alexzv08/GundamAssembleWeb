import type { BoardMap } from '../types/board'
import { HexTile } from './HexTile'


interface GameBoardProps {
    board: BoardMap
    myPlayerId?: 'player1' | 'player2' | null
    selectedHex?: string | null
    reachableHexes?: Set<string>
    attackableHexes?: Set<string>
    onHexClick?: (key: string) => void
    onTokenHover?: (info: string | null) => void
    logHighlightedHexes?: Set<string>
}

export function GameBoard({
    board,
    myPlayerId = null,
    selectedHex = null,
    reachableHexes = new Set(),
    attackableHexes = new Set(),
    onHexClick,
    onTokenHover,
    logHighlightedHexes = new Set(),
}: GameBoardProps) {
    return (
        <group>
            {Object.entries(board).map(([key, hex]) => (
                <HexTile
                    key={key}
                    hex={hex}
                    myPlayerId={myPlayerId}
                    isSelected={selectedHex === key}
                    isReachable={reachableHexes.has(key)}
                    isAttackable={attackableHexes.has(key)}
                    isLogHighlighted={logHighlightedHexes.has(key)}
                    onClick={() => onHexClick?.(key)}
                    onTokenHover={onTokenHover}
                />
            ))}
        </group>
    )
}