import { Server, Socket } from 'socket.io'
import { RoomManager, type Room } from '../rooms/roomManager'
import { type ProcessResult } from '../game/engine'
import { chooseBotAction, botFallback, actingPlayer, followUpReady } from '../game/bot'
import { reachableFor, checkAttackTargetWith } from '../game/queries'
import { keyToHex } from '../game/hexGrid'
import { reorderSlotTokens } from '../game/timeline'
import type { GameAction, GameState, TurnClock, AttackPreview, AreaAim, PlaySuggestion } from '../types'
import { previewAttack } from '../game/combat'
import { suggestPlays, toSuggestion } from '../game/planner'
import { cloneState, pushLog } from '../game/damage'
import { forfeit } from '../game/victory'
import { recordedAction, recordForfeit, replayFrames, REPLAY_OPTS, type Replay } from '../game/replay'
import { rollD10 } from '../game/combat'

const ACTION_TYPES = new Set<GameAction['type']>([
    'ADVANCE', 'ATTACK', 'DASH', 'ENERGIZE', 'RESCUE', 'ATTACK_GARRISON', 'ATTACK_RWS',
    'PLAY_CARD', 'USE_ABILITY', 'END_ACTIVATION', 'PLAY_RESPONSE', 'PASS_RESPONSE', 'CHOOSE_FORCED_MOVE', 'SET_AUTO_RESPONSES', 'USE_RESPONSE_ABILITY', 'SURRENDER', 'FOLLOW_UP', 'SUBMIT_DICE', 'MESA_DRAW',
])

// Modo mesa: estados anteriores para Deshacer (en memoria, no se guardan con la sala)
const MESA_UNDO_LIMIT = 300
const mesaHistory = new Map<string, GameState[]>()

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
    armClock(io, room)
    persistRoom(room)
    // Dados del ataque recién resuelto (para el popup)
    const diceRolls = gameState.lastAttack !== before.lastAttack ? gameState.lastAttack?.rolls ?? null : null
    if (result.gameOver) {
        room.status = 'finished'
        const replayId = manager?.archiveReplay(room) ?? null
        io.to(room.id).emit('GAME_OVER', { gameState, winner: gameState.winner, reason: gameState.winReason ?? '', diceRolls, replayId })
        return
    }
    if (result.phaseChanged) {
        io.to(room.id).emit('PHASE_TRANSITION', { gameState, message: 'Inicio de la Fase 2 — cada jugador roba 3 cartas' })
        return
    }
    io.to(room.id).emit('GAME_STATE_UPDATE', { gameState, action, actionType: action.type, diceRolls })
}

// Guardado de la sala tras cada cambio (lo conecta registerGameEvents)
let persistRoom: (room: Room) => void = () => {}
let manager: RoomManager | null = null

// ─── RELOJ DE TURNO ──────────────────────────────────────────────────────────
// Que una partida no se quede colgada: cada situación en la que debe actuar un
// humano (su activación, una ventana de Response, elegir un hex de Push/Pull)
// tiene un tiempo. Si se agota, el servidor juega por él lo mínimo (pasar, el
// primer hex, Energize/Advance y terminar). Tres agotamientos seguidos = derrota.
const TURN_SECONDS = Number(process.env.TURN_SECONDS ?? 120)
const RESPONSE_SECONDS = Number(process.env.RESPONSE_SECONDS ?? 30)
const MAX_STRIKES = 3
const clocks = new Map<string, { key: string; deadline: number; seconds: number; timer: ReturnType<typeof setTimeout> }>()
const strikes = new Map<string, number>()   // `${roomId}:${playerId}` → turnos agotados seguidos

function clockKind(s: GameState): TurnClock['kind'] {
    return s.pendingForcedMove || followUpReady(s) ? 'choice' : s.pendingResponse ? 'response' : 'activation'
}

function clockKey(s: GameState): string {
    return [clockKind(s), actingPlayer(s), s.activeUnitId, s.pendingResponse?.trigger ?? '', JSON.stringify(s.pendingForcedMove?.request ?? ''), followUpReady(s) ? 'fu' : ''].join('|')
}

export function stopClock(roomId: string): void {
    const c = clocks.get(roomId)
    if (c) clearTimeout(c.timer)
    clocks.delete(roomId)
}

