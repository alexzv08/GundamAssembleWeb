/**
 * bot-match.ts — enfrenta dos niveles de bot (npm run duelo -- --a experto --b dificil --games 200).
 * Escuadras y mazos legales al azar (los mismos para los dos lados en cada pareja de
 * partidas, cambiando de bando), reproducible con --seed. Imprime el % de victorias
 * de A con su margen de error, los rechazos del motor y el tiempo por partida.
 */
import type { GameAction, GameState, PlayerId } from '../src/types'
import { createServerGame } from '../src/game/createServerGame'
import { startGame } from '../src/game/activation'
import { processAction } from '../src/game/engine'
import { setPlannerWeights } from '../src/game/planner'
import { chooseBotAction, actingPlayer, botFallback, randomSquad, randomDeck, type BotLevel, type BotStrategy } from '../src/game/bot'

const args = process.argv.slice(2)
const arg = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const A = arg('a', 'experto') as BotLevel, B = arg('b', 'dificil') as BotLevel
const SA = arg('sa', 'equilibrada') as BotStrategy, SB = arg('sb', 'equilibrada') as BotStrategy
if (arg('w', '')) setPlannerWeights(JSON.parse(arg('w', '{}')))
const GAMES = Number(arg('games', '100'))
let seed = Number(arg('seed', '1'))
const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const d10 = () => Math.floor(rand() * 10) + 1

let winsA = 0, done = 0, rejected = 0, actions = 0, vpA = 0, vpB = 0
const t0 = Date.now()
for (let g = 0; g < GAMES; g++) {
    if (g % 2 === 0) { (globalThis as any).sq = [randomSquad(3, rand), randomSquad(3, rand)] }
    const [s1, s2] = (globalThis as any).sq as string[][]
    // Partidas por parejas: mismas escuadras, A con cada una de ellas y en cada bando
    const aSide: PlayerId = g % 2 === 0 ? 'player1' : 'player2'
    const level: Record<PlayerId, BotLevel> = aSide === 'player1' ? { player1: A, player2: B } : { player1: B, player2: A }
    const strat: Record<PlayerId, BotStrategy> = aSide === 'player1' ? { player1: SA, player2: SB } : { player1: SB, player2: SA }
    let s: GameState = startGame(createServerGame('P1', 'P2', s1, s2, randomDeck(s1, rand), randomDeck(s2, rand), { rng: d10, random: rand, mapId: 'DemoMap' }))
    let n = 0
    for (; n < 3000 && s.phase !== 'finished'; n++) {
        const p = actingPlayer(s)
        let r = processAction(s, chooseBotAction(s, p, rand, level[p], strat[p]), p, d10, { choosePushes: true })
        if (!r.success) {
            rejected++
            if (rejected <= 5) console.error(`rechazo (${level[p]}): ${r.error}`)
            r = processAction(s, botFallback(s), p, d10, { choosePushes: true })
            if (!r.success) break
        }
        s = r.state!
    }
    actions += n
    if (s.phase === 'finished') {
        done++
        if (s.winner === aSide) winsA++
        vpA += s.players[aSide].vp; vpB += s.players[aSide === 'player1' ? 'player2' : 'player1'].vp
    }
    if ((g + 1) % 20 === 0) console.log(`${g + 1}/${GAMES}  ${A}: ${(100 * winsA / done).toFixed(1)} %`)
}
const p = winsA / done, ci = 1.96 * Math.sqrt(p * (1 - p) / done)
console.log(`\n${A} (${SA}) contra ${B} (${SB}): ${winsA}/${done} = ${(100 * p).toFixed(1)} % ± ${(100 * ci).toFixed(1)}`)
console.log(`VP de media: ${(vpA / done).toFixed(1)} contra ${(vpB / done).toFixed(1)} · rechazos: ${rejected} · ${(actions / GAMES).toFixed(0)} acciones/partida · ${((Date.now() - t0) / GAMES / 1000).toFixed(2)} s/partida`)
