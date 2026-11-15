import type { BoardMap } from '../types/board'
import { HexTile } from './HexTile'


const EMPTY: Set<string> = new Set()

interface GameBoardProps {
    board: BoardMap
    myPlayerId?: 'player1' | 'player2' | null
    selectedHex?: string | null
    reachableHexes?: Set<string>
    attackableHexes?: Set<string>
    onHexClick?: (key: string) => void
    onTokenHover?: (info: string | null) => void
    logHighlightedHexes?: Set<string>
    onHexHover?: (key: string | null) => void
}

export function GameBoard({
    board,
    myPlayerId = null,
    selectedHex = null,
    reachableHexes = EMPTY,
    attackableHexes = EMPTY,
    onHexClick,
    onTokenHover,
    logHighlightedHexes = EMPTY,
    onHexHover,
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
                    onHover={onHexHover ? on => onHexHover(on ? key : null) : undefined}
                />
            ))}
        </group>
    )
}