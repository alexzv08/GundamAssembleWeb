import { Server, Socket } from 'socket.io'
import { RoomManager } from '../rooms/roomManager'
import { applyAction } from '../game/actions'
import { checkGameOver, transitionToPhase2, resolveObjectiveControl } from '../game/victory'
import { getNextActivation } from '../game/timeline'
import { reorderSlotTokens } from '../game/timeline'
import { drawCards } from '../game/effects'

export function registerGameEvents(io: Server, socket: Socket, roomManager: RoomManager) {

    // ── Crear sala ─────────────────────────────────────────────────────────────
    socket.on('CREATE_ROOM', ({ playerName }: { playerName: string }) => {
        const room = roomManager.createRoom(socket.id, playerName)
        socket.join(room.id)
        socket.emit('ROOM_CREATED', { roomId: room.id, playerId: 'player1' })
    })

    // ── Unirse a sala ──────────────────────────────────────────────────────────
    socket.on('JOIN_ROOM', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
        const room = roomManager.joinRoom(roomId, socket.id, playerName)

        if (!room) {
            socket.emit('JOIN_ERROR', { message: 'Sala no encontrada o llena' })
            return
        }

        socket.join(room.id)

        // Iniciar selección de escuadra en vez de arrancar la partida directamente
        for (const player of room.players) {
            io.to(player.socketId).emit('SQUAD_SELECTION_STARTED', {
                playerId: player.playerId,
                faction: player.playerId === 'player1' ? 'Earth Federation' : 'Zeon',
                roomId: room.id,
            })
        }
    })

    // ── Emparejamiento aleatorio ───────────────────────────────────────────────
    socket.on('FIND_MATCH', ({ playerName }: { playerName: string }) => {
        const result = roomManager.joinQueue(socket.id, playerName)

        if (result.matched) {
            const room = result.room
            const p1Socket = io.sockets.sockets.get(result.p1SocketId)
            if (p1Socket) p1Socket.join(room.id)
            socket.join(room.id)

            for (const player of room.players) {
                io.to(player.socketId).emit('SQUAD_SELECTION_STARTED', {
                    playerId: player.playerId,
                    roomId: room.id,
                })
            }
        } else {
            socket.emit('MATCH_SEARCHING')
        }
    })

    socket.on('CANCEL_MATCH', () => {
        roomManager.leaveQueue(socket.id)
        socket.emit('MATCH_CANCELLED')
    })

    // ── Selección de escuadra ──────────────────────────────────────────────────
    socket.on('SELECT_SQUAD', ({ unitCardIds, cardIds }: { unitCardIds: string[]; cardIds: string[] }) => {
        const result = roomManager.submitSquad(socket.id, unitCardIds, cardIds ?? [])
        if (!result) {
            socket.emit('ACTION_ERROR', { message: 'Error al seleccionar escuadra' })
            return
        }

        if (result.ready) {
            const room = result.room
            for (const player of room.players) {
                io.to(player.socketId).emit('GAME_STARTED', {
                    gameState: room.gameState,
                    playerId: player.playerId,
                })
            }
        }
    })

    // ── Reordenar slot de timeline (fase setup) ────────────────────────────────
    socket.on('REORDER_SLOT', ({ slotRound, unitIds }: { slotRound: number; unitIds: string[] }) => {
        const room = roomManager.getRoomBySocket(socket.id)
        const playerId = roomManager.getPlayerIdBySocket(socket.id)
        if (!room || !room.gameState || !playerId) return
        if (room.gameState.phase !== 'setup') return

        room.gameState = {
            ...room.gameState,
            timeline: reorderSlotTokens(room.gameState.timeline, slotRound, playerId, unitIds),
        }

        io.to(room.id).emit('GAME_STATE_UPDATE', {
            gameState: room.gameState,
            action: null,
            actionType: 'REORDER_SLOT',
            diceRolls: null,
        })
    })

    // ── Confirmar setup ────────────────────────────────────────────────────────
    socket.on('CONFIRM_SETUP', () => {
        const result = roomManager.confirmSetup(socket.id)
        if (!result) return

        if (result.bothConfirmed) {
            io.to(result.room.id).emit('GAME_STATE_UPDATE', {
                gameState: result.room.gameState,
                action: null,
                actionType: 'CONFIRM_SETUP',
                diceRolls: null,
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

        if (room.gameState.phase === 'setup') {
            socket.emit('ACTION_ERROR', { message: 'La partida aún está en fase de setup' })
            return
        }

        const isResponseAction = action.type === 'PLAY_RESPONSE' || action.type === 'PASS_RESPONSE'
        if (!isResponseAction && room.gameState.activePlayerId !== playerId) {
            socket.emit('ACTION_ERROR', { message: 'No es tu turno' })
            return
        }

        // Servidor genera dados (d10) para ataques — anti-cheat
        let rolls = diceRolls
        if (action.type === 'ATTACK' || action.type === 'ATTACK_GARRISON') {
            const unit = room.gameState.units[action.unitId]
            const weapon = unit?.weapons[action.weaponIndex ?? 0]
            if (weapon) {
                rolls = Array.from(
                    { length: weapon.strength },
                    () => Math.floor(Math.random() * 10) + 1
                )
            }
        }

        const result = applyAction(room.gameState, action, playerId, rolls)

        if (!result.success) {
            socket.emit('ACTION_ERROR', { message: result.error })
            return
        }

        let gameState = result.newState!

        // ── Transición de fase 1 → fase 2 ──────────────────────────────────────
        if (gameState.phase === 'phase1' && !getNextActivation(gameState.timeline)) {
            gameState = transitionToPhase2(gameState)
            // Robar 3 cartas para cada jugador al inicio de fase 2
            gameState = drawCards(gameState, 'player1', 3)
            gameState = drawCards(gameState, 'player2', 3)

            io.to(room.id).emit('PHASE_TRANSITION', {
                gameState,
                message: 'Inicio de Fase 2 — cada jugador roba 3 cartas',
            })
            room.gameState = gameState
            return
        }

        gameState = resolveObjectiveControl(gameState).newState
        room.gameState = gameState

        // ── Comprobar fin de partida ────────────────────────────────────────────
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

        io.to(room.id).emit('GAME_STATE_UPDATE', {
            gameState: room.gameState,
            action,
            actionType: action.type,
            diceRolls: rolls,
        })
    })

    // ── Reconexión ────────────────────────────────────────────────────────────
    socket.on('RECONNECT', ({ roomId, playerId }: { roomId: string; playerId: 'player1' | 'player2' }) => {
        const room = roomManager.reconnect(roomId, playerId, socket.id)

        if (!room) {
            socket.emit('RECONNECT_FAILED', { message: 'La sala ya no existe o el tiempo de reconexión venció' })
            return
        }

        socket.join(room.id)

        const faction = playerId === 'player1' ? 'Earth Federation' : 'Zeon'
        const squadSubmitted = room.squadSelections[playerId] !== null

        socket.emit('RECONNECT_SUCCESS', {
            playerId,
            roomId,
            roomStatus: room.status,
            gameState: room.gameState ?? undefined,
            faction,
            squadSubmitted,
        })

        const opponent = room.players.find(p => p.playerId !== playerId)
        if (opponent?.socketId) {
            io.to(opponent.socketId).emit('OPPONENT_RECONNECTED', {
                message: 'El oponente ha vuelto a conectarse'
            })
        }
    })
}
