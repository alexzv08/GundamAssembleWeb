import { Server, Socket } from 'socket.io'
import { RoomManager } from '../rooms/roomManager'
import { processAction } from '../game/engine'
import { reorderSlotTokens } from '../game/timeline'
import type { GameAction } from '../types'

const ACTION_TYPES = new Set<GameAction['type']>([
    'ADVANCE', 'ATTACK', 'DASH', 'ENERGIZE', 'RESCUE', 'ATTACK_GARRISON',
    'PLAY_CARD', 'USE_ABILITY', 'END_ACTIVATION', 'PLAY_RESPONSE', 'PASS_RESPONSE',
])

function isGameAction(value: unknown): value is GameAction {
    return typeof value === 'object' && value !== null && ACTION_TYPES.has((value as { type: GameAction['type'] }).type)
}

function cleanName(name: unknown, fallback: string): string {
    const s = typeof name === 'string' ? name.trim().slice(0, 32) : ''
    return s || fallback
}

export function registerGameEvents(io: Server, socket: Socket, roomManager: RoomManager) {
    const userId = socket.data.userId as string
    const defaultName = (socket.data.userName as string) ?? 'Jugador'

    // ── Crear sala ─────────────────────────────────────────────────────────────
    socket.on('CREATE_ROOM', ({ playerName }: { playerName?: string } = {}) => {
        const room = roomManager.createRoom(socket.id, cleanName(playerName, defaultName), userId)
        socket.join(room.id)
        socket.emit('ROOM_CREATED', { roomId: room.id, playerId: 'player1' })
    })

    // ── Unirse a sala ──────────────────────────────────────────────────────────
    socket.on('JOIN_ROOM', ({ roomId, playerName }: { roomId?: string; playerName?: string } = {}) => {
        const room = roomManager.joinRoom(String(roomId ?? '').toUpperCase(), socket.id, cleanName(playerName, defaultName), userId)
        if (!room) {
            socket.emit('JOIN_ERROR', { message: 'Sala no encontrada, llena o ya estás dentro' })
            return
        }
        socket.join(room.id)
        for (const player of room.players) {
            io.to(player.socketId).emit('SQUAD_SELECTION_STARTED', { playerId: player.playerId, roomId: room.id })
        }
    })

    // ── Emparejamiento aleatorio ───────────────────────────────────────────────
    socket.on('FIND_MATCH', ({ playerName }: { playerName?: string } = {}) => {
        const result = roomManager.joinQueue(socket.id, cleanName(playerName, defaultName), userId)
        if (!result.matched) {
            socket.emit('MATCH_SEARCHING')
            return
        }
        const room = result.room
        io.sockets.sockets.get(result.p1SocketId)?.join(room.id)
        socket.join(room.id)
        for (const player of room.players) {
            io.to(player.socketId).emit('SQUAD_SELECTION_STARTED', { playerId: player.playerId, roomId: room.id })
        }
    })

    socket.on('CANCEL_MATCH', () => {
        roomManager.leaveQueue(socket.id)
        socket.emit('MATCH_CANCELLED')
    })

    // ── Selección de escuadra y mazo (validadas en el servidor) ───────────────
    socket.on('SELECT_SQUAD', ({ unitCardIds, cardIds }: { unitCardIds?: string[]; cardIds?: string[] } = {}) => {
        const result = roomManager.submitSquad(socket.id, unitCardIds ?? [], cardIds ?? [])
        if ('error' in result) {
            socket.emit('ACTION_ERROR', { message: result.error })
            return
        }
        socket.emit('SQUAD_ACCEPTED')
        if (result.ready) {
            for (const player of result.room.players) {
                io.to(player.socketId).emit('GAME_STARTED', { gameState: result.room.gameState, playerId: player.playerId })
            }
        }
    })

    // ── Reordenar fichas propias en un slot del Timeline (setup) ───────────────
    socket.on('REORDER_SLOT', ({ slotRound, unitIds }: { slotRound: number; unitIds: string[] }) => {
        const room = roomManager.getRoomBySocket(socket.id)
        const playerId = roomManager.getPlayerIdBySocket(socket.id)
        if (!room?.gameState || !playerId || room.gameState.phase !== 'setup') return
        if (!Array.isArray(unitIds)) return

        room.gameState = {
            ...room.gameState,
            timeline: reorderSlotTokens(room.gameState.timeline, Number(slotRound), playerId, unitIds),
        }
        io.to(room.id).emit('GAME_STATE_UPDATE', { gameState: room.gameState, action: null, actionType: 'REORDER_SLOT' })
    })

    // ── Confirmar setup ────────────────────────────────────────────────────────
    socket.on('CONFIRM_SETUP', () => {
        const result = roomManager.confirmSetup(socket.id)
        if (result?.bothConfirmed) {
            io.to(result.room.id).emit('GAME_STATE_UPDATE', {
                gameState: result.room.gameState, action: null, actionType: 'CONFIRM_SETUP',
            })
        }
    })

    // ── Acción de juego ────────────────────────────────────────────────────────
    // El motor valida turno y reglas y tira los dados en el servidor.
    socket.on('GAME_ACTION', ({ action }: { action?: unknown } = {}) => {
        const room = roomManager.getRoomBySocket(socket.id)
        const playerId = roomManager.getPlayerIdBySocket(socket.id)
        if (!room?.gameState || !playerId) {
            socket.emit('ACTION_ERROR', { message: 'No estás en una partida' })
            return
        }
        if (!isGameAction(action)) {
            socket.emit('ACTION_ERROR', { message: 'Acción no válida' })
            return
        }

        const before = room.gameState
        const result = processAction(before, action, playerId)
        if (!result.success || !result.state) {
            socket.emit('ACTION_ERROR', { message: result.error })
            return
        }
        const gameState = result.state
        room.gameState = gameState

        // Dados del ataque recién resuelto (para el popup)
        const diceRolls = gameState.lastAttack !== before.lastAttack ? gameState.lastAttack?.rolls ?? null : null

        if (result.gameOver) {
            room.status = 'finished'
            io.to(room.id).emit('GAME_OVER', {
                gameState, winner: gameState.winner, reason: gameState.winReason ?? '', diceRolls,
            })
            return
        }
        if (result.phaseChanged) {
            io.to(room.id).emit('PHASE_TRANSITION', { gameState, message: 'Inicio de la Fase 2 — cada jugador roba 3 cartas' })
            return
        }
        io.to(room.id).emit('GAME_STATE_UPDATE', { gameState, action, actionType: action.type, diceRolls })
    })

    // ── Reconexión ────────────────────────────────────────────────────────────
    socket.on('RECONNECT', ({ roomId, playerId }: { roomId?: string; playerId?: 'player1' | 'player2' } = {}) => {
        if (playerId !== 'player1' && playerId !== 'player2') return
        const room = roomManager.reconnect(String(roomId ?? ''), playerId, socket.id, userId)
        if (!room) {
            socket.emit('RECONNECT_FAILED', { message: 'La sala ya no existe o el tiempo de reconexión venció' })
            return
        }
        socket.join(room.id)
        socket.emit('RECONNECT_SUCCESS', {
            playerId,
            roomId: room.id,
            roomStatus: room.status,
            gameState: room.gameState ?? undefined,
            squadSubmitted: room.squadSelections[playerId] !== null,
        })
        const opponent = room.players.find(p => p.playerId !== playerId)
        if (opponent?.socketId) {
            io.to(opponent.socketId).emit('OPPONENT_RECONNECTED', { message: 'El oponente ha vuelto a conectarse' })
        }
    })
}