function armClock(io: Server, room: Room): void {
    const s = room.gameState
    if (!s || s.phase === 'setup' || s.phase === 'finished' || room.status !== 'playing') {
        stopClock(room.id)
        if (s) s.turnClock = null
        return
    }
    const actor = actingPlayer(s)
    const kind = clockKind(s)
    const seconds = kind === 'activation' ? TURN_SECONDS : RESPONSE_SECONDS
    if ((room.vsBot && actor === 'player2') || room.mesa || seconds <= 0) { stopClock(room.id); s.turnClock = null; return }
    const key = clockKey(s)
    const cur = clocks.get(room.id)
    if (cur?.key === key) {
        s.turnClock = { playerId: actor, kind, seconds, remainingMs: Math.max(0, cur.deadline - Date.now()) }
        return
    }
    stopClock(room.id)
    const deadline = Date.now() + seconds * 1000
    const timer = setTimeout(() => onTimeout(io, room, key), seconds * 1000 + 250)
    clocks.set(room.id, { key, deadline, seconds, timer })
    s.turnClock = { playerId: actor, kind, seconds, remainingMs: seconds * 1000 }
}

function onTimeout(io: Server, room: Room, key: string): void {
    const s = room.gameState
    if (!s || s.phase === 'finished' || clockKey(s) !== key) return
    const actor = actingPlayer(s)
    const sk = `${room.id}:${actor}`
    const n = (strikes.get(sk) ?? 0) + 1
    strikes.set(sk, n)
    if (n >= MAX_STRIKES) {
        const end = cloneState(s)
        const reason = `${end.players[actor].name} pierde por agotar el tiempo ${MAX_STRIKES} veces seguidas`
        forfeit(end, actor, reason)
        recordForfeit(room.record, actor, reason)
        publish(io, room, { success: true, state: end, phaseChanged: false, gameOver: true }, { type: 'SURRENDER' })
        return
    }
    // Jugar lo mínimo por el jugador hasta que cambie la situación
    let cur = s
    for (let i = 0; i < 8 && clockKey(cur) === key && cur.phase !== 'finished'; i++) {
        const tries: GameAction[] = [botFallback(cur)]
        if (cur.pendingForcedMove) tries.unshift({ type: 'CHOOSE_FORCED_MOVE', to: cur.pendingForcedMove.request.options[0] ?? null })
        if (cur.activeUnitId && !cur.pendingResponse && !cur.pendingForcedMove) {
            const reach = [...reachableFor(cur, cur.activeUnitId, { kind: 'advance' }).keys()]
            if (reach.length && !cur.activation?.advanced) tries.push({ type: 'ADVANCE', unitId: cur.activeUnitId, to: keyToHex(reach[0]) })
        }
        let done = false
        for (const action of tries) {
            const r = recordedAction(room.record, cur, action, actor)
            if (r.success && r.state) {
                if (i === 0) pushLog(r.state, actor, `Tiempo agotado: ${r.state.players[actor].name} pasa automáticamente`, 'end')
                publish(io, room, r, action)
                cur = room.gameState!
                done = true
                break
            }
        }
        if (!done) break
    }
    driveBot(io, room)
}

