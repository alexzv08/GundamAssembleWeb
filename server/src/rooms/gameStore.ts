// Almacén de salas en curso, para que un reinicio o un despliegue del servidor
// no borre las partidas que se están jugando.
//  - FileGameStore: un JSON por sala en disco (sobrevive a reinicios del proceso;
//    en Railway solo a los despliegues si el directorio es un volumen).
//  - SupabaseGameStore: tabla active_rooms (ver supabase/migrations); sobrevive a
//    despliegues y permite varias instancias.
// Elegido con GAME_STORE=file|supabase|none (por defecto: file en local, none en tests).
import fs from 'fs'
import path from 'path'
import type { Room } from './roomManager'

export interface GameStore {
    save(room: Room): Promise<void>
    remove(roomId: string): Promise<void>
    loadAll(): Promise<Room[]>
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export class FileGameStore implements GameStore {
    constructor(private dir: string) { fs.mkdirSync(dir, { recursive: true }) }
    private file(id: string) { return path.join(this.dir, `${id}.json`) }
    async save(room: Room): Promise<void> {
        if (!SAFE_ID.test(room.id)) return
        const tmp = this.file(room.id) + '.tmp'
        await fs.promises.writeFile(tmp, JSON.stringify(room))
        await fs.promises.rename(tmp, this.file(room.id))   // escritura atómica
    }
    async remove(roomId: string): Promise<void> {
        if (!SAFE_ID.test(roomId)) return
        await fs.promises.rm(this.file(roomId), { force: true })
    }
    async loadAll(): Promise<Room[]> {
        const rooms: Room[] = []
        for (const f of await fs.promises.readdir(this.dir)) {
            if (!f.endsWith('.json')) continue
            try { rooms.push(JSON.parse(await fs.promises.readFile(path.join(this.dir, f), 'utf-8'))) } catch { /* archivo corrupto: se ignora */ }
        }
        return rooms
    }
}

export class SupabaseGameStore implements GameStore {
    // El cliente se importa al crear el almacén para no exigir Supabase en tests
    constructor(private client: { from: (t: string) => any }) {}   // eslint-disable-line @typescript-eslint/no-explicit-any
    async save(room: Room): Promise<void> {
        const { error } = await this.client.from('active_rooms').upsert({ id: room.id, data: room, updated_at: new Date().toISOString() })
        if (error) console.error('[gameStore] no se pudo guardar', room.id, error.message)
    }
    async remove(roomId: string): Promise<void> {
        const { error } = await this.client.from('active_rooms').delete().eq('id', roomId)
        if (error) console.error('[gameStore] no se pudo borrar', roomId, error.message)
    }
    async loadAll(): Promise<Room[]> {
        const { data, error } = await this.client.from('active_rooms').select('data')
        if (error) { console.error('[gameStore] no se pudieron cargar las salas:', error.message); return [] }
        return (data ?? []).map((r: { data: Room }) => r.data)
    }
}

export async function createGameStore(kind = process.env.GAME_STORE ?? 'file'): Promise<GameStore | null> {
    if (kind === 'none') return null
    if (kind === 'supabase') {
        const { supabaseAdmin } = await import('../lib/supabase')
        return new SupabaseGameStore(supabaseAdmin)
    }
    return new FileGameStore(process.env.GAME_STORE_DIR ?? path.join(__dirname, '../../data/runtime/rooms'))
}
