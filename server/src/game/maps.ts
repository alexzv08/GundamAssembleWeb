// Mapas disponibles en server/data/maps (sin dependencias de red ni de Supabase).
import fs from 'fs'
import path from 'path'

const MAPS_DIR = path.join(__dirname, '../../data/maps')
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export interface MapSummary { id: string; name: string; squadSize: number; description?: string }

// Lista de mapas oficiales (no incluye los de la comunidad)
export function listMaps(): MapSummary[] {
    return fs.readdirSync(MAPS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const id = f.replace('.json', '')
            const data = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, f), 'utf-8'))
            return {
                id,
                name: data.scenario?.name && data.scenario.name !== id ? data.scenario.name : id.replace(/([A-Z])/g, ' $1').trim(),
                squadSize: data.scenario?.squadSize === 5 ? 5 : 3,
                description: data.scenario?.description || undefined,
            }
        })
}

export function mapExists(id: string): boolean {
    return SAFE_ID.test(id) && fs.existsSync(path.join(MAPS_DIR, `${id}.json`))
}

// Mapa al azar para las partidas públicas (solo los de escuadras de 3)
export function randomMapId(random: () => number = Math.random): string {
    const maps = listMaps().filter(m => m.squadSize === 3)
    return maps.length ? maps[Math.floor(random() * maps.length)].id : 'DemoMap'
}