// Si le toca al bot (actuar o responder), juega una acción tras una pausa
// corta para que el humano vea lo que pasa, y repite mientras siga siendo su turno.
// En partida real, quien empuja o atrae elige cada hex (Q&A 7): recordedAction usa REPLAY_OPTS
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 700)
function driveBot(io: Server, room: Room): void {
    const s = room.gameState
    if (!room.vsBot || !s || s.phase === 'setup' || s.phase === 'finished' || room.status !== 'playing') return
    if (actingPlayer(s) !== 'player2') return
    setTimeout(() => {
        const cur = room.gameState
        if (!cur || cur !== s) return   // el estado cambió mientras esperaba
        let action = chooseBotAction(cur, 'player2', Math.random, room.botLevel ?? 'normal')
        let result = recordedAction(room.record, cur, action, 'player2')
        if (!result.success) {
            action = botFallback(cur)
            result = recordedAction(room.record, cur, action, 'player2')
        }
        if (!result.success && cur.activeUnitId && !cur.pendingResponse && !cur.pendingForcedMove && !followUpReady(cur)) {
            const reach = [...reachableFor(cur, cur.activeUnitId, { kind: 'advance' }).keys()]
            if (reach.length) {
                action = { type: 'ADVANCE', unitId: cur.activeUnitId, to: keyToHex(reach[0]) }
                result = recordedAction(room.record, cur, action, 'player2')
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

// Repeticiones reconstruidas hace poco (las 10 últimas en memoria)
const frameCache = new Map<string, { summary: Replay['summary']; frames: GameState[] }>()
async function loadFrames(rm: RoomManager, id: string) {
    const hit = frameCache.get(id)
    if (hit) { frameCache.delete(id); frameCache.set(id, hit); return hit }
    const replay = await rm.getReplayStore()?.load(id)
    if (!replay) return null
    const entry = { summary: replay.summary, frames: replayFrames(replay) }
    frameCache.set(id, entry)
    while (frameCache.size > 10) frameCache.delete(frameCache.keys().next().value!)
    return entry
}

export function registerGameEvents(io: Server, socket: Socket, roomManager: RoomManager) {
    persistRoom = room => roomManager.persist(room)
    manager = roomManager
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
    socket.on('PLAY_BOT', ({ playerName, mapId, squadSize, level }: { playerName?: string; mapId?: string; squadSize?: number; level?: string } = {}) => {
        const room = roomManager.createBotRoom(socket.id, cleanName(playerName, defaultName), userId, { mapId, squadSize, botLevel: level })
        socket.join(room.id)
        socket.emit('SQUAD_SELECTION_STARTED', { playerId: 'player1', roomId: room.id, mapId: room.mapId, squadSize: room.squadSize, vsBot: true })
    })

    // ── Modo mesa: partida real apuntada en la app ─────────────────────────────
    socket.on('CREATE_MESA', ({ playerName, rivalName, mapId, squadSize }: { playerName?: string; rivalName?: string; mapId?: string; squadSize?: number } = {}) => {
        // Desactivado por ahora: solo con MESA_ENABLED=1 (pruebas y desarrollo)
        if (process.env.MESA_ENABLED !== '1') return socket.emit('ACTION_ERROR', { message: 'El modo mesa no está disponible por ahora' })
        for (const id of mesaHistory.keys()) if (!roomManager.getRoom(id)) mesaHistory.delete(id)   // salas ya cerradas
        const room = roomManager.createMesaRoom(socket.id, cleanName(playerName, defaultName), userId, { mapId, squadSize, rivalName })
        socket.join(room.id)
        socket.emit('SQUAD_SELECTION_STARTED', { playerId: 'player1', roomId: room.id, mapId: room.mapId, squadSize: room.squadSize, mesa: true })
    })

    socket.on('MESA_RIVAL', ({ unitCardIds, first }: { unitCardIds?: string[]; first?: string } = {}) => {
        const result = roomManager.submitMesaRival(socket.id, Array.isArray(unitCardIds) ? unitCardIds : [], first)
        if ('error' in result) return socket.emit('ACTION_ERROR', { message: result.error })
        socket.emit('MESA_RIVAL_ACCEPTED')
    })

    socket.on('MESA_UNDO', () => {
        const room = roomManager.getRoomBySocket(socket.id)
        const prev = room?.mesa ? mesaHistory.get(room.id)?.pop() : null
        if (!room || !prev) return socket.emit('ACTION_ERROR', { message: 'No hay nada que deshacer' })
        room.gameState = prev
        room.status = 'playing'
        persistRoom(room)
        io.to(room.id).emit('GAME_STATE_UPDATE', { gameState: prev, action: null, actionType: 'UNDO' })
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
            armClock(io, result.room)
            roomManager.persist(result.room)
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

        // Modo mesa: el jugador lleva los dos bandos (actúa quien deba decidir ahora)
        // y los dados son los de la mesa real
        const actor = room.mesa ? (action.type === 'SURRENDER' || action.type === 'MESA_DRAW' ? playerId : actingPlayer(room.gameState)) : playerId
        const before = room.gameState
        const result = room.mesa
            ? recordedAction(room.record, before, action, actor, rollD10, { ...REPLAY_OPTS, manualDice: true })
            : recordedAction(room.record, before, action, actor)
        if (!result.success || !result.state) {
            socket.emit('ACTION_ERROR', { message: result.error })
            return
        }
        if (room.mesa) {
            const h = mesaHistory.get(room.id) ?? []
            h.push(before)
            if (h.length > MESA_UNDO_LIMIT) h.shift()
            mesaHistory.set(room.id, h)
        }
        strikes.delete(`${room.id}:${playerId}`)
        publish(io, room, result, action)
        driveBot(io, room)
    })

    // ── Previsión de ataque (solo lectura) ──────────────────────────────────────
    // El jugador activo pregunta qué puede esperar de un ataque antes de confirmarlo.
    socket.on('PREVIEW_ATTACK', (req: { unitId?: string; weaponIndex?: number; cardId?: string; targetKey?: string; aim?: AreaAim } = {}, ack?: (p: AttackPreview | null) => void) => {
        if (typeof ack !== 'function') return
        const room = roomManager.getRoomBySocket(socket.id)
        const playerId = roomManager.getPlayerIdBySocket(socket.id)
        const s = room?.gameState
        const unit = s && typeof req.unitId === 'string' ? s.units[req.unitId] : null
        if (!s || !unit || unit.playerId !== playerId || typeof req.targetKey !== 'string' || !s.board[req.targetKey]) return ack(null)
        const weapon = typeof req.cardId === 'string'
            ? s.players[unit.playerId].tactics.hand.find(c => c.id === req.cardId)?.weapon
            : unit.weapons[Number(req.weaponIndex)]
        if (!weapon) return ack(null)
        const aim = req.aim && typeof req.aim === 'object' ? req.aim : undefined
        if (aim && !checkAttackTargetWith(s, unit.id, weapon, req.targetKey, aim).ok) return ack(null)
        ack(previewAttack(s, unit.id, weapon, req.targetKey, aim))
    })

    // ── Consejero: las mejores jugadas para la unidad activa (solo contra el bot) ──
    socket.on('SUGGEST_PLAYS', (_req: unknown, ack?: (r: { plays: PlaySuggestion[]; error?: string }) => void) => {
        if (typeof ack !== 'function') return
        const room = roomManager.getRoomBySocket(socket.id)
        const playerId = roomManager.getPlayerIdBySocket(socket.id)
        const s = room?.gameState
        if (!s || !playerId) return ack({ plays: [], error: 'No estás en una partida' })
        if (!room!.vsBot && !room!.mesa) return ack({ plays: [], error: 'El consejero solo está en las partidas contra la máquina y en el modo mesa' })
        // En el modo mesa también para el rival: lo que más daño puede hacerte
        const side = room!.mesa ? s.activePlayerId : playerId
        if (s.activePlayerId !== side || s.pendingAttack || s.pendingResponse || s.pendingForcedMove || s.pendingFollowUp || s.pendingDice) return ack({ plays: [], error: 'Ahora no es tu activación' })
        ack({ plays: suggestPlays(s, side, 3).map(p => toSuggestion(s, p)) })
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

    // ── Revancha ───────────────────────────────────────────────────────────────
    socket.on('REMATCH', () => {
        const r = roomManager.requestRematch(socket.id)
        if ('error' in r) { socket.emit('ACTION_ERROR', { message: r.error }); return }
        if (!r.ready) {
            io.to(r.room.id).emit('REMATCH_REQUESTED', { playerId: r.playerId })
            return
        }
        for (const player of r.room.players) {
            if (player.socketId) io.to(player.socketId).emit('SQUAD_SELECTION_STARTED', { playerId: player.playerId, roomId: r.room.id, mapId: r.room.mapId, squadSize: r.room.squadSize, vsBot: !!r.room.vsBot })
        }
        io.to(r.room.id).emit('SPECTATE_ENDED', { message: 'Los jugadores empiezan la revancha' })
    })

    // ── Espectadores ───────────────────────────────────────────────────────────
    socket.on('SPECTATE', ({ roomId }: { roomId?: string } = {}) => {
        const r = roomManager.addSpectator(socket.id, String(roomId ?? '').toUpperCase())
        if ('error' in r) { socket.emit('SPECTATE_ERROR', { message: r.error }); return }
        socket.join(r.id)
        socket.emit('SPECTATE_STARTED', { roomId: r.id, gameState: r.gameState, replayId: r.replayId ?? null })
        io.to(r.id).emit('SPECTATORS', { count: roomManager.spectatorCount(r.id) })
    })

    socket.on('STOP_SPECTATING', () => {
        const roomId = roomManager.removeSpectator(socket.id)
        if (!roomId) return
        socket.leave(roomId)
        io.to(roomId).emit('SPECTATORS', { count: roomManager.spectatorCount(roomId) })
    })

    // ── Repeticiones ───────────────────────────────────────────────────────────
    // Se reconstruyen en el servidor con el motor y se piden fotograma a fotograma.
    socket.on('REPLAY_LIST', async (_: unknown, ack?: (list: unknown[]) => void) => {
        if (typeof ack !== 'function') return
        ack(await roomManager.getReplayStore()?.listFor(userId) ?? [])
    })

    socket.on('REPLAY_OPEN', async ({ id }: { id?: string } = {}, ack?: (r: { summary: Replay['summary']; frames: number } | null) => void) => {
        if (typeof ack !== 'function') return
        const frames = await loadFrames(roomManager, String(id ?? ''))
        ack(frames ? { summary: frames.summary, frames: frames.frames.length } : null)
    })

    socket.on('REPLAY_FRAME', async ({ id, index }: { id?: string; index?: number } = {}, ack?: (s: GameState | null) => void) => {
        if (typeof ack !== 'function') return
        const frames = await loadFrames(roomManager, String(id ?? ''))
        ack(frames?.frames[Math.max(0, Math.min(frames.frames.length - 1, Number(index) || 0))] ?? null)
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
        armClock(io, room)
        socket.emit('RECONNECT_SUCCESS', {
            playerId,
            roomId: room.id,
            roomStatus: room.status,
            gameState: room.gameState ?? undefined,
            squadSubmitted: room.squadSelections[playerId] !== null,
            mapId: room.mapId,
            squadSize: room.squadSize,
            replayId: room.replayId ?? null,
        })
        driveBot(io, room)
        const opponent = room.players.find(p => p.playerId !== playerId)
        if (opponent?.socketId) {
            io.to(opponent.socketId).emit('OPPONENT_RECONNECTED', { message: 'El oponente ha vuelto a conectarse' })
        }
    })
}
