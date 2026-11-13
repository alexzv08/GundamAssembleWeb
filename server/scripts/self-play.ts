/**
 * self-play.ts
 *
 * Dos bots juegan partidas completas contra el motor del servidor (sin sockets
 * ni React) con escuadras y mazos aleatorios válidos. Detecta excepciones,
 * bucles infinitos y estados inválidos.
 *
 * Uso:
 *   cd server
 *   npx tsx scripts/self-play.ts [--games 50] [--seed 42] [--verbose]
 */
import { createServerGame } from '../src/game/createServerGame'
import { chooseBotAction } from '../src/game/bot'
import { processAction } from '../src/game/engine'
import { startGame } from '../src/game/activation'
import { reachableFor, attackableHexes, attackableHexesWith, targetAt, canPlayResponseCard, rwsDeployHexes } from '../src/game/queries'
import { hexKey, keyToHex, gridDistance } from '../src/game/hexGrid'
import { loadUnitCatalog, loadTacticsCatalog, validateSquad, eligibleCards, requiredDeckSize } from '../src/game/catalog'
import type { GameState, GameAction, PlayerId } from '../src/types'

const args = process.argv.slice(2)
const arg = (name: string, def: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def }
const NUM_GAMES = arg('--games', 100)
const VERBOSE = args.includes('--verbose')
let seed = arg('--seed', Date.now() % 100000)
const MAX_ACTIONS = 2000

function rand(): number {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
}
const d10 = () => Math.floor(rand() * 10) + 1
const pickOne = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
function shuffle<T>(xs: T[]): T[] {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
    return a
}

const units = loadUnitCatalog()
const tactics = loadTacticsCatalog()
// La IA es la misma que usa el rival automático (src/game/bot.ts)
const botAction = (s: GameState, player: PlayerId) => chooseBotAction(s, player, rand)

function randomSquad(): string[] {
    for (;;) {
        const squad = shuffle(units).slice(0, 3).map(u => u.cardId)
        if (validateSquad(squad, units) === null) return squad
    }
}
function randomDeck(squad: string[]): string[] {
    const size = requiredDeckSize(squad, units, tactics)
    return shuffle(eligibleCards(squad, units, tactics)).slice(0, size).map(c => c.id)
}

interface Result { ok: boolean; actions: number; winner?: PlayerId; vp?: [number, number]; error?: string }

function runGame(): Result {
    const sq1 = randomSquad(), sq2 = randomSquad()
    let s = createServerGame('BotA', 'BotB', sq1, sq2, randomDeck(sq1), randomDeck(sq2), { rng: d10, random: rand })
    s = startGame(s)
    let errors = 0
    for (let n = 0; n < MAX_ACTIONS; n++) {
        if (s.phase === 'finished') return { ok: true, actions: n, winner: s.winner!, vp: [s.players.player1.vp, s.players.player2.vp] }
        const player = s.pendingResponse?.forPlayerId ?? s.activePlayerId
        const action = botAction(s, player)
        let r
        try {
            r = processAction(s, action, player, d10)
        } catch (e) {
            return { ok: false, actions: n, error: `Excepción en ${action.type}: ${(e as Error).stack}` }
        }
        if (!r.success) {
            // Un fallo de validación no es un bug si el bot puede seguir: forzamos una salida segura.
            // Solo cuenta como bloqueo una racha de rechazos seguidos
            if (++errors > 50) return { ok: false, actions: n, error: `50 rechazos seguidos; último: ${action.type} → ${r.error}` }
            const fallback: GameAction = s.pendingResponse
                ? { type: 'PASS_RESPONSE' }
                : s.hasUsedPrimaryAction
                ? { type: 'END_ACTIVATION', unitId: s.activeUnitId! }
                : { type: 'ENERGIZE', unitId: s.activeUnitId! }
            if (VERBOSE) console.log(`  rechazado ${action.type}: ${r.error}`)
            r = processAction(s, fallback, player, d10)
            if (!r.success) {
                // Sobre la Base sin haber avanzado: avanzar a cualquier hex
                const reach = [...reachableFor(s, s.activeUnitId!, { kind: 'advance' }).keys()]
                if (reach.length) r = processAction(s, { type: 'ADVANCE', unitId: s.activeUnitId!, to: keyToHex(reach[0]) }, player, d10)
            }
            if (!r.success) return { ok: false, actions: n, error: `Bloqueo: ${r.error}` }
        } else {
            errors = 0
        }
        s = r.state!
        // Invariantes
        for (const r of Object.values(s.rws)) {
            if (r.position && (s.board[hexKey(r.position)]?.occupiedBy || s.board[hexKey(r.position)]?.garrisonToken)) return { ok: false, actions: n, error: `RWS ${r.id} comparte hex` }
        }
        for (const u of Object.values(s.units)) {
            if (u.position && s.board[hexKey(u.position)]?.occupiedBy !== u.id) return { ok: false, actions: n, error: `Ocupación incoherente para ${u.id}` }
            if (u.currentHp <= 0 || u.currentHp > u.maxHp) return { ok: false, actions: n, error: `HP inválido para ${u.id}: ${u.currentHp}` }
        }
    }
    return { ok: false, actions: MAX_ACTIONS, error: 'Límite de acciones alcanzado (¿bucle infinito?)' }
}

const startSeed = seed
let ok = 0
const wins = { player1: 0, player2: 0 }
let totalActions = 0
for (let g = 0; g < NUM_GAMES; g++) {
    const r = runGame()
    if (r.ok) { ok++; wins[r.winner!]++; totalActions += r.actions }
    else console.log(`Partida ${g + 1}: ERROR tras ${r.actions} acciones — ${r.error}`)
}
console.log(`\nSemilla ${startSeed}: ${ok}/${NUM_GAMES} partidas completas, media ${Math.round(totalActions / Math.max(ok, 1))} acciones`)
console.log(`Victorias: P1 ${wins.player1} · P2 ${wins.player2}`)
process.exit(ok === NUM_GAMES ? 0 : 1)
