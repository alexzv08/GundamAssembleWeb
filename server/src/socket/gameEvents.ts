import { Server, Socket } from 'socket.io'
import { RoomManager } from '../rooms/roomManager'
import { applyAction } from '../game/actions'
import { checkGameOver } from '../game/victory'

export function registerGameEvents(io: Server, socket: Socket, roomManager: RoomManager) {

    // ── Crear sala ─────────────────────────────────────────────────────────────
    socket.on('CREATE_ROOM', ({ playerName }: { playerName: string }) => {
        const room = roomManager.createRoom(socket.id, playerName)
        socket.join(room.id)
        socket.emit('ROOM_CREATED', { roomId: room.id, playerId: 'player1' })
        console.log(`Sala creada: ${room.id} por ${playerName}`)
    })

    // ── Unirse a sala ──────────────────────────────────────────────────────────
    socket.on('JOIN_ROOM', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
        const room = roomManager.joinRoom(roomId, socket.id, playerName)

        if (!room) {
            socket.emit('JOIN_ERROR', { message: 'Sala no encontrada o llena' })
            return
        }

        socket.join(room.id)

        // Enviar a cada jugador su propio playerId
        for (const player of room.players) {
            io.to(player.socketId).emit('GAME_STARTED', {
                gameState: room.gameState,
                playerId: player.playerId,
            })
        }
    })

    // ── Acción de juego ────────────────────────────────────────────────────────
    socket.on('GAME_ACTION', ({ action, diceRolls }: { action: any; diceRolls?: number[] }) => {
        const room = roomManager.getRoomBySocket(socket.id)
        const playerId = roomManager.getPlayerIdBySocket(socket.id)

        if (!room || !room.gameState || !playerId) {
            socket.emit('ACTION_ERROR', { message: 'No estás en una partida' })
            return
        }

        if (room.gameState.activePlayerId !== playerId) {
            socket.emit('ACTION_ERROR', { message: 'No es tu turno' })
            return
        }

        // El servidor genera los dados para ataques (anti-cheat)
        let rolls = diceRolls
        if (action.type === 'ATTACK') {
            const unit = room.gameState.units[action.unitId]
            const weapon = unit?.weapons[action.weaponIndex ?? 0]
            if (weapon) {
                rolls = Array.from(
                    { length: weapon.strength },
                    () => Math.floor(Math.random() * 10) + 1
                )
            }
        }


        console.log('ACTION:', JSON.stringify(action))
        console.log('PLAYER:', playerId)
        const result = applyAction(room.gameState, action, playerId, rolls)

        if (!result.success) {
            socket.emit('ACTION_ERROR', { message: result.error })
            return
        }

        room.gameState = result.newState!

        // Comprobar fin de partida
        const gameOver = checkGameOver(room.gameState)
        if (gameOver.isOver) {
            room.gameState.phase = 'finished'
            room.gameState.winner = gameOver.winner
            room.status = 'finished'
            io.to(room.id).emit('GAME_OVER', {
                gameState: room.gameState,
                winner: gameOver.winner,
                reason: gameOver.reason,
                diceRolls: rolls,
            })
            return
        }

        // Emitir nuevo estado a ambos jugadores
        io.to(room.id).emit('GAME_STATE_UPDATE', {
            gameState: room.gameState,
            action,
            actionType: action.type,
            diceRolls: rolls,
        })
    })
}