/**
 * tournament.ts — torneo de estrategias del bot (agresión, control y velocidad).
 *
 * Cada escuadra legal de 3 unidades oficiales juega `--games` partidas con cada
 * estrategia contra un rival al azar (escuadra, estrategia y mazos legales al azar),
 * alternando el bando. Reparte las partidas entre varios procesos y apunta cada
 * resultado en cuanto termina (JSONL), así que se puede cortar y reanudar.
 *
 * Uso:   npm run torneo -- [--games 100] [--workers 4] [--level dificil|normal] [--out <dir>]
 *        npm run torneo:informe -- [--out <dir>]      (resume los resultados)
 */
import fs from 'fs'
import path from 'path'
import { fork } from 'child_process'
import type { GameAction, GameState, PlayerId } from '../src/types'
import { createServerGame } from '../src/game/createServerGame'
import { startGame } from '../src/game/activation'
import { processAction } from '../src/game/engine'
import { chooseBotAction, actingPlayer, botFallback, BOT_STRATEGIES, type BotLevel, type BotStrategy } from '../src/game/bot'
import { reachableFor } from '../src/game/queries'
import { keyToHex } from '../src/game/hexGrid'
import { loadUnitCatalog, loadTacticsCatalog, validateSquad, eligibleCards, requiredDeckSize } from '../src/game/catalog'

const args = process.argv.slice(2)
const arg = (name: string, def: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def }
const GAMES = Number(arg('games', '100'))
const WORKERS = Number(arg('workers', '4'))
const LEVEL = arg('level', 'dificil') as BotLevel
const OUT = path.resolve(arg('out', path.join(__dirname, '../data/runtime/torneo')))
const WORKER = args.includes('--worker') ? Number(arg('worker', '0')) : null
const LIMIT = Number(arg('limit', '0'))   // para pruebas: solo las N primeras tareas

// ─── Escuadras legales (orden fijo: las tareas se identifican por su posición) ──
const UNITS = loadUnitCatalog()
const TACTICS = loadTacticsCatalog()
const OFFICIAL = UNITS.filter(u => !u.cardId.startsWith('DM01')).map(u => u.cardId).sort()
export const SQUADS: string[][] = []
for (let a = 0; a < OFFICIAL.length; a++) for (let b = a; b < OFFICIAL.length; b++) for (let c = b; c < OFFICIAL.length; c++) {
    const s = [OFFICIAL[a], OFFICIAL[b], OFFICIAL[c]]
    if (validateSquad(s, UNITS, 3) === null) SQUADS.push(s)
}
const TOTAL = SQUADS.length * BOT_STRATEGIES.length * GAMES

// ─── Azar reproducible por tarea ───────────────────────────────────────────────
function mulberry32(seed: number) {
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function shuffle<T>(xs: T[], rand: () => number): T[] {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
    return a
}
function deckFor(squad: string[], rand: () => number): string[] {
    const official = eligibleCards(squad, UNITS, TACTICS).filter(c => c.source !== 'demo')
    return shuffle(official, rand).slice(0, requiredDeckSize(squad, UNITS, TACTICS)).map(c => c.id)
}

export interface GameRecord {
    t: number                       // nº de tarea
    A: string[]; sA: BotStrategy; dA: string[]   // escuadra, estrategia y mazo del jugador estudiado
    B: string[]; sB: BotStrategy; dB: string[]   // rival
    side: PlayerId                  // bando del jugador A
    w: 'A' | 'B' | null             // ganador
    vA: number; vB: number          // VP finales
    n: number                       // acciones
    err?: string
}

function runTask(t: number): GameRecord {
    const g = t % GAMES
    const rest = Math.floor(t / GAMES)
    const sA = BOT_STRATEGIES[rest % BOT_STRATEGIES.length]
    const A = SQUADS[Math.floor(rest / BOT_STRATEGIES.length)]
    const rand = mulberry32(t * 2654435761 + 12345)
    const d10 = () => Math.floor(rand() * 10) + 1
    const B = SQUADS[Math.floor(rand() * SQUADS.length)]
    const sB = BOT_STRATEGIES[Math.floor(rand() * BOT_STRATEGIES.length)]
    const dA = deckFor(A, rand), dB = deckFor(B, rand)
    const side: PlayerId = g % 2 === 0 ? 'player1' : 'player2'
    const strat: Record<PlayerId, BotStrategy> = side === 'player1' ? { player1: sA, player2: sB } : { player1: sB, player2: sA }
    const base = { t, A, sA, dA, B, sB, dB, side }
    const [sq1, sq2, dk1, dk2] = side === 'player1' ? [A, B, dA, dB] : [B, A, dB, dA]
    let s: GameState = startGame(createServerGame('P1', 'P2', sq1, sq2, dk1, dk2, { rng: d10, random: rand, mapId: 'DemoMap' }))
    let n = 0, rejected = 0
    try {
        for (; n < 3000 && s.phase !== 'finished'; n++) {
            const p = actingPlayer(s)
            let r = processAction(s, chooseBotAction(s, p, rand, LEVEL, strat[p]), p, d10, { choosePushes: true })
            if (!r.success) {
                if (++rejected > 50) throw new Error(`50 rechazos seguidos: ${r.error}`)
                r = processAction(s, botFallback(s), p, d10, { choosePushes: true })
                if (!r.success && s.activeUnitId) {
                    const reach = [...reachableFor(s, s.activeUnitId, { kind: 'advance' }).keys()]
                    if (reach.length) r = processAction(s, { type: 'ADVANCE', unitId: s.activeUnitId, to: keyToHex(reach[0]) } as GameAction, p, d10, { choosePushes: true })
                }
                if (!r.success) throw new Error(`bloqueo: ${r.error}`)
            } else rejected = 0
            s = r.state!
        }
        if (s.phase !== 'finished') throw new Error('límite de acciones')
    } catch (e) {
        return { ...base, w: null, vA: 0, vB: 0, n, err: (e as Error).message.slice(0, 200) }
    }
    const other: PlayerId = side === 'player1' ? 'player2' : 'player1'
    return { ...base, w: s.winner === side ? 'A' : s.winner === other ? 'B' : null, vA: s.players[side].vp, vB: s.players[other].vp, n }
}

// ─── Proceso de trabajo: hace sus tareas (t % WORKERS === w) que aún no estén hechas ──
function readDone(file: string): Set<number> {
    const done = new Set<number>()
    if (!fs.existsSync(file)) return done
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        if (!line) continue
        try { done.add(JSON.parse(line).t) } catch { /* línea cortada: se repite */ }
    }
    return done
}

