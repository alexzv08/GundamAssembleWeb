/**
 * self-play.ts
 *
 * Simulación autónoma: dos bots juegan partidas completas usando el engine
 * del servidor sin sockets ni React. Detecta crashes, bucles infinitos y
 * estados inválidos.
 *
 * Uso:
 *   cd server
 *   npx tsx scripts/self-play.ts [--games 50] [--verbose] [--seed 42]
 *
 * Flags:
 *   --games N    Número de partidas a simular (default 100)
 *   --verbose    Imprime el log completo de una partida por cada error
 *   --seed N     Semilla para el RNG (reproducibilidad)
 */

import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import { createServerGame } from '../src/game/createServerGame'
import { applyAction } from '../src/game/actions'
import { checkGameOver, transitionToPhase2, resolveObjectiveControl } from '../src/game/victory'
import { getNextActivation, getCurrentRound } from '../src/game/timeline'
import {
    getReachableHexes, checkLineOfSight, gridDistance, hexKey, getNeighbors,
} from '../src/game/hexGrid'
import { drawCards } from '../src/game/effects'
import type { GameState, PlayerId } from '../src/types'

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const NUM_GAMES   = parseInt(args[args.indexOf('--games')  + 1]) || 100
const VERBOSE     = args.includes('--verbose')
const RNG_SEED    = args.includes('--seed') ? parseInt(args[args.indexOf('--seed') + 1]) : Date.now()
const MAX_ACTIONS = 800  // límite de seguridad por partida

// ─── RNG determinista (mulberry32) ────────────────────────────────────────────

let seed = RNG_SEED
function rand(): number {
    seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5
    return ((seed >>> 0) / 0xFFFFFFFF)
}
function randInt(min: number, max: number): number {
    return Math.floor(rand() * (max - min + 1)) + min
}
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

// ─── Datos del catálogo ───────────────────────────────────────────────────────

interface UnitJSON { cardId: string; faction: string; unitName: string }
interface CardJSON  { cardId: string; type: string; faction: string; name: string }

const DATA_DIR = path.join(__dirname, '../data')

function loadJSON<T>(p: string): T {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
}

const allUnits = loadJSON<{ cards: UnitJSON[] }>(
    path.join(DATA_DIR, 'units/unit_library.json')
).cards

const allCards = loadJSON<{ cards: CardJSON[] }>(
    path.join(DATA_DIR, 'cards/card_library.json')
).cards

const SQUAD_SIZE = 3
const DECK_SIZE  = 9

function pickSquad(units: UnitJSON[]): string[] {
    return shuffle(units).slice(0, SQUAD_SIZE).map(u => u.cardId)
}

function pickDeck(cards: CardJSON[]): string[] {
    return shuffle(cards).slice(0, DECK_SIZE).map(c => c.cardId)
}

// ─── Generación de dados ──────────────────────────────────────────────────────

function rollDice(count: number): number[] {
    return Array.from({ length: Math.max(1, count) }, () => randInt(1, 10))
}

// ─── Lógica del bot ───────────────────────────────────────────────────────────
// Estrategia simple pero que cubre todos los caminos de código:
//  - Ventana RSP: 35 % jugar carta, 65 % pasar
//  - Durante activación: atacar > jugar carta > mover > energizar > finalizar

interface BotAction {
    action:  Record<string, unknown>
    rolls?:  number[]
    label:   string
}

function getLiveEnemies(state: GameState, playerId: PlayerId) {
    return Object.values(state.units).filter(
        u => u.playerId !== playerId && u.currentHp > 0 && u.position !== null
    )
}

function enemyPositionSet(state: GameState, playerId: PlayerId): Set<string> {
    const s = new Set<string>()
    for (const u of getLiveEnemies(state, playerId)) {
        if (u.position) s.add(hexKey(u.position))
    }
    return s
}

