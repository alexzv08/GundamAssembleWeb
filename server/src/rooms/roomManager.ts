import { Server } from 'socket.io'
import { GameState } from '../types/gameState'
import { randomInt } from 'crypto'
import { startGame } from '../game/activation'
import { createServerGame } from '../game/createServerGame'
import { loadUnitCatalog, loadTacticsCatalog, validateSquad, validateDeck } from '../game/catalog'
import { mapExists, randomMapId } from '../game/maps'
import { randomSquad, randomDeck } from '../game/bot'

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
}

export const BOT_USER_ID = 'bot'

export interface RoomOptions { mapId?: string; squadSize?: number }

export class RoomManager {
    private rooms = new Map<string, Room>()
    private socketToRoom = new Map<string, string>()
    private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
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
        const squad = randomSquad(room.squadSize)
        room.squadSelections.player2 = squad
        room.deckSelections.player2 = randomDeck(squad)
        return room
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
                { mapId: room.mapId },
            )
            room.status = 'playing'
        }

        return { room, ready }
    }

    confirmSetup(socketId: string): { room: Room; bothConfirmed: boolean } | null {
        const room = this.getRoomBySocket(socketId)
        const playerId = this.getPlayerIdBySocket(socketId)
        if (!room || !playerId || !room.gameState || room.gameState.phase !== 'setup') return null

        room.setupConfirmed[playerId] = true
        if (room.vsBot) room.setupConfirmed.player2 = true   // el bot confirma siempre
        const bothConfirmed = room.setupConfirmed.player1 && room.setupConfirmed.player2

        if (bothConfirmed) {
            room.gameState = startGame(structuredClone(room.gameState))
            room.setupConfirmed = { player1: false, player2: false }
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
        const room = this.getRoomBySocket(socketId)
        if (!room) return

        this.socketToRoom.delete(socketId)

        const disconnectedPlayer = room.players.find(p => p.socketId === socketId)
        if (!disconnectedPlayer) return

        // Marcar como desconectado sin borrarlo del room
        disconnectedPlayer.socketId = ''

        // Si la sala sólo tenía un jugador o ya terminó, borrar directamente
        if (room.players.length < 2 || room.status === 'finished') {
            this.cleanupRoom(room.id)
            return
        }

        io.to(room.id).emit('OPPONENT_DISCONNECTED', {
            message: 'El oponente se ha desconectado. Esperando reconexión...'
        })

        // Timer de limpieza: si no reconecta en 5 min, destruir la sala
        const timerKey = `${room.id}:${disconnectedPlayer.playerId}`
        const timer = setTimeout(() => {
            this.cleanupTimers.delete(timerKey)
            this.cleanupRoom(room.id)
            io.to(room.id).emit('OPPONENT_ABANDONED', {
                message: 'El oponente abandonó la partida'
            })
        }, RECONNECT_TIMEOUT_MS)
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
        for (const p of room.players) {
            if (p.socketId) this.socketToRoom.delete(p.socketId)
        }
        this.rooms.delete(roomId)
    }
}

export const roomManager = new RoomManager()
