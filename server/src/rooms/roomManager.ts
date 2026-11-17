import { Server } from 'socket.io'
import { GameState } from '../types/gameState'
import { randomInt } from 'crypto'
import { startGame } from '../game/activation'
import { createServerGame } from '../game/createServerGame'
import { loadUnitCatalog, loadTacticsCatalog, validateSquad, validateDeck, eligibleCards } from '../game/catalog'
import { mapExists, randomMapId } from '../game/maps'
import { forfeit } from '../game/victory'
import type { GameStore, ReplayStore } from './gameStore'
import { startRecording, recordForfeit, summarize, type ReplayRecord } from '../game/replay'
import { randomSquad, randomDeck, BOT_LEVELS, type BotLevel } from '../game/bot'

const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutos

export interface Room {
    id: string
    players: { socketId: string; userId: string; playerId: 'player1' | 'player2'; name: string }[]
    gameState: GameState | null
    status: 'waiting' | 'squad_selection' | 'playing' | 'finished'
    squadSelections: { player1: string[] | null; player2: string[] | null }
    deckSelections: { player1: string[] | null; player2: string[] | null }
    setupConfirmed: { player1: boolean; player2: boolean }
    mapId: string
    squadSize: number
    vsBot?: boolean          // el jugador 2 es el bot del servidor
    botLevel?: BotLevel      // dificultad del bot
    record?: ReplayRecord | null       // acciones de la partida en curso (para la repetición)
    replayId?: string | null           // repetición guardada al terminar
    rematch?: ('player1' | 'player2')[] // quién ha pedido la revancha
    mesa?: boolean                     // modo mesa: un jugador apunta una partida real y lleva los dos bandos
    mesaFirst?: 'player1' | 'player2'  // modo mesa: quién gana la tirada si empatan en iniciativa
}

export const MESA_USER_ID = 'mesa'

export const BOT_USER_ID = 'bot'

export interface RoomOptions { mapId?: string; squadSize?: number; botLevel?: string }

export class RoomManager {
    private rooms = new Map<string, Room>()
    private socketToRoom = new Map<string, string>()
    private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
    constructor(private reconnectTimeoutMs = RECONNECT_TIMEOUT_MS) {}
    private spectators = new Map<string, string>()   // socketId → roomId
    private finishedTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private matchmakingQueue: { socketId: string; userId: string; playerName: string }[] = []

    private newRoomId(): string {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        let id = ''
        do {
            id = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
        } while (this.rooms.has(id))
        return id
    }

    createRoom(socketId: string, playerName: string, userId: string, opts: RoomOptions = {}): Room {
        const roomId = this.newRoomId()
        const room: Room = {
            id: roomId,
            players: [{ socketId, userId, playerId: 'player1', name: playerName }],
            gameState: null,
            status: 'waiting',
            squadSelections: { player1: null, player2: null },
            deckSelections: { player1: null, player2: null },
            setupConfirmed: { player1: false, player2: false },
            mapId: opts.mapId && mapExists(opts.mapId) ? opts.mapId : 'DemoMap',
            squadSize: opts.squadSize === 5 ? 5 : 3,
        }
        this.rooms.set(roomId, room)
        this.socketToRoom.set(socketId, roomId)
        return room
    }

    // Sala de práctica: el jugador 2 es el bot, que elige escuadra y confirma solo.
    createBotRoom(socketId: string, playerName: string, userId: string, opts: RoomOptions = {}): Room {
        const room = this.createRoom(socketId, playerName, userId, opts)
        room.players.push({ socketId: '', userId: BOT_USER_ID, playerId: 'player2', name: 'Bot' })
        room.status = 'squad_selection'
        room.vsBot = true
        room.botLevel = (BOT_LEVELS as string[]).includes(opts.botLevel ?? '') ? opts.botLevel as BotLevel : 'normal'
        const squad = randomSquad(room.squadSize)
        room.squadSelections.player2 = squad
        room.deckSelections.player2 = randomDeck(squad)
        return room
    }

