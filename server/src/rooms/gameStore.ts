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

// ─── REPETICIONES ────────────────────────────────────────────────────────────
// Se guardan al terminar cada partida. Se pueden ver con el enlace (?repeticion=ID)
// y cada jugador ve en el lobby las suyas.
import type { Replay, ReplaySummary } from '../game/replay'

export interface ReplayStore {
    save(replay: Replay): Promise<void>
    load(id: string): Promise<Replay | null>
    listFor(userId: string, limit?: number): Promise<ReplaySummary[]>
}

export class MemoryReplayStore implements ReplayStore {
    private items = new Map<string, Replay>()
    constructor(private max = 200) {}
    async save(r: Replay) {
        this.items.set(r.summary.id, r)
        while (this.items.size > this.max) this.items.delete(this.items.keys().next().value!)
    }
    async load(id: string) { return this.items.get(id) ?? null }
    async listFor(userId: string, limit = 20) {
        return [...this.items.values()].filter(r => r.userIds.includes(userId)).map(r => withSide(r.summary, r.userIds, userId)).reverse().slice(0, limit)
    }
}

export class FileReplayStore implements ReplayStore {
    constructor(private dir: string, private max = 500) { fs.mkdirSync(dir, { recursive: true }) }
    private file(id: string) { return path.join(this.dir, `${id}.json`) }
    private indexFile() { return path.join(this.dir, 'index.json') }
    private async index(): Promise<{ summary: ReplaySummary; userIds: string[] }[]> {
        try { return JSON.parse(await fs.promises.readFile(this.indexFile(), 'utf-8')) } catch { return [] }
    }
    async save(r: Replay) {
        if (!SAFE_ID.test(r.summary.id)) return
        await fs.promises.writeFile(this.file(r.summary.id), JSON.stringify(r))
        const idx = [...await this.index(), { summary: r.summary, userIds: r.userIds }]
        for (const old of idx.splice(0, Math.max(0, idx.length - this.max))) await fs.promises.rm(this.file(old.summary.id), { force: true })
        const tmp = this.indexFile() + '.tmp'
        await fs.promises.writeFile(tmp, JSON.stringify(idx))
        await fs.promises.rename(tmp, this.indexFile())
    }
    async load(id: string) {
        if (!SAFE_ID.test(id)) return null
        try { return JSON.parse(await fs.promises.readFile(this.file(id), 'utf-8')) as Replay } catch { return null }
    }
    async listFor(userId: string, limit = 20) {
        return (await this.index()).filter(e => e.userIds.includes(userId)).map(e => withSide(e.summary, e.userIds, userId)).reverse().slice(0, limit)
    }
}

export class SupabaseReplayStore implements ReplayStore {
    constructor(private client: { from: (t: string) => any }) {}   // eslint-disable-line @typescript-eslint/no-explicit-any
    async save(r: Replay) {
        const { error } = await this.client.from('replays').insert({ id: r.summary.id, summary: r.summary, data: r, user_ids: r.userIds })
        if (error) console.error('[replays] no se pudo guardar', r.summary.id, error.message)
    }
    async load(id: string) {
        if (!SAFE_ID.test(id)) return null
        const { data, error } = await this.client.from('replays').select('data').eq('id', id).maybeSingle()
        if (error) { console.error('[replays]', error.message); return null }
        return (data?.data as Replay) ?? null
    }
    async listFor(userId: string, limit = 20) {
        const { data, error } = await this.client.from('replays').select('summary, user_ids').contains('user_ids', [userId])
            .order('created_at', { ascending: false }).limit(limit)
        if (error) { console.error('[replays]', error.message); return [] }
        return (data ?? []).map((r: { summary: ReplaySummary; user_ids: string[] }) => withSide(r.summary, r.user_ids, userId))
    }
}

// userIds va en orden de jugador: [player1, player2]
function withSide(summary: ReplaySummary, userIds: string[], userId: string): ReplaySummary {
    const i = userIds.indexOf(userId)
    return i === 0 ? { ...summary, mySide: 'player1' } : i === 1 ? { ...summary, mySide: 'player2' } : summary
}

export async function createReplayStore(kind = process.env.GAME_STORE ?? 'file'): Promise<ReplayStore> {
    if (kind === 'none') return new MemoryReplayStore()
    if (kind === 'supabase') {
        const { supabaseAdmin } = await import('../lib/supabase')
        return new SupabaseReplayStore(supabaseAdmin)
    }
    return new FileReplayStore(process.env.REPLAY_DIR ?? path.join(__dirname, '../../data/runtime/replays'))
}
