/**
 * tournament-report.ts — resume los resultados del torneo (npm run torneo).
 * Lee los part-*.jsonl y escribe summary.json con el % de victorias por
 * estrategia, cruce de estrategias, unidad, unidad × estrategia, escuadra y carta.
 *
 * Uso: npm run torneo:informe -- [--out <dir>]
 *
 * Cada partida aporta dos observaciones (una por bando) a las tablas de unidades,
 * cartas y escuadras; las de estrategia cuentan solo los cruces de estrategias distintas
 * para el cara a cara, y todas las partidas para el total.
 */
import fs from 'fs'
import path from 'path'
import type { GameRecord } from './tournament'
import { loadUnitCatalog, loadTacticsCatalog } from '../src/game/catalog'

const args = process.argv.slice(2)
const i = args.indexOf('--out')
const OUT = path.resolve(i >= 0 ? args[i + 1] : path.join(__dirname, '../data/runtime/torneo'))

const records: GameRecord[] = []
for (const f of fs.readdirSync(OUT)) {
    if (!/^part-\d+\.jsonl$/.test(f)) continue
    for (const line of fs.readFileSync(path.join(OUT, f), 'utf-8').split('\n')) {
        if (!line) continue
        try { records.push(JSON.parse(line)) } catch { /* línea a medias */ }
    }
}
const ok = records.filter(r => !r.err)
const unitName = new Map(loadUnitCatalog().map(u => [u.cardId, u.name]))
const cardName = new Map(loadTacticsCatalog().map(c => [c.id, c.name]))

// Victorias con intervalo de confianza del 95 % (Wilson)
interface Tally { w: number; n: number; vp: number }
const tally = () => ({ w: 0, n: 0, vp: 0 })
function add(m: Map<string, Tally>, key: string, won: boolean, vp: number) {
    const t = m.get(key) ?? tally()
    t.w += won ? 1 : 0; t.n++; t.vp += vp
    m.set(key, t)
}
function stats(t: Tally) {
    const p = t.n ? t.w / t.n : 0, z = 1.96, n = t.n
    const den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return { games: n, wins: t.w, winRate: +(100 * p).toFixed(1), ci95: n ? [+(100 * (c - h)).toFixed(1), +(100 * (c + h)).toFixed(1)] : [0, 0], avgVp: n ? +(t.vp / n).toFixed(1) : 0 }
}
function table<L extends object>(m: Map<string, Tally>, label: (k: string) => L) {
    return [...m.entries()].map(([k, t]) => ({ key: k, ...label(k), ...stats(t) })).sort((a, b) => b.winRate - a.winRate)
}

const byStrategy = new Map<string, Tally>(), vsStrategy = new Map<string, Tally>()
const byUnit = new Map<string, Tally>(), byUnitStrategy = new Map<string, Tally>()
const bySquad = new Map<string, Tally>(), bySquadStrategy = new Map<string, Tally>(), byCard = new Map<string, Tally>()
const bySide = new Map<string, Tally>()
let actions = 0, draws = 0, vpTotal = 0

for (const r of ok) {
    actions += r.n
    if (!r.w) draws++
    vpTotal += r.vA + r.vB
    const sides = [
        { squad: r.A, strat: r.sA, deck: r.dA, won: r.w === 'A', vp: r.vA, opp: r.sB, side: r.side },
        { squad: r.B, strat: r.sB, deck: r.dB, won: r.w === 'B', vp: r.vB, opp: r.sA, side: r.side === 'player1' ? 'player2' : 'player1' },
    ]
    for (const s of sides) {
        add(byStrategy, s.strat, s.won, s.vp)
        if (s.strat !== s.opp) add(vsStrategy, `${s.strat}|${s.opp}`, s.won, s.vp)
        add(bySide, s.side, s.won, s.vp)
        const squadKey = [...s.squad].sort().join('+')
        add(bySquad, squadKey, s.won, s.vp)
        add(bySquadStrategy, `${squadKey}|${s.strat}`, s.won, s.vp)
        for (const u of new Set(s.squad)) { add(byUnit, u, s.won, s.vp); add(byUnitStrategy, `${u}|${s.strat}`, s.won, s.vp) }
        for (const c of new Set(s.deck)) add(byCard, c, s.won, s.vp)
    }
}

const squadLabel = (k: string) => ({ units: k.split('+').map(u => unitName.get(u) ?? u) })
const summary = {
    generated: new Date().toISOString(),
    meta: fs.existsSync(path.join(OUT, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf-8')) : null,
    games: records.length, errors: records.length - ok.length, draws,
    avgActions: ok.length ? +(actions / ok.length).toFixed(1) : 0,
    avgVpPerSide: ok.length ? +(vpTotal / ok.length / 2).toFixed(1) : 0,
    sides: table(bySide, k => ({ side: k })),
    strategies: table(byStrategy, k => ({ strategy: k })),
    strategyMatchups: table(vsStrategy, k => { const [a, b] = k.split('|'); return { strategy: a, vs: b } }),
    units: table(byUnit, k => ({ cardId: k, name: unitName.get(k) ?? k })),
    unitStrategies: table(byUnitStrategy, k => { const [u, s] = k.split('|'); return { cardId: u, name: unitName.get(u) ?? u, strategy: s } }),
    squads: table(bySquad, squadLabel),
    squadStrategies: table(bySquadStrategy, k => { const [sq, s] = k.split('|'); return { ...squadLabel(sq), strategy: s } }),
    cards: table(byCard, k => ({ cardId: k, name: cardName.get(k) ?? k })),
    errorSamples: records.filter(r => r.err).slice(0, 10).map(r => ({ t: r.t, err: r.err })),
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))

const pct = (x: { winRate: number; games: number }) => `${x.winRate.toFixed(1)} % (${x.games})`
console.log(`${records.length} partidas · ${summary.errors} errores · ${draws} empates · ${summary.avgActions} acciones de media`)
console.log('\nEstrategias:'); for (const s of summary.strategies) console.log(`  ${s.strategy.padEnd(10)} ${pct(s)}`)
console.log('\nCara a cara:'); for (const s of summary.strategyMatchups) console.log(`  ${s.strategy.padEnd(10)} vs ${String(s.vs).padEnd(10)} ${pct(s)}`)
console.log('\nUnidades:'); for (const u of summary.units) console.log(`  ${String(u.name).padEnd(36)} ${pct(u)}`)
console.log('\nCartas (5 mejores y 5 peores):'); for (const c of [...summary.cards.slice(0, 5), ...summary.cards.slice(-5)]) console.log(`  ${String(c.name).padEnd(36)} ${pct(c)}`)
console.log(`\nResumen completo en ${path.join(OUT, 'summary.json')}`)
