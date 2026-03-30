import { useState, useEffect } from 'react'
import type { BoardMap } from '../types/board'
import type { Unit } from '../types/units'
import { fetchMap, fetchUnits } from '../api/gameData'
import type { UnitCardData } from '../api/gameData'
import { loadMapFromJSON, loadUnitFromJSON } from './loaders'
import { offsetToAxial } from './hexGrid'

export interface GameData {
    board: BoardMap
    federationCards: UnitCardData[]
    zeonCards: UnitCardData[]
    loaded: boolean
    error: string | null
}

export function useGameData(): GameData {
    const [data, setData] = useState<GameData>({
        board: {},
        federationCards: [],
        zeonCards: [],
        loaded: false,
        error: null,
    })

    useEffect(() => {
        Promise.all([fetchMap('DemoMap'), fetchUnits()])
            .then(([mapData, unitsData]) => {
                const board = loadMapFromJSON(mapData)
                const fed = unitsData.cards.filter(c => c.faction === 'Earth Federation')
                const zeon = unitsData.cards.filter(c => c.faction === 'Zeon')
                setData({ board, federationCards: fed, zeonCards: zeon, loaded: true, error: null })
            })
            .catch(err => {
                setData(prev => ({ ...prev, loaded: true, error: err.message }))
            })
    }, [])

    return data
}

export function createUnitsFromCards(
    fedCards: UnitCardData[],
    zeonCards: UnitCardData[],
): { p1Units: Unit[]; p2Units: Unit[] } {
    const fedPositions = [
        offsetToAxial(0, 6),
        offsetToAxial(0, 7),
        offsetToAxial(0, 8),
    ]
    const zeonPositions = [
        offsetToAxial(13, 6),
        offsetToAxial(13, 7),
        offsetToAxial(13, 8),
    ]

    const p1Units = fedCards.slice(0, 3).map((card, i) =>
        loadUnitFromJSON(card, 'player1', fedPositions[i])
    )
    const p2Units = zeonCards.slice(0, 3).map((card, i) =>
        loadUnitFromJSON(card, 'player2', zeonPositions[i])
    )

    return { p1Units, p2Units }
}