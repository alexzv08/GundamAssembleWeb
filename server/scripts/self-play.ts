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

// Bot sencillo: ataca si puede; si no, avanza hacia el enemigo más cercano y
// hace Dash o Energize; respeta "no terminar sobre la Base".
function botAction(s: GameState, player: PlayerId): GameAction {
    if (s.pendingResponse?.forPlayerId === player) {
        const card = s.players[player].tactics.hand.find(c => canPlayResponseCard(s, player, c))
        return card && rand() < 0.7 ? { type: 'PLAY_RESPONSE', cardId: card.id } : { type: 'PASS_RESPONSE' }
    }
    const id = s.activeUnitId!
    const unit = s.units[id]
    const act = s.activation!

    if (!s.hasUsedPrimaryAction || act.freeAttacks.length > 0) {
        const weaponOrder = shuffle(unit.weapons.map((_, i) => i))
        for (const wi of weaponOrder) {
            if (s.hasUsedPrimaryAction && !act.freeAttacks.includes(wi)) continue
            const targets = attackableHexes(s, id, wi)
            if (targets.length === 0) continue
            const t = targetAt(s, pickOne(targets), player)!
            return t.kind === 'unit'
                ? { type: 'ATTACK', unitId: id, weaponIndex: wi, targetId: t.id }
                : t.kind === 'rws'
                    ? { type: 'ATTACK_RWS', unitId: id, weaponIndex: wi, rwsId: t.id }
                    : { type: 'ATTACK_GARRISON', unitId: id, weaponIndex: wi, garrisonId: t.id }
        }
    }

    // Cartas: Attack si aún no atacó, o Command que no necesitan objetivo
    if (!act.cardPlayed && rand() < 0.35) {
        const hand = s.players[player].tactics.hand.filter(c => !c.signature || c.signature === unit.signature)
        const atk = !s.hasUsedPrimaryAction && hand.find(c => c.type === 'attack' && c.weapon && attackableHexesWith(s, id, c.weapon).length)
        if (atk && atk.weapon) {
            const t = targetAt(s, pickOne(attackableHexesWith(s, id, atk.weapon)), player)!
            return { type: 'PLAY_CARD', unitId: id, cardId: atk.id, targetId: t.id }
        }
        const simple = new Set(['gain_upgrade', 'repair', 'activation_move_buff', 'aoe_status', 'free_attack', 'heal_per_upgrade', 'energy_if_rescued', 'rws_damage', 'rws_timeline_push', 'free_dash_and_attack', 'strength_if_garrisons_defeated'])
        const cmdCard = hand.find(c => c.type === 'command' && c.effectData && simple.has(c.effectData.type))
        if (cmdCard) return { type: 'PLAY_CARD', unitId: id, cardId: cmdCard.id }
    }

    // Desplegar RWS
    const dep = unit.abilities.findIndex((a, i) => a.abilityData?.type === 'deploy_rws' && !act.usedCommands.includes(i) && unit.energy >= (a.energyCost ?? 0))
    if (dep !== -1 && rand() < 0.5) {
        const hexes = rwsDeployHexes(s, id, unit.abilities[dep].abilityData!.range ?? 3)
        if (hexes.length) return { type: 'USE_ABILITY', unitId: id, abilityIndex: dep, targetHex: keyToHex(pickOne(hexes)) }
    }

    const cmd = unit.abilities.findIndex((a, i) => a.type === 'CMD' && a.abilityData?.type === 'buff_activation' &&
        !act.usedCommands.includes(i) && unit.energy >= (a.energyCost ?? 0))
    if (cmd !== -1 && rand() < 0.5) return { type: 'USE_ABILITY', unitId: id, abilityIndex: cmd }

    if (!act.advanced && unit.position) {
        const reach = [...reachableFor(s, id, { kind: 'advance' }).keys()]
        if (reach.length) {
            const enemies = Object.values(s.units).filter(u => u.playerId !== player && u.position)
            const score = (k: string) => enemies.length ? Math.min(...enemies.map(e => gridDistance(keyToHex(k), e.position!))) : 0
            reach.sort((a, b) => score(a) - score(b))
            return { type: 'ADVANCE', unitId: id, to: keyToHex(rand() < 0.8 ? reach[0] : pickOne(reach)) }
        }
    }

    if (!s.hasUsedPrimaryAction) {
        const rescue = unit.position && Object.values(s.board).find(h => h.garrisonToken?.owner === player && gridDistance(h.coord, unit.position!) === 1)
        if (rescue) return { type: 'RESCUE', unitId: id, garrisonId: rescue.garrisonToken!.id }
        const dash = [...reachableFor(s, id, { kind: 'dash' }).keys()]
        if (dash.length && rand() < 0.4) return { type: 'DASH', unitId: id, to: keyToHex(pickOne(dash)) }
        return { type: 'ENERGIZE', unitId: id }
    }
    return { type: 'END_ACTIVATION', unitId: id }
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