    // Modo mesa: el jugador apunta en la app una partida que juega en una mesa real.
    // Lleva los dos bandos; el del rival no tiene socket propio y su mazo es oculto.
    createMesaRoom(socketId: string, playerName: string, userId: string, opts: RoomOptions & { rivalName?: string } = {}): Room {
        const room = this.createRoom(socketId, playerName, userId, opts)
        const rival = typeof opts.rivalName === 'string' && opts.rivalName.trim() ? opts.rivalName.trim().slice(0, 32) : 'Rival'
        room.players.push({ socketId: '', userId: MESA_USER_ID, playerId: 'player2', name: rival })
        room.status = 'squad_selection'
        room.mesa = true
        return room
    }

    // Escuadra del rival en el modo mesa. Su mazo no se conoce: cuenta con todas las
    // cartas oficiales que puede llevar (y las va quitando según las juega).
    submitMesaRival(socketId: string, unitCardIds: string[], first: unknown): { room: Room } | { error: string } {
        const room = this.getRoomBySocket(socketId)
        if (!room?.mesa || room.status !== 'squad_selection') return { error: 'No estás preparando una partida en modo mesa' }
        const units = loadUnitCatalog()
        const squadError = validateSquad(unitCardIds, units, room.squadSize)
        if (squadError) return { error: `Escuadra del rival: ${squadError}` }
        room.squadSelections.player2 = unitCardIds
        room.deckSelections.player2 = eligibleCards(unitCardIds, units, loadTacticsCatalog()).filter(c => c.source !== 'demo').map(c => c.id)
        room.mesaFirst = first === 'player2' ? 'player2' : 'player1'
        return { room }
    }

    joinRoom(roomId: string, socketId: string, playerName: string, userId: string): Room | null {
        const room = this.rooms.get(roomId)
        if (!room || room.players.length >= 2 || room.status !== 'waiting') return null
        if (room.players.some(p => p.userId === userId)) return null

        room.players.push({ socketId, userId, playerId: 'player2', name: playerName })
        this.socketToRoom.set(socketId, roomId)
        room.status = 'squad_selection'
        room.squadSelections = { player1: null, player2: null }
        room.deckSelections = { player1: null, player2: null }
        room.setupConfirmed = { player1: false, player2: false }

        return room
    }

    // Valida escuadra y mazo con las reglas de construcción antes de aceptarlos.
    submitSquad(socketId: string, unitCardIds: string[], cardIds: string[]): { room: Room; ready: boolean } | { error: string } {
        const room = this.getRoomBySocket(socketId)
        const playerId = this.getPlayerIdBySocket(socketId)
        if (!room || !playerId || room.status !== 'squad_selection') return { error: 'No estás en la selección de escuadra' }
        if (room.squadSelections[playerId] !== null) return { error: 'Ya enviaste tu escuadra' }

        const units = loadUnitCatalog()
        const tactics = loadTacticsCatalog()
        const squadError = validateSquad(unitCardIds, units, room.squadSize)
        if (squadError) return { error: squadError }
        const deckError = validateDeck(cardIds, unitCardIds, units, tactics)
        if (deckError) return { error: deckError }

        room.squadSelections[playerId] = unitCardIds
        room.deckSelections[playerId] = cardIds

        const ready = room.squadSelections.player1 !== null && room.squadSelections.player2 !== null
        if (ready) {
            room.gameState = createServerGame(
                room.players[0].name,
                room.players[1].name,
                room.squadSelections.player1!,
                room.squadSelections.player2!,
                room.deckSelections.player1!,
                room.deckSelections.player2!,
                // Modo mesa: si empatan en iniciativa gana quien dijo el jugador (tirada de la mesa)
                room.mesa ? { mapId: room.mapId, rng: mesaInitiative(room.mesaFirst ?? 'player1') } : { mapId: room.mapId },
            )
            if (room.vsBot) room.gameState.vsBot = true
            if (room.mesa) {
                room.gameState.mesa = true
                // La tirada de iniciativa (si hubo empate) se hizo en la mesa: no inventar números
                const g = room.gameState
                for (const l of g.log) if (l.message.startsWith('Iniciativa:')) l.message = `Iniciativa: empate en TL; empieza ${g.players[room.mesaFirst ?? 'player1'].name} (tirada de la mesa)`
                // La mano real de cada uno no se conoce: se puede jugar cualquier carta del mazo
                for (const p of ['player1', 'player2'] as const) {
                    const t = room.gameState.players[p].tactics
                    t.hand = [...t.hand, ...t.deck]
                    t.deck = []
                }
            }
            room.status = 'playing'
        }

        return { room, ready }
    }

    confirmSetup(socketId: string): { room: Room; bothConfirmed: boolean } | null {
        const room = this.getRoomBySocket(socketId)
        const playerId = this.getPlayerIdBySocket(socketId)
        if (!room || !playerId || !room.gameState || room.gameState.phase !== 'setup') return null

        room.setupConfirmed[playerId] = true
        if (room.vsBot || room.mesa) room.setupConfirmed.player2 = true   // el bot (o el rival de la mesa) confirma siempre
        const bothConfirmed = room.setupConfirmed.player1 && room.setupConfirmed.player2

        if (bothConfirmed) {
            room.gameState = startGame(structuredClone(room.gameState))
            room.setupConfirmed = { player1: false, player2: false }
            room.record = startRecording(room.gameState)
        }

        return { room, bothConfirmed }
    }

    getRoom(roomId: string): Room | null {
        return this.rooms.get(roomId) ?? null
    }

    getRoomBySocket(socketId: string): Room | null {
        const roomId = this.socketToRoom.get(socketId)
        if (!roomId) return null
        return this.rooms.get(roomId) ?? null
    }

    getPlayerIdBySocket(socketId: string): 'player1' | 'player2' | null {
        const room = this.getRoomBySocket(socketId)
        if (!room) return null
        return room.players.find(p => p.socketId === socketId)?.playerId ?? null
    }

    joinQueue(socketId: string, playerName: string, userId: string): { matched: true; room: Room; p1SocketId: string } | { matched: false } {
        this.matchmakingQueue = this.matchmakingQueue.filter(p => p.socketId !== socketId && p.userId !== userId)

        if (this.matchmakingQueue.length > 0) {
            const opponent = this.matchmakingQueue.shift()!
            // Partida pública: mapa al azar entre los oficiales, escuadras de 3
            const room = this.createRoom(opponent.socketId, opponent.playerName, opponent.userId, { mapId: randomMapId() })
            this.joinRoom(room.id, socketId, playerName, userId)
            return { matched: true, room, p1SocketId: opponent.socketId }
        }

        this.matchmakingQueue.push({ socketId, userId, playerName })
        return { matched: false }
    }

    leaveQueue(socketId: string): boolean {
        const before = this.matchmakingQueue.length
        this.matchmakingQueue = this.matchmakingQueue.filter(p => p.socketId !== socketId)
        return this.matchmakingQueue.length < before
    }

    handleDisconnect(socketId: string, io: Server) {
        this.leaveQueue(socketId)
        const watched = this.spectators.get(socketId)
        if (watched) {
            this.spectators.delete(socketId)
            io.to(watched).emit('SPECTATORS', { count: this.spectatorCount(watched) })
            return
        }
        const room = this.getRoomBySocket(socketId)
        if (!room) return

        this.socketToRoom.delete(socketId)

        const disconnectedPlayer = room.players.find(p => p.socketId === socketId)
        if (!disconnectedPlayer) return

        // Marcar como desconectado sin borrarlo del room
        disconnectedPlayer.socketId = ''

        // Si la sala sólo tenía un jugador o ya terminó, borrar directamente
        if (room.players.length < 2 || room.status === 'finished') {
            if (room.status === 'finished') io.to(room.id).emit('REMATCH_UNAVAILABLE')
            this.cleanupRoom(room.id)
            return
        }

        io.to(room.id).emit('OPPONENT_DISCONNECTED', {
            message: 'El oponente se ha desconectado. Esperando reconexión...'
        })

        this.startAbandonTimer(io, room, disconnectedPlayer)
        this.persist(room)
    }

