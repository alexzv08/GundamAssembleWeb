import { useState, useEffect } from 'react'
import type { BoardMap } from '../types/board'
import { fetchMap, fetchUnits, fetchCards } from '../api/gameData'
import type { UnitCardData, TacticsCardData } from '../api/gameData'
import { loadMapFromJSON } from './loaders'

export interface GameData {
    board: BoardMap
    allUnitCards: UnitCardData[]
    allTacticsCards: TacticsCardData[]
    loaded: boolean
    error: string | null
}

export function useGameData(): GameData {
    const [data, setData] = useState<GameData>({
        board: {},
        allUnitCards: [],
        allTacticsCards: [],
        loaded: false,
        error: null,
    })

    useEffect(() => {
        Promise.all([fetchMap('DemoMap'), fetchUnits(), fetchCards()])
            .then(([mapData, unitsData, cardsData]) => {
                const board = loadMapFromJSON(mapData)
                setData({
                    board,
                    allUnitCards: unitsData.cards,
                    allTacticsCards: cardsData.cards,
                    loaded: true,
                    error: null,
                })
            })
            .catch(err => {
                setData(prev => ({ ...prev, loaded: true, error: err.message }))
            })
    }, [])

    return data
}
