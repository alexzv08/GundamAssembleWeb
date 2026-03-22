import { Server } from 'socket.io'
import { GameState } from '../types/gameState'
import { createServerGame } from '../game/createServerGame'

export interface Room {
    id: string
    players: { socketId: string; playerId: 'player1' | 'player2'; name: string }[]
    gameState: GameState | null
    status: 'waiting' | 'playing' | 'finished'
}

export class RoomManager {
    private rooms = new Map<string, Room>()
    private socketToRoom = new Map<string, string>()

    createRoom(socketId: string, playerName: string): Room {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase()
        const room: Room = {
            id: roomId,
            players: [{ socketId, playerId: 'player1', name: playerName }],
            gameState: null,
            status: 'waiting',
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

        // Iniciar partida
        room.gameState = createServerGame(
            room.players[0].name,
            room.players[1].name
        )
        room.status = 'playing'

        return room
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

        // Notificar al otro jugador
        io.to(room.id).emit('OPPONENT_DISCONNECTED', {
            message: 'El oponente se ha desconectado'
        })

        // Limpiar sala si ambos desconectados
        const anyoneLeft = room.players.some(p =>
            p.socketId !== socketId && this.socketToRoom.has(p.socketId)
        )
        if (!anyoneLeft) {
            this.rooms.delete(room.id)
        }
    }
}

export const roomManager = new RoomManager()