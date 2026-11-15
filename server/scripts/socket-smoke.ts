/**
 * socket-smoke.ts — prueba de humo de la capa Socket.IO sin Supabase.
 * Levanta el servidor de sockets con una autenticación falsa (userId en el
 * handshake), conecta dos clientes y juega hasta el final con acciones simples.
 *
 * Uso: cd server && npx tsx scripts/socket-smoke.ts
 * (necesita socket.io-client, que está en client/node_modules)
 */
import { createServer } from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { RoomManager } from '../src/rooms/roomManager'
import { MemoryReplayStore } from '../src/rooms/gameStore'
import { registerGameEvents } from '../src/socket/gameEvents'
import { reachableFor } from '../src/game/queries'
import { keyToHex } from '../src/game/hexGrid'
import type { GameState } from '../src/types'
import { loadUnitCatalog, loadTacticsCatalog, eligibleCards, requiredDeckSize } from '../src/game/catalog'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { io: ioc } = require(path.join(__dirname, '../../client/node_modules/socket.io-client'))

const http = createServer()
const io = new Server(http)
const rm = new RoomManager()
rm.useReplayStore(new MemoryReplayStore())
io.use((socket, next) => { socket.data.userId = socket.handshake.auth.userId; socket.data.userName = socket.handshake.auth.userId; next() })
io.on('connection', s => { registerGameEvents(io, s, rm); s.on('disconnect', () => rm.handleDisconnect(s.id, io)) })

setTimeout(() => { console.error('FALLO: timeout de 90 s'); process.exit(1) }, 90000).unref()
http.listen(0, async () => {
    console.log('servidor de prueba escuchando')
    const port = (http.address() as { port: number }).port
    const url = `http://localhost:${port}`
    const a = ioc(url, { auth: { userId: 'ana' } })
    const b = ioc(url, { auth: { userId: 'bea' } })
    const intruder = ioc(url, { auth: { userId: 'intruso' } })
    let lastBotRoom = ''
    const wait = (sock: any, ev: string) => new Promise<any>(res => sock.once(ev, res))
    const fail = (msg: string): never => { console.error('FALLO:', msg); process.exit(1) }

    a.emit('CREATE_ROOM', { playerName: 'Ana' })
    const { roomId } = await wait(a, 'ROOM_CREATED')
    b.emit('JOIN_ROOM', { roomId, playerName: 'Bea' })
    await Promise.all([wait(a, 'SQUAD_SELECTION_STARTED'), wait(b, 'SQUAD_SELECTION_STARTED')])

    // El intruso no puede robar la plaza de Ana
    intruder.emit('RECONNECT', { roomId, playerId: 'player1' })
    await wait(intruder, 'RECONNECT_FAILED')
    console.log('✓ reconexión ajena rechazada')

    // Escuadra inválida rechazada
    a.emit('SELECT_SQUAD', { unitCardIds: ['ST01-U01', 'ST01-U01', 'ST01-U02'], cardIds: [] })
    const err = await wait(a, 'ACTION_ERROR')
    console.log('✓ escuadra inválida rechazada:', err.message)

    // Mazos legales construidos con las reglas oficiales
    const units = loadUnitCatalog(), tactics = loadTacticsCatalog()
    const deck = (squad: string[]) => eligibleCards(squad, units, tactics).slice(0, requiredDeckSize(squad, units, tactics)).map(c => c.id)
    const squadA = ['ST01-U01', 'PA01-U02', 'PA01-U03']
    const squadB = ['ST01-U04', 'DM01-U05', 'DM01-U05']
    const accepted = (sock: any) => new Promise<void>(res => {
        const onError = (e: any) => fail(`escuadra rechazada: ${e.message}`)
        sock.once('ACTION_ERROR', onError)
        sock.once('SQUAD_ACCEPTED', () => { sock.off('ACTION_ERROR', onError); res() })
    })
    a.emit('SELECT_SQUAD', { unitCardIds: squadA, cardIds: deck(squadA) })
    await accepted(a)
    const started = Promise.all([wait(a, 'GAME_STARTED'), wait(b, 'GAME_STARTED')])
    b.emit('SELECT_SQUAD', { unitCardIds: squadB, cardIds: deck(squadB) })
    await accepted(b)
    await started
    console.log('✓ partida creada (con dos copias Mass Produced)')

    let state: GameState | null = null
    let over = false
    for (const s of [a, b]) {
        s.on('GAME_STATE_UPDATE', (p: any) => { state = p.gameState })
        s.on('PHASE_TRANSITION', (p: any) => { state = p.gameState })
        s.on('GAME_OVER', (p: any) => { state = p.gameState; over = true })
        s.on('ACTION_ERROR', (p: any) => console.log('  error:', p.message))
    }
    a.emit('CONFIRM_SETUP'); b.emit('CONFIRM_SETUP')
    await wait(a, 'GAME_STATE_UPDATE')
    if (state!.phase !== 'phase1') fail('no empezó la fase 1')
    console.log('✓ fase 1 iniciada, primera unidad desplegada:', !!state!.units[state!.activeUnitId!].position)

    // Fuera de turno → error
    const other = state!.activePlayerId === 'player1' ? b : a
    other.emit('GAME_ACTION', { action: { type: 'ENERGIZE', unitId: state!.activeUnitId } })
    const ot = await wait(other, 'ACTION_ERROR')
    console.log('✓ acción fuera de turno rechazada:', ot.message)

    // Jugar: avanzar, energize, terminar
    let steps = 0
    while (!over && steps < 400) {
        const s: GameState = state!
        const sock = s.activePlayerId === 'player1' ? a : b
        const id = s.activeUnitId!
        let action
        if (s.pendingResponse) { (s.pendingResponse.forPlayerId === 'player1' ? a : b).emit('GAME_ACTION', { action: { type: 'PASS_RESPONSE' } }); await wait(a, 'GAME_STATE_UPDATE'); continue }
        if (!s.activation!.advanced) {
            const reach = [...reachableFor(s, id, { kind: 'advance' }).keys()]
            action = reach.length ? { type: 'ADVANCE', unitId: id, to: keyToHex(reach[0]) } : { type: 'ENERGIZE', unitId: id }
            if (!reach.length) s.activation!.advanced = true
        } else if (!s.hasUsedPrimaryAction) action = { type: 'ENERGIZE', unitId: id }
        else action = { type: 'END_ACTIVATION', unitId: id }
        const next = new Promise(res => { a.once('GAME_STATE_UPDATE', res); a.once('PHASE_TRANSITION', res); a.once('GAME_OVER', res) })
        sock.emit('GAME_ACTION', { action })
        await Promise.race([next, new Promise(r => setTimeout(r, 500))])
        steps++
    }
    if (!over) fail('la partida no terminó')
    console.log(`✓ partida terminada en ${steps} acciones. Ganador: ${state!.winner} (${state!.winReason})`)

    // ── Partida contra la máquina ──
    const h = ioc(url, { auth: { userId: 'humano' } })
    h.emit('PLAY_BOT', { playerName: 'Humano', squadSize: 3 })
    lastBotRoom = (await wait(h, 'SQUAD_SELECTION_STARTED')).roomId
    const squadH = ['ST01-U01', 'ST01-U02', 'ST01-U03']
    h.emit('SELECT_SQUAD', { unitCardIds: squadH, cardIds: deck(squadH) })
    await wait(h, 'GAME_STARTED')
    let bs: GameState | null = null
    let botOver = false
    let replayId: string | null = null
    h.on('GAME_STATE_UPDATE', (p: any) => { bs = p.gameState })
    h.on('PHASE_TRANSITION', (p: any) => { bs = p.gameState })
    h.on('GAME_OVER', (p: any) => { bs = p.gameState; botOver = true; replayId = p.replayId })
    h.emit('CONFIRM_SETUP')
    await wait(h, 'GAME_STATE_UPDATE')

    // Un espectador entra con el código de la sala y recibe las actualizaciones
    const viewer = ioc(url, { auth: { userId: 'mirona' } })
    let viewerUpdates = 0
    viewer.on('GAME_STATE_UPDATE', () => viewerUpdates++)
    viewer.emit('SPECTATE', { roomId: lastBotRoom })
    const spec = await wait(viewer, 'SPECTATE_STARTED')
    if (!spec.gameState) fail('el espectador no recibió el estado')
    viewer.emit('GAME_ACTION', { action: { type: 'END_ACTIVATION', unitId: 'x' } })
    await wait(viewer, 'ACTION_ERROR')
    console.log('✓ espectador dentro (y sin poder actuar)')
    let botActions = 0
    for (let i = 0; i < 3000 && !botOver; i++) {
        const s: GameState = bs!
        const mine = (s.pendingForcedMove?.forPlayerId ?? s.pendingResponse?.forPlayerId ?? (s.pendingFollowUp && !s.pendingAttack ? s.pendingFollowUp.playerId : null) ?? s.activePlayerId) === 'player1'
        if (!mine) { await new Promise(r => setTimeout(r, 5)); botActions++; continue }
        const id = s.activeUnitId!
        let action: object
        if (s.pendingFollowUp && !s.pendingAttack && !s.pendingResponse) action = { type: 'FOLLOW_UP', to: null, targetId: null }
        else if (s.pendingResponse) action = { type: 'PASS_RESPONSE' }
        else if (!s.activation!.advanced) {
            const reach = [...reachableFor(s, id, { kind: 'advance' }).keys()]
            action = reach.length ? { type: 'ADVANCE', unitId: id, to: keyToHex(reach[0]) } : { type: 'ENERGIZE', unitId: id }
        } else if (!s.hasUsedPrimaryAction) action = { type: 'ENERGIZE', unitId: id }
        else action = { type: 'END_ACTIVATION', unitId: id }
        const next = new Promise(res => { h.once('GAME_STATE_UPDATE', res); h.once('PHASE_TRANSITION', res); h.once('GAME_OVER', res); h.once('ACTION_ERROR', res) })
        h.emit('GAME_ACTION', { action })
        await next
    }
    if (!botOver) fail('la partida contra el bot no terminó')
    const botMoves = bs!.log.filter(l => l.playerId === 'player2').length
    if (botMoves === 0) fail('el bot no hizo nada')
    console.log(`✓ partida contra el bot terminada (${botMoves} entradas del bot en el registro). Ganador: ${bs!.winner}`)
    if (viewerUpdates === 0) fail('el espectador no recibió actualizaciones')

    // Repetición: se reconstruye en el servidor y acaba igual que la partida
    if (!replayId) fail('GAME_OVER sin repetición')
    const opened: any = await new Promise(res => h.emit('REPLAY_OPEN', { id: replayId }, res))
    if (!opened || opened.frames < 2) fail('la repetición no se abrió')
    const lastFrame: GameState = await new Promise(res => h.emit('REPLAY_FRAME', { id: replayId, index: opened.frames - 1 }, res))
    if (lastFrame.winner !== bs!.winner || lastFrame.players.player1.vp !== bs!.players.player1.vp) fail('la repetición no acaba como la partida')
    const list: any[] = await new Promise(res => h.emit('REPLAY_LIST', {}, res))
    if (!list.some(r => r.id === replayId)) fail('la repetición no aparece en la lista del jugador')
    console.log(`✓ repetición de ${opened.frames} pasos idéntica al final de la partida`)

    // Revancha contra la máquina: vuelve a la selección de escuadra
    h.emit('REMATCH')
    const again = await wait(h, 'SQUAD_SELECTION_STARTED')
    if (!again.vsBot) fail('la revancha no es contra la máquina')
    console.log('✓ revancha')
    viewer.disconnect()

    // ── Reloj de turno: un jugador que no hace nada pasa solo y, a la tercera, pierde ──
    const idle = ioc(url, { auth: { userId: 'dormido' } })
    idle.emit('PLAY_BOT', { playerName: 'Dormido', squadSize: 3 })
    await wait(idle, 'SQUAD_SELECTION_STARTED')
    idle.emit('SELECT_SQUAD', { unitCardIds: squadH, cardIds: deck(squadH) })
    await wait(idle, 'GAME_STARTED')
    let sawTimeout = false
    idle.on('GAME_STATE_UPDATE', (p: any) => { if (p.gameState.log.some((l: any) => l.message.includes('Tiempo agotado'))) sawTimeout = true })
    const idleOver = new Promise<any>(res => idle.once('GAME_OVER', res))
    idle.emit('CONFIRM_SETUP')
    const first = await wait(idle, 'GAME_STATE_UPDATE')
    if (!first.gameState.turnClock && first.gameState.activePlayerId === 'player1') fail('no llegó el reloj de turno')
    const end = await idleOver
    if (!sawTimeout) fail('no se pasó el turno automáticamente')
    if (end.winner !== 'player2' || !String(end.reason).includes('agotar el tiempo')) fail(`fin inesperado: ${end.reason}`)
    console.log(`✓ reloj de turno: pase automático y derrota tras 3 tiempos agotados (${end.reason})`)
    process.exit(0)
})