function botAction(state: GameState, playerId: PlayerId, actedThisTurn: boolean): BotAction | null {

    // ── RSP window ──────────────────────────────────────────────────────────
    if (state.pendingResponse !== null) {
        if (state.pendingResponse.forPlayerId !== playerId) return null

        const hand    = state.players[playerId].tactics.hand
        const trigger = state.pendingResponse.trigger
        const rsps    = hand.filter(c =>
            c.type === 'response' && (c.effectData as any)?.trigger === trigger
        )

        if (rsps.length > 0 && rand() < 0.35) {
            const card = rsps[Math.floor(rand() * rsps.length)]
            return { action: { type: 'PLAY_RESPONSE', cardId: card.id }, label: `RSP ${card.id}` }
        }
        return { action: { type: 'PASS_RESPONSE' }, label: 'PASS_RSP' }
    }

    if (state.activePlayerId !== playerId) return null
    const unitId = state.activeUnitId
    if (!unitId) return null
    const unit = state.units[unitId]
    if (!unit || unit.currentHp <= 0) return null

    const hand     = state.players[playerId].tactics.hand
    const enemies  = getLiveEnemies(state, playerId)
    const epSet    = enemyPositionSet(state, playerId)

    // ── Jugar carta de command (25 % si hay cartas y no hemos actuado) ──────
    if (!actedThisTurn && !state.hasUsedPrimaryAction) {
        const commands = hand.filter(c => c.type === 'command')
        if (commands.length > 0 && rand() < 0.25) {
            const card = commands[Math.floor(rand() * commands.length)]
            // Algunas cartas necesitan targetId (una unidad enemiga)
            const targetId = enemies.length > 0 ? enemies[0].id : undefined
            return {
                action: { type: 'PLAY_CARD', unitId, cardId: card.id, ...(targetId ? { targetId } : {}) },
                label: `CMD ${card.id}`,
            }
        }
    }

    // ── Usar habilidad BURST (15 % si hay energía y no hemos actuado) ───────
    if (!actedThisTurn && !state.hasUsedPrimaryAction && unit.energy > 0) {
        const burstAbilities = unit.abilities
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => a.type === 'CMD')
        if (burstAbilities.length > 0 && rand() < 0.15) {
            const { i } = burstAbilities[Math.floor(rand() * burstAbilities.length)]
            const targetId = enemies.length > 0 ? enemies[0].id : undefined
            return {
                action: { type: 'USE_ABILITY', unitId, abilityIndex: i, ...(targetId ? { targetId } : {}) },
                label: `ABILITY[${i}]`,
            }
        }
    }

    // ── Atacar al primer enemigo en rango + LoS ──────────────────────────────
    // Se evalúa antes Y después de moverse (actedThisTurn puede ser true tras ADVANCE)
    if (!state.hasUsedPrimaryAction && unit.position) {
        for (let wi = 0; wi < unit.weapons.length; wi++) {
            const weapon = unit.weapons[wi]
            for (const enemy of enemies) {
                if (!enemy.position) continue
                if (gridDistance(unit.position, enemy.position) > weapon.range) continue
                const otherEnemyPos = new Set([...epSet].filter(k => k !== hexKey(enemy.position!)))
                const los = checkLineOfSight(
                    unit.position, enemy.position, state.board, playerId, otherEnemyPos
                )
                if (los.clear) {
                    return {
                        action: { type: 'ATTACK', unitId, weaponIndex: wi, targetId: enemy.id },
                        rolls: rollDice(weapon.strength),
                        label: `ATK ${enemy.id} w${wi}`,
                    }
                }
            }
        }
    }

    // ── Atacar garrison enemiga (si adyacente) ───────────────────────────────
    if (!state.hasUsedPrimaryAction && unit.position) {
        const neighbors = getNeighbors(unit.position)
        for (const nb of neighbors) {
            const nbHex = state.board[hexKey(nb)]
            if (nbHex?.garrisonToken && nbHex.garrisonToken.owner !== playerId) {
                const weapon = unit.weapons[0]
                return {
                    action: { type: 'ATTACK_GARRISON', unitId, weaponIndex: 0, garrisonId: nbHex.garrisonToken.id },
                    rolls: rollDice(weapon.strength),
                    label: `ATK_GARRISON ${nbHex.garrisonToken.id}`,
                }
            }
        }
    }

    // ── Rescatar garrison aliada (si adyacente) ──────────────────────────────
    if (!state.hasUsedPrimaryAction && unit.position) {
        const neighbors = getNeighbors(unit.position)
        for (const nb of neighbors) {
            const nbHex = state.board[hexKey(nb)]
            if (nbHex?.garrisonToken && nbHex.garrisonToken.owner === playerId) {
                return {
                    action: { type: 'RESCUE', unitId, garrisonId: nbHex.garrisonToken.id },
                    label: `RESCUE ${nbHex.garrisonToken.id}`,
                }
            }
        }
    }

    // ── Mover hacia el enemigo más cercano (solo si aún no se hizo ninguna acción) ──
    if (!actedThisTurn && unit.position && enemies.length > 0) {
        const obstacles = new Set<string>()
        for (const u of Object.values(state.units)) {
            if (u.id === unitId || !u.position || u.currentHp <= 0) continue
            if (u.playerId !== playerId) obstacles.add(hexKey(u.position))
        }
        for (const hex of Object.values(state.board)) {
            if (hex.garrisonToken && hex.garrisonToken.owner !== playerId) {
                obstacles.add(hexKey(hex.coord))
            }
        }

        // Velocidad de movimiento: stats del motor usa rango 3 por defecto
        const moveRange = 3 + (unit.upgrades.includes('movement') ? 1 : 0)
        const reachable = getReachableHexes(unit.position, state.board, obstacles, moveRange)

        // Elige el hex alcanzable más cercano a algún enemigo
        let bestHex: string | null = null
        let bestDist = Infinity
        for (const coord of reachable) {
            const hk = hexKey(coord)
            const occ = state.board[hk]?.occupiedBy
            if (occ && occ !== unitId) continue
            for (const enemy of enemies) {
                if (!enemy.position) continue
                const d = gridDistance(coord, enemy.position)
                if (d < bestDist) { bestDist = d; bestHex = hk }
            }
        }

        if (bestHex && bestHex !== hexKey(unit.position)) {
            const toCoord = state.board[bestHex].coord
            return { action: { type: 'ADVANCE', unitId, to: toCoord }, label: `MOVE ${bestHex}` }
        }
    }

    // ── Garantizar acción primaria antes de END_ACTIVATION ──────────────────
    // END_ACTIVATION requiere hasUsedPrimaryAction=true; si no lo hemos hecho,
    // energizar siempre (nunca devolver END cuando primary no está marcada)
    if (!state.hasUsedPrimaryAction) {
        return { action: { type: 'ENERGIZE', unitId }, label: 'ENERGIZE' }
    }

    // ── Energizar (25 % de probabilidad extra) ───────────────────────────────
    if (rand() < 0.25) {
        return { action: { type: 'ENERGIZE', unitId }, label: 'ENERGIZE' }
    }

    // ── Finalizar activación ─────────────────────────────────────────────────
    return { action: { type: 'END_ACTIVATION', unitId }, label: 'END' }
}

