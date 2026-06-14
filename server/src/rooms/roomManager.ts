import { Server } from 'socket.io'
import { GameState } from '../types/gameState'
import { createServerGame } from '../game/createServerGame'

const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutos

export interface Room {
    id: string
    players: { socketId: string; playerId: 'player1' | 'player2'; name: string }[]
    gameState: GameState | null
    status: 'waiting' | 'squad_selection' | 'playing' | 'finished'
    squadSelections: { player1: string[] | null; player2: string[] | null }
    deckSelections: { player1: string[] | null; player2: string[] | null }
    setupConfirmed: { player1: boolean; player2: boolean }
}

export class RoomManager {
    private rooms = new Map<string, Room>()
    private socketToRoom = new Map<string, string>()
    private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

    createRoom(socketId: string, playerName: string): Room {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase()
        const room: Room = {
            id: roomId,
            players: [{ socketId, playerId: 'player1', name: playerName }],
            gameState: null,
            status: 'waiting',
            squadSelections: { player1: null, player2: null },
            deckSelections: { player1: null, player2: null },
            setupConfirmed: { player1: false, player2: false },
        }
        this.rooms.set(roomId, room)
        this.socketToRoom.set(socketId, roomId)
        return room
    }

    joinRoom(roomId: string, socketId: string, playerName: string): Room | null {
        const room = this.rooms.get(roomId)
        if (!room || room.players.length >= 2 || room.status !== 'waiting') return null

        room.players.push({ socketId, playerId: 'player2', name: playerName })
        this.socketToRoom.set(socketId, roomId)
        room.status = 'squad_selection'
        room.squadSelections = { player1: null, player2: null }
        room.deckSelections = { player1: null, player2: null }
        room.setupConfirmed = { player1: false, player2: false }

        return room
    }

    submitSquad(socketId: string, unitCardIds: string[], cardIds: string[]): { room: Room; ready: boolean } | null {
        const room = this.getRoomBySocket(socketId)
        const playerId = this.getPlayerIdBySocket(socketId)
        if (!room || !playerId || room.status !== 'squad_selection') return null

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
        const bothConfirmed = room.setupConfirmed.player1 && room.setupConfirmed.player2

        if (bothConfirmed) {
            room.gameState.phase = 'phase1'
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

    handleDisconnect(socketId: string, io: Server) {
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

    reconnect(roomId: string, playerId: 'player1' | 'player2', newSocketId: string): Room | null {
        const room = this.rooms.get(roomId)
        if (!room) return null

        const player = room.players.find(p => p.playerId === playerId)
        if (!player) return null

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