    // Si el jugador no vuelve a tiempo: en mitad de una partida gana el otro;
    // antes de empezar, la sala se cierra.
    private startAbandonTimer(io: Server, room: Room, disconnectedPlayer: Room['players'][number]) {
        const timerKey = `${room.id}:${disconnectedPlayer.playerId}`
        const timer = setTimeout(() => {
            this.cleanupTimers.delete(timerKey)
            const gs = room.gameState
            if (room.status === 'playing' && gs && gs.phase !== 'finished' && gs.phase !== 'setup') {
                const reason = `${gs.players[disconnectedPlayer.playerId].name} abandona la partida`
                forfeit(gs, disconnectedPlayer.playerId, reason)
                recordForfeit(room.record, disconnectedPlayer.playerId, reason)
                room.status = 'finished'
                const replayId = this.archiveReplay(room)
                io.to(room.id).emit('GAME_OVER', { gameState: gs, winner: gs.winner, reason: gs.winReason ?? '', diceRolls: null, replayId })
            } else {
                io.to(room.id).emit('OPPONENT_ABANDONED', {
                    message: 'El oponente abandonó la partida'
                })
            }
            this.cleanupRoom(room.id)
        }, this.reconnectTimeoutMs)
        this.cleanupTimers.set(timerKey, timer)
    }

    // Solo el mismo usuario autenticado puede recuperar su plaza en la sala.
    reconnect(roomId: string, playerId: 'player1' | 'player2', newSocketId: string, userId: string): Room | null {
        const room = this.rooms.get(roomId)
        if (!room) return null

        const player = room.players.find(p => p.playerId === playerId)
        if (!player || player.userId !== userId) return null

        // Cancelar timer de limpieza
        const timerKey = `${roomId}:${playerId}`
        const timer = this.cleanupTimers.get(timerKey)
        if (timer) {
            clearTimeout(timer)
            this.cleanupTimers.delete(timerKey)
        }

        // Actualizar socket
        if (player.socketId) this.socketToRoom.delete(player.socketId)
        player.socketId = newSocketId
        this.socketToRoom.set(newSocketId, roomId)

        return room
    }

    private cleanupRoom(roomId: string) {
        const room = this.rooms.get(roomId)
        if (!room) return
        const ft = this.finishedTimers.get(roomId)
        if (ft) clearTimeout(ft)
        this.finishedTimers.delete(roomId)
        for (const [sid, rid] of this.spectators) if (rid === roomId) this.spectators.delete(sid)
        for (const p of room.players) {
            if (p.socketId) this.socketToRoom.delete(p.socketId)
        }
        this.rooms.delete(roomId)
        const pending = this.pendingSaves.get(roomId)
        if (pending) clearTimeout(pending)
        this.pendingSaves.delete(roomId)
        this.store?.remove(roomId).catch(e => console.error('[gameStore]', e))
    }

    // ─── ESPECTADORES ─────────────────────────────────────────────────────────
    // Ven la partida en directo (reciben las mismas actualizaciones) pero no
    // pueden actuar: no figuran en socketToRoom, así que GAME_ACTION los rechaza.
    addSpectator(socketId: string, roomId: string): Room | { error: string } {
        const room = this.rooms.get(roomId)
        if (!room) return { error: 'Sala no encontrada' }
        if (!room.gameState || room.gameState.phase === 'setup' || room.status === 'waiting' || room.status === 'squad_selection') return { error: 'La partida aún no ha empezado' }
        if (this.socketToRoom.has(socketId)) return { error: 'Ya estás jugando en una sala' }
        this.spectators.set(socketId, roomId)
        return room
    }

    removeSpectator(socketId: string): string | null {
        const roomId = this.spectators.get(socketId) ?? null
        this.spectators.delete(socketId)
        return roomId
    }

    spectatorCount(roomId: string): number {
        let n = 0
        for (const rid of this.spectators.values()) if (rid === roomId) n++
        return n
    }

    // ─── REVANCHA ─────────────────────────────────────────────────────────────
    // Con la partida terminada, cada jugador la pide; cuando la piden los dos (o
    // uno contra la máquina) la sala vuelve a la selección de escuadra con el
    // mismo mapa y tamaño.
    requestRematch(socketId: string): { room: Room; ready: boolean; playerId: 'player1' | 'player2' } | { error: string } {
        const room = this.getRoomBySocket(socketId)
        const playerId = this.getPlayerIdBySocket(socketId)
        if (!room || !playerId) return { error: 'No estás en una sala' }
        if (room.status !== 'finished') return { error: 'La partida no ha terminado' }
        const other = room.players.find(p => p.playerId !== playerId)
        if (!room.vsBot && !other?.socketId) return { error: 'El rival ya no está en la sala' }
        room.rematch = [...new Set([...(room.rematch ?? []), playerId])]
        const ready = !!room.vsBot || room.rematch.length === 2
        if (ready) {
            const ft = this.finishedTimers.get(room.id)
            if (ft) clearTimeout(ft)
            this.finishedTimers.delete(room.id)
            room.status = 'squad_selection'
            room.gameState = null
            room.record = null
            room.replayId = null
            room.rematch = []
            room.squadSelections = { player1: null, player2: null }
            room.deckSelections = { player1: null, player2: null }
            room.setupConfirmed = { player1: false, player2: false }
            if (room.vsBot) {
                const squad = randomSquad(room.squadSize)
                room.squadSelections.player2 = squad
                room.deckSelections.player2 = randomDeck(squad)
            }
        }
        return { room, ready, playerId }
    }

    // ─── REPETICIONES ─────────────────────────────────────────────────────────
    private replays: ReplayStore | null = null
    useReplayStore(store: ReplayStore | null) { this.replays = store }
    getReplayStore(): ReplayStore | null { return this.replays }

    // Guarda la repetición de una partida recién terminada y devuelve su id.
    // La sala terminada se mantiene 30 min para la revancha.
    archiveReplay(room: Room): string | null {
        const ft = this.finishedTimers.get(room.id)
        if (ft) clearTimeout(ft)
        this.finishedTimers.set(room.id, setTimeout(() => { if (room.status === 'finished') this.cleanupRoom(room.id) }, 30 * 60_000))
        if (room.replayId) return room.replayId
        if (room.mesa) return null      // las partidas de mesa no se guardan como repetición
        const final = room.gameState
        if (!room.record || !final || !this.replays) return null
        const id = Array.from({ length: 12 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[randomInt(32)]).join('')
        room.replayId = id
        const replay = {
            ...room.record,
            summary: summarize(id, room.record, final, room.mapId, !!room.vsBot),
            // En orden de jugador (player1, player2): sirve para saber con qué bando jugó cada uno
            userIds: [...room.players].sort((a, b) => a.playerId.localeCompare(b.playerId)).map(p => p.userId),
        }
        this.replays.save(replay).catch(e => console.error('[replays]', e))
        return id
    }

    // ─── PERSISTENCIA ─────────────────────────────────────────────────────────
    private store: GameStore | null = null
    private pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()

    useStore(store: GameStore | null) { this.store = store }

    // Guarda la sala (agrupando los cambios de 200 ms) si ya hay partida
    persist(room: Room) {
        if (!this.store || !room.gameState || !this.rooms.has(room.id)) return
        if (this.pendingSaves.has(room.id)) return
        this.pendingSaves.set(room.id, setTimeout(() => {
            this.pendingSaves.delete(room.id)
            if (this.rooms.has(room.id)) this.store?.save(room).catch(e => console.error('[gameStore]', e))
        }, 200))
    }

    async persistNow(room: Room) {
        const t = this.pendingSaves.get(room.id)
        if (t) clearTimeout(t)
        this.pendingSaves.delete(room.id)
        if (this.store && room.gameState) await this.store.save(room)
    }

    // Recupera las salas guardadas al arrancar. Todos los jugadores vuelven como
    // desconectados y tienen el plazo normal para reconectarse.
    async restore(io: Server): Promise<number> {
        if (!this.store) return 0
        let n = 0
        for (const room of await this.store.loadAll()) {
            if (!room?.id || this.rooms.has(room.id)) continue
            if (room.status === 'finished' || !room.gameState) { await this.store.remove(room.id); continue }
            for (const p of room.players) p.socketId = ''
            this.rooms.set(room.id, room)
            for (const p of room.players) if (p.userId !== BOT_USER_ID) this.startAbandonTimer(io, room, p)
            n++
        }
        return n
    }
}

export const roomManager = new RoomManager()

// Tirada de iniciativa del modo mesa: la gana el jugador indicado
function mesaInitiative(first: 'player1' | 'player2'): () => number {
    const seq = first === 'player1' ? [10, 1] : [1, 10]
    let i = 0
    return () => seq[i++ % 2]
}