// ─── Bucle de partida ─────────────────────────────────────────────────────────

const MAX_ACTIONS_PER_ACTIVATION = 5  // fuerza END_ACTIVATION si una unidad no termina sola

interface GameLog { label: string; player: PlayerId; round: number | null }

interface GameResult {
    winner:    PlayerId | null
    reason:    string
    turns:     number
    vp1:       number
    vp2:       number
    error?:    string
    gameLogs?: GameLog[]
    actionCounts: Map<string, number>
    squad1:    string[]
    squad2:    string[]
    deck1:     string[]
    deck2:     string[]
}

function categorize(label: string): string {
    if (label.startsWith('ATK_GARRISON')) return 'ATK_GARRISON'
    if (label.startsWith('ATK'))          return 'ATTACK'
    if (label.startsWith('MOVE'))         return 'ADVANCE'
    if (label.startsWith('CMD'))          return 'PLAY_CARD'
    if (label.startsWith('RSP'))          return 'PLAY_RESPONSE'
    if (label.startsWith('ABILITY'))      return 'USE_ABILITY'
    if (label.startsWith('RESCUE'))       return 'RESCUE'
    return label  // ENERGIZE, END, PASS_RSP, PHASE2, DASH
}

function runGame(squad1: string[], squad2: string[], deck1: string[], deck2: string[]): GameResult {
    const gameLogs: GameLog[] = []
    const actionCounts = new Map<string, number>()

    let state: GameState = createServerGame('BotA', 'BotB', squad1, squad2, deck1, deck2)
    // Saltar la fase setup directamente a fase 1
    state.phase = 'phase1'

    let actions = 0
    let actedThisTurn = false
    let actionsThisActivation = 0
    let prevActiveUnit = state.activeUnitId

    // Helper: aplica una acción al estado y devuelve el nuevo estado o null
    function step(newState: GameState, actionObj: Record<string, unknown>, player: PlayerId, rolls?: number[]): GameState | null {
        let s: GameState
        try {
            const r = applyAction(newState, actionObj as any, player, rolls)
            if (!r.success || !r.newState) return null
            s = r.newState
        } catch { return null }

        // Transición fase1 → fase2
        const nextRoundStep = getCurrentRound(s.timeline)
        if (s.phase === 'phase1' && nextRoundStep !== null && nextRoundStep > 10) {
            s = transitionToPhase2(s)
            s = drawCards(s, 'player1', 3)
            s = drawCards(s, 'player2', 3)
            gameLogs.push({ label: 'PHASE2', player, round: s.roundNumber ?? null })
        }
        s = resolveObjectiveControl(s).newState
        return s
    }

    while (actions < MAX_ACTIONS) {
        actions++

        // Detectar cambio de unidad activa
        if (state.activeUnitId !== prevActiveUnit) {
            actedThisTurn = false
            actionsThisActivation = 0
            prevActiveUnit = state.activeUnitId
        }

        // Límite de acciones por activación — forzar acción primaria y luego END_ACTIVATION
        if (actionsThisActivation >= MAX_ACTIONS_PER_ACTIVATION && state.pendingResponse === null && state.activeUnitId) {
            if (!state.hasUsedPrimaryAction) {
                const energize = step(state, { type: 'ENERGIZE', unitId: state.activeUnitId }, state.activePlayerId)
                if (energize) { state = energize; actionsThisActivation = 0 }
                continue
            }
            const forcedEnd = step(state, { type: 'END_ACTIVATION', unitId: state.activeUnitId }, state.activePlayerId)
            if (forcedEnd) {
                state = forcedEnd
                actedThisTurn = false
                actionsThisActivation = 0
                prevActiveUnit = state.activeUnitId
                const over = checkGameOver(state)
                if (over.isOver) return { winner: over.winner, reason: over.reason, turns: actions, vp1: state.players.player1.vp, vp2: state.players.player2.vp, gameLogs: VERBOSE ? gameLogs : undefined, actionCounts, squad1, squad2, deck1, deck2 }
            }
            continue
        }

        const movingPlayer: PlayerId = state.pendingResponse !== null
            ? state.pendingResponse.forPlayerId
            : state.activePlayerId

        const bot = botAction(state, movingPlayer, actedThisTurn)
        if (!bot) {
            if (state.activeUnitId && state.pendingResponse === null) {
                const s = step(state, { type: 'END_ACTIVATION', unitId: state.activeUnitId }, state.activePlayerId)
                if (s) { state = s; actedThisTurn = false; actionsThisActivation = 0; prevActiveUnit = state.activeUnitId }
            }
            // Siempre comprobar fin de partida, incluso si activeUnitId es null
            const over = checkGameOver(state)
            if (over.isOver) return { winner: over.winner, reason: over.reason, turns: actions, vp1: state.players.player1.vp, vp2: state.players.player2.vp, gameLogs: VERBOSE ? gameLogs : undefined, actionCounts, squad1, squad2, deck1, deck2 }
            continue
        }

        gameLogs.push({ label: bot.label, player: movingPlayer, round: state.roundNumber ?? null })
        const cat = categorize(bot.label)
        actionCounts.set(cat, (actionCounts.get(cat) ?? 0) + 1)

        let result
        try {
            result = applyAction(state, bot.action as any, movingPlayer, bot.rolls)
        } catch (err: unknown) {
            return { winner: null, reason: 'crash', turns: actions, vp1: state.players.player1.vp, vp2: state.players.player2.vp, error: String(err), gameLogs: VERBOSE ? gameLogs : undefined, squad1, squad2, deck1, deck2 }
        }

        actionsThisActivation++

        if (!result.success) {
            if (!['END_ACTIVATION', 'PASS_RESPONSE', 'PLAY_RESPONSE'].includes(bot.action.type as string)) {
                actedThisTurn = true
            }
            if (bot.action.type === 'PASS_RESPONSE' || bot.action.type === 'PLAY_RESPONSE') {
                return { winner: null, reason: 'response_error', turns: actions, vp1: state.players.player1.vp, vp2: state.players.player2.vp, error: `RSP rejected: ${result.error}`, gameLogs: VERBOSE ? gameLogs : undefined, squad1, squad2, deck1, deck2 }
            }
            continue
        }

        state = result.newState!

        if (['ATTACK', 'ATTACK_GARRISON', 'USE_ABILITY', 'PLAY_CARD', 'ADVANCE', 'RESCUE', 'ENERGIZE'].includes(bot.action.type as string)) {
            actedThisTurn = true
        }
        if (bot.action.type === 'END_ACTIVATION') {
            actedThisTurn = false
            actionsThisActivation = 0
        }

        // Transición fase1 → fase2
        const nextRoundMain = getCurrentRound(state.timeline)
        if (state.phase === 'phase1' && nextRoundMain !== null && nextRoundMain > 10) {
            state = transitionToPhase2(state)
            state = drawCards(state, 'player1', 3)
            state = drawCards(state, 'player2', 3)
            gameLogs.push({ label: 'PHASE2', player: movingPlayer, round: state.roundNumber ?? null })
            actedThisTurn = false
            actionsThisActivation = 0
        }

        state = resolveObjectiveControl(state).newState

        const over = checkGameOver(state)
        if (over.isOver) {
            return { winner: over.winner, reason: over.reason, turns: actions, vp1: state.players.player1.vp, vp2: state.players.player2.vp, gameLogs: VERBOSE ? gameLogs : undefined, actionCounts, squad1, squad2, deck1, deck2 }
        }
    }

    return { winner: null, reason: `timeout (>${MAX_ACTIONS} acciones)`, turns: actions, vp1: state.players.player1.vp, vp2: state.players.player2.vp, error: `Partida sin terminar tras ${MAX_ACTIONS} acciones`, gameLogs: VERBOSE ? gameLogs : undefined, squad1, squad2, deck1, deck2 }
}

// ─── Estadísticas ─────────────────────────────────────────────────────────────

interface Stats {
    total:    number
    p1wins:   number
    p2wins:   number
    draws:    number
    errors:   number
    timeouts: number
    totalTurns:    number
    maxTurns:      number
    minTurns:      number
    crashReasons:  Map<string, number>
    cardsTested:   Set<string>
    abilitiesSeen: number
    actionTotals:  Map<string, number>
}

function printStats(stats: Stats) {
    const avg = stats.total > 0 ? (stats.totalTurns / stats.total).toFixed(1) : '0'
    const totalActions = [...stats.actionTotals.values()].reduce((a, b) => a + b, 0)
    console.log('\n══════════════════════════════════════════')
    console.log('  RESULTADOS DEL SELF-PLAY')
    console.log('══════════════════════════════════════════')
    console.log(`  Partidas:    ${stats.total}`)
    console.log(`  Victoria P1: ${stats.p1wins} (${pct(stats.p1wins, stats.total)})`)
    console.log(`  Victoria P2: ${stats.p2wins} (${pct(stats.p2wins, stats.total)})`)
    console.log(`  Empates:     ${stats.draws}  (${pct(stats.draws, stats.total)})`)
    console.log(`  Errores:     ${stats.errors} (${pct(stats.errors, stats.total)})`)
    console.log(`  Timeouts:    ${stats.timeouts}`)
    console.log(`  Acciones — avg: ${avg}, min: ${stats.minTurns}, max: ${stats.maxTurns}`)
    console.log(`  Cartas ejercitadas: ${stats.cardsTested.size} / ${allCards.length}`)

    console.log('\n  Desglose de acciones (total acumulado):')
    const order = ['ATTACK','ADVANCE','ENERGIZE','END','ATK_GARRISON','RESCUE','PLAY_CARD','PLAY_RESPONSE','PASS_RSP','USE_ABILITY','PHASE2']
    for (const key of order) {
        const n = stats.actionTotals.get(key) ?? 0
        if (n > 0) console.log(`    ${key.padEnd(16)} ${n.toString().padStart(5)}  (${pct(n, totalActions)})`)
    }
    // Cualquier categoría inesperada
    for (const [key, n] of stats.actionTotals) {
        if (!order.includes(key) && n > 0) console.log(`    ${key.padEnd(16)} ${n.toString().padStart(5)}  (${pct(n, totalActions)})`)
    }

    if (stats.errors > 0) {
        console.log('\n  Errores por tipo:')
        for (const [reason, count] of stats.crashReasons) {
            console.log(`    [${count}x] ${reason.slice(0, 120)}`)
        }
    }
    console.log('══════════════════════════════════════════\n')
}

function pct(n: number, total: number): string {
    return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
    console.log(`\nSelf-play: ${NUM_GAMES} partidas | seed ${RNG_SEED}`)
    console.log(`Unidades disponibles: ${allUnits.length} | Cartas: ${allCards.length}`)

    const stats: Stats = {
        total: 0, p1wins: 0, p2wins: 0, draws: 0, errors: 0, timeouts: 0,
        totalTurns: 0, maxTurns: 0, minTurns: Infinity,
        crashReasons: new Map(), cardsTested: new Set(), abilitiesSeen: 0,
        actionTotals: new Map(),
    }
    let firstSuccessLogged = false

    for (let i = 0; i < NUM_GAMES; i++) {
        const squad1 = pickSquad(allUnits)
        const squad2 = pickSquad(allUnits)
        const deck1  = pickDeck(allCards)
        const deck2  = pickDeck(allCards)

        const result = runGame(squad1, squad2, deck1, deck2)
        stats.total++
        stats.totalTurns += result.turns
        stats.maxTurns    = Math.max(stats.maxTurns, result.turns)
        stats.minTurns    = Math.min(stats.minTurns, result.turns)

        // Registrar cartas que aparecieron en decks
        for (const c of [...deck1, ...deck2]) stats.cardsTested.add(c)

        // Acumular conteo de acciones
        for (const [key, n] of result.actionCounts) {
            stats.actionTotals.set(key, (stats.actionTotals.get(key) ?? 0) + n)
        }

        // Verbose: mostrar log completo de la primera partida exitosa
        if (VERBOSE && !firstSuccessLogged && !result.error && result.gameLogs) {
            firstSuccessLogged = true
            console.log(`\n── Partida 1 (${result.turns} acciones | ganador: ${result.winner ?? 'empate'}) ──`)
            console.log(`  Squad1: ${result.squad1.join(', ')}`)
            console.log(`  Squad2: ${result.squad2.join(', ')}`)
            for (const log of result.gameLogs) {
                console.log(`    [${log.player}] ${log.label}`)
            }
        }

        if (result.error) {
            stats.errors++
            const key = result.error.slice(0, 100)
            stats.crashReasons.set(key, (stats.crashReasons.get(key) ?? 0) + 1)

            if (VERBOSE && result.gameLogs) {
                console.log(`\n── ERROR en partida ${i + 1} ──`)
                console.log(`  Squad1: ${result.squad1.join(', ')}`)
                console.log(`  Squad2: ${result.squad2.join(', ')}`)
                console.log(`  Error: ${result.error}`)
                console.log('  Últimas 20 acciones:')
                for (const log of result.gameLogs.slice(-20)) {
                    console.log(`    [R${log.round ?? '?'}] ${log.player}: ${log.label}`)
                }
            }

            if (result.reason === `timeout (>${MAX_ACTIONS} acciones)`) stats.timeouts++
        } else if (result.winner === 'player1') {
            stats.p1wins++
        } else if (result.winner === 'player2') {
            stats.p2wins++
        } else {
            stats.draws++
        }

        // Progreso
        if ((i + 1) % 10 === 0 || i === NUM_GAMES - 1) {
            process.stdout.write(`\r  Progreso: ${i + 1}/${NUM_GAMES} | errores: ${stats.errors}   `)
        }
    }

    console.log()
    printStats(stats)

    // Exit code 1 si hay errores para integrar en CI
    if (stats.errors > 0) process.exit(1)
}

main()
