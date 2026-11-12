const API = `${import.meta.env.VITE_SERVER_URL}/api`

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

// Formato v2 de server/data/units/unit_library.json
export interface WeaponData {
    name: string
    tlCost: number
    range: number
    strength: number
    effect: string
    crit: string
}

export interface AbilityData {
    name: string
    type: 'CMD' | 'ONG' | 'RSP' | 'SETUP'
    effect: string
    energyCost?: number
    abilityData?: unknown
}

export interface UnitCardData {
    cardId: string
    set: string
    name: string
    model?: string
    signature?: string
    traits: string[]
    hp: number
    vp: number
    tl: number
    provisionalStats?: boolean
    weapons: WeaponData[]
    abilities: AbilityData[]
}

export interface TacticsCardData {
    cardId: string
    name: string
    type: string
    faction: string
    signature?: string
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