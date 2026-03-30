const API = 'http://localhost:3001/api'

// ─── TIPOS DEL JSON ───────────────────────────────────────────────────────────
export interface MapData {
    version: number
    cols: number
    rows: number
    grid: {
        terrain: string
        elevation: number
    }[][]
}

export interface WeaponData {
    name: string
    cost: string
    range: string
    str: string
    effect: string
    crit: string
    dots: number
}

export interface AbilityData {
    name: string
    type: string
    tags: string
    effect: string
}

export interface UnitCardData {
    uid: number
    unitName: string
    pilot: string
    faction: string
    cardId: string
    hp: string
    vp: string
    tl: string
    weapons: WeaponData[]
    abilities: AbilityData[]
}

export interface TacticsCardData {
    uid: number
    name: string
    type: string
    faction: string
    cardId: string
    effect: string
}

// ─── FETCHERS ─────────────────────────────────────────────────────────────────
export async function fetchMap(mapId: string): Promise<MapData> {
    const res = await fetch(`${API}/maps/${mapId}`)
    if (!res.ok) throw new Error(`Map not found: ${mapId}`)
    return res.json()
}

export async function fetchUnits(): Promise<{ cards: UnitCardData[] }> {
    const res = await fetch(`${API}/units`)
    if (!res.ok) throw new Error('Error fetching units')
    return res.json()
}

export async function fetchCards(): Promise<{ cards: TacticsCardData[] }> {
    const res = await fetch(`${API}/cards`)
    if (!res.ok) throw new Error('Error fetching cards')
    return res.json()
}

export async function fetchMapList(): Promise<{ maps: { id: string; name: string }[] }> {
    const res = await fetch(`${API}/maps`)
    if (!res.ok) throw new Error('Error fetching maps')
    return res.json()
}