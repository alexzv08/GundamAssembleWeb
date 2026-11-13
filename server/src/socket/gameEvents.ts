import { Server, Socket } from 'socket.io'
import { RoomManager, type Room } from '../rooms/roomManager'
import { processAction, type ProcessResult } from '../game/engine'
import { chooseBotAction, botFallback, actingPlayer } from '../game/bot'
import { reachableFor } from '../game/queries'
import { keyToHex } from '../game/hexGrid'
import { reorderSlotTokens } from '../game/timeline'
import type { GameAction } from '../types'

const ACTION_TYPES = new Set<GameAction['type']>([
    'ADVANCE', 'ATTACK', 'DASH', 'ENERGIZE', 'RESCUE', 'ATTACK_GARRISON', 'ATTACK_RWS',
    'PLAY_CARD', 'USE_ABILITY', 'END_ACTIVATION', 'PLAY_RESPONSE', 'PASS_RESPONSE', 'SET_AUTO_RESPONSES', 'USE_RESPONSE_ABILITY',
])

function isGameAction(value: unknown): value is GameAction {
    return typeof value === 'object' && value !== null && ACTION_TYPES.has((value as { type: GameAction['type'] }).type)
}

function cleanName(name: unknown, fallback: string): string {
    const s = typeof name === 'string' ? name.trim().slice(0, 32) : ''
    return s || fallback
}

// Envía a la sala el resultado de una acción y actualiza su estado.
function publish(io: Server, room: Room, result: ProcessResult, action: GameAction): void {
    const before = room.gameState!
    const gameState = result.state!
    room.gameState = gameState
    // Dados del ataque recién resuelto (para el popup)
    const diceRolls = gameState.lastAttack !== before.lastAttack ? gameState.lastAttack?.rolls ?? null : null
    if (result.gameOver) {
        room.status = 'finished'
        io.to(room.id).emit('GAME_OVER', { gameState, winner: gameState.winner, reason: gameState.winReason ?? '', diceRolls })
        return
    }
    if (result.phaseChanged) {
        io.to(room.id).emit('PHASE_TRANSITION', { gameState, message: 'Inicio de la Fase 2 — cada jugador roba 3 cartas' })
        return
    }
    io.to(room.id).emit('GAME_STATE_UPDATE', { gameState, action, actionType: action.type, diceRolls })
}

// Si le toca al bot (actuar o responder), juega una acción tras una pausa
// corta para que el humano vea lo que pasa, y repite mientras siga siendo su turno.
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 700)
function driveBot(io: Server, room: Room): void {
    const s = room.gameState
    if (!room.vsBot || !s || s.phase === 'setup' || s.phase === 'finished' || room.status !== 'playing') return
    if (actingPlayer(s) !== 'player2') return
    setTimeout(() => {
        const cur = room.gameState
        if (!cur || cur !== s) return   // el estado cambió mientras esperaba
        let action = chooseBotAction(cur, 'player2')
        let result = processAction(cur, action, 'player2')
        if (!result.success) {
            action = botFallback(cur)
            result = processAction(cur, action, 'player2')
        }
        if (!result.success && cur.activeUnitId && !cur.pendingResponse) {
            const reach = [...reachableFor(cur, cur.activeUnitId, { kind: 'advance' }).keys()]
            if (reach.length) {
                action = { type: 'ADVANCE', unitId: cur.activeUnitId, to: keyToHex(reach[0]) }
                result = processAction(cur, action, 'player2')
            }
        }
        if (!result.success || !result.state) {
            console.error('[bot] sin acción válida:', result.error)
            return
        }
        publish(io, room, result, action)
        driveBot(io, room)
    }, BOT_DELAY_MS)
}

export function registerGameEvents(io: Server, socket: Socket, roomManager: RoomManager) {
    const userId = socket.data.userId as string
    const defaultName = (socket.data.userName as string) ?? 'Jugador'

    // ── Crear sala ─────────────────────────────────────────────────────────────
    socket.on('CREATE_ROOM', ({ playerName, mapId, squadSize }: { playerName?: string; mapId?: string; squadSize?: number } = {}) => {
        const room = roomManager.createRoom(socket.id, cleanName(playerName, defaultName), userId, { mapId, squadSize })
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
            io.to(player.socketId).emit('SQUAD_SELECTION_STARTED', { playerId: player.playerId, roomId: room.id, mapId: room.mapId, squadSize: room.squadSize })
        }
    })

    // ── Partida contra la máquina ──────────────────────────────────────────────
    socket.on('PLAY_BOT', ({ playerName, mapId, squadSize }: { playerName?: string; mapId?: string; squadSize?: number } = {}) => {
        const room = roomManager.createBotRoom(socket.id, cleanName(playerName, defaultName), userId, { mapId, squadSize })
        socket.join(room.id)
        socket.emit('SQUAD_SELECTION_STARTED', { playerId: 'player1', roomId: room.id, mapId: room.mapId, squadSize: room.squadSize, vsBot: true })
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
            io.to(player.socketId).emit('SQUAD_SELECTION_STARTED', { playerId: player.playerId, roomId: room.id, mapId: room.mapId, squadSize: room.squadSize })
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
                if (player.socketId) io.to(player.socketId).emit('GAME_STARTED', { gameState: result.room.gameState, playerId: player.playerId })
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
            driveBot(io, result.room)
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

        const result = processAction(room.gameState, action, playerId)
        if (!result.success || !result.state) {
            socket.emit('ACTION_ERROR', { message: result.error })
            return
        }
        publish(io, room, result, action)
        driveBot(io, room)
    })

    // ── Chat de la sala ────────────────────────────────────────────────────────
    // Texto plano, como mucho 200 caracteres y un mensaje por segundo.
    let lastChat = 0
    socket.on('CHAT', ({ text }: { text?: unknown } = {}) => {
        const room = roomManager.getRoomBySocket(socket.id)
        const playerId = roomManager.getPlayerIdBySocket(socket.id)
        const clean = typeof text === 'string' ? text.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) : ''
        const now = Date.now()
        if (!room || !playerId || !clean || now - lastChat < 1000) return
        lastChat = now
        const name = room.players.find(p => p.playerId === playerId)?.name ?? 'Jugador'
        io.to(room.id).emit('CHAT_MESSAGE', { playerId, name, text: clean, at: now })
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
            mapId: room.mapId,
            squadSize: room.squadSize,
        })
        driveBot(io, room)
        const opponent = room.players.find(p => p.playerId !== playerId)
        if (opponent?.socketId) {
            io.to(opponent.socketId).emit('OPPONENT_RECONNECTED', { message: 'El oponente ha vuelto a conectarse' })
        }
    })
}