function worker(w: number) {
    const file = path.join(OUT, `part-${w}.jsonl`)
    const done = readDone(file)
    const fd = fs.openSync(file, 'a')
    const last = LIMIT ? Math.min(LIMIT, TOTAL) : TOTAL
    for (let t = w; t < last; t += WORKERS) {
        if (done.has(t)) continue
        fs.writeSync(fd, JSON.stringify(runTask(t)) + '\n')
    }
    fs.closeSync(fd)
}

// ─── Proceso principal: lanza los trabajadores y enseña el progreso ────────────
function countLines(): number {
    let n = 0
    for (const f of fs.readdirSync(OUT)) if (/^part-\d+\.jsonl$/.test(f)) n += readDone(path.join(OUT, f)).size
    return n
}

function main() {
    fs.mkdirSync(OUT, { recursive: true })
    const meta = { games: GAMES, workers: WORKERS, level: LEVEL, squads: SQUADS.length, strategies: BOT_STRATEGIES, total: LIMIT ? Math.min(LIMIT, TOTAL) : TOTAL }
    const metaFile = path.join(OUT, 'meta.json')
    if (fs.existsSync(metaFile)) {
        const prev = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
        if (prev.games !== GAMES || prev.workers !== WORKERS || prev.level !== LEVEL) {
            console.error(`La carpeta ${OUT} es de otro torneo (${JSON.stringify(prev)}). Usa otra con --out o bórrala.`)
            process.exit(1)
        }
    }
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, started: new Date().toISOString() }, null, 2))
    const total = meta.total
    const start = Date.now(), startDone = countLines()
    console.log(`Torneo: ${SQUADS.length} escuadras × ${BOT_STRATEGIES.length} estrategias × ${GAMES} partidas = ${total} (nivel ${LEVEL}, ${WORKERS} procesos). Ya hechas: ${startDone}`)
    let alive = WORKERS
    for (let w = 0; w < WORKERS; w++) {
        const child = fork(__filename, [...args, '--worker', String(w)], { execArgv: process.execArgv })
        child.on('exit', code => {
            if (code) console.error(`El proceso ${w} terminó con código ${code}`)
            if (--alive === 0) { clearInterval(timer); report(); console.log(`Terminado: ${countLines()}/${total}`) }
        })
    }
    const report = () => {
        const done = countLines()
        const rate = (done - startDone) / ((Date.now() - start) / 1000)
        const eta = rate > 0 ? (total - done) / rate : Infinity
        const line = `${new Date().toISOString().slice(11, 19)}  ${done}/${total} (${(100 * done / total).toFixed(1)} %) · ${rate.toFixed(1)} partidas/s · quedan ~${Number.isFinite(eta) ? (eta / 60).toFixed(0) : '?'} min`
        console.log(line)
        fs.writeFileSync(path.join(OUT, 'progress.txt'), line + '\n')
    }
    const timer = setInterval(report, 60_000)
}

if (WORKER !== null) worker(WORKER)
else if (require.main === module) main()
