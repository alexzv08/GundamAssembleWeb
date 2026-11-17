// Planificador de activaciones: el cerebro del bot "experto" y del consejero.
//
// En vez de elegir cada acción por separado, prueba las activaciones completas
// que puede hacer la unidad activa (atacar y luego moverse, moverse y atacar,
// rescatar, Dash, Energize…) y puntúa cada una en "VP equivalentes":
//   + lo que gana: daño (más valioso contra unidades tocadas: fuego concentrado),
//     probabilidad de derrota × VP, Garrisons, Objetivos que captura o neutraliza.
//   − lo que arriesga: el daño que pueden hacerle los enemigos que activan antes
//     que ella (con su movimiento, alcance y línea de visión reales), quedarse
//     pegada a aliados delante de armas de área, abandonar un Objetivo propio.
//   − el Timeline que gasta.
// No tira dados: usa los valores esperados de la misma previsión que ve el jugador.
// El bot ejecuta el primer paso del mejor plan y vuelve a planificar tras cada acción.
import type { GameState, GameAction, PlayerId, Unit, Weapon } from '../types'
import { reachableFor, attackableHexes, targetAt, attackTargets, baseOwnerAt, otherPlayer, upgradeCount } from './queries'
import { previewAttack } from './combat'
import { keyToHex, gridDistance, hexKey, checkLineOfSight } from './hexGrid'
import { getUnitRound } from './timeline'

export interface PlannerWeights {
    damage: number       // daño (como fracción de los HP que le quedan al objetivo × sus VP)
    kill: number         // probabilidad de derrota × (VP + 2)
    garrison: number     // destruir una Garrison enemiga
    rescue: number       // rescatar una propia
    objective: number    // capturar / neutralizar Objetivos (× VP del Objetivo)
    approach: number     // acercarse a Objetivos que no son nuestros
    safety: number       // daño esperado que recibirá antes de volver a activar
    cluster: number      // por aliado adyacente si el rival tiene armas de área
    offense: number      // tener enemigos a tiro para la próxima activación
    tl: number           // coste por punto de Timeline
    energy: number       // por punto de Energy (si tiene en qué gastarlo)
}

export const DEFAULT_WEIGHTS: PlannerWeights = {
    // Afinados con partidas contra el nivel difícil (npm run duelo)
    damage: 1, kill: 1, garrison: 1, rescue: 1, objective: 1.1, approach: 0.15,
    safety: 0.6, cluster: 0.5, offense: 0.6, tl: 0.7, energy: 0.2,
}

// Pesos activos del bot experto (se pueden cambiar para afinarlos con partidas de prueba)
let ACTIVE: PlannerWeights = DEFAULT_WEIGHTS
export function setPlannerWeights(w: Partial<PlannerWeights>): void { ACTIVE = { ...DEFAULT_WEIGHTS, ...w } }

export interface PlanPart { label: string; value: number }
export interface Plan {
    steps: GameAction[]
    score: number
    parts: PlanPart[]
    end: string                  // hex donde termina la unidad
    target: string | null        // hex atacado (para resaltarlo)
    tl: number                   // Timeline que gasta
}

interface AttackOption { action: GameAction; key: string; tl: number; value: number; parts: PlanPart[]; kills: Map<string, number> }

const r1 = (n: number) => Math.round(n * 10) / 10
const pct = (n: number) => `${Math.round(n * 100)} %`

function killProb(dice: number, p: number, bonus: number, shields: number, hp: number): number {
    let kill = 0, comb = 1
    for (let k = 0; k <= dice; k++) {
        if (k > 0) comb = comb * (dice - k + 1) / k
        if (Math.max(0, k + bonus - shields) >= hp) kill += comb * p ** k * (1 - p) ** (dice - k)
    }
    return kill
}

const shieldsOf = (u: Unit) => u.upgrades.filter(x => x.type === 'shield' && x.active !== false).reduce((n, x) => n + (x.value ?? 1), 0)
const nameOf = (u: Unit) => u.shortName ?? u.name

// Mueve la unidad a `key` mientras dura `fn` (sin copiar el estado) y la devuelve a su sitio
function withUnitAt<T>(s: GameState, unitId: string, key: string, fn: () => T, moved = true): T {
    const unit = s.units[unitId]
    const from = unit.position!
    const fromKey = hexKey(from)
    const act = s.activation
    const prevMoved = act?.moved
    if (key !== fromKey) {
        s.board[fromKey].occupiedBy = null
        s.board[key].occupiedBy = unitId
        unit.position = keyToHex(key)
        if (act && moved) act.moved = true
    }
    try { return fn() } finally {
        if (key !== fromKey) {
            s.board[key].occupiedBy = null
            s.board[fromKey].occupiedBy = unitId
            unit.position = from
            if (act) act.moved = prevMoved!
        }
    }
}

export function planActivation(s: GameState, player: PlayerId, W: PlannerWeights = ACTIVE): Plan[] {
    const id = s.activeUnitId
    const act = s.activation
    if (!id || !act) return []
    const me = s.units[id]
    if (!me?.position || me.playerId !== player) return []
    const here = hexKey(me.position)
    const enemy = otherPlayer(player)
    const enemies = Object.values(s.units).filter(u => u.playerId === enemy && u.position)
    const allies = Object.values(s.units).filter(u => u.playerId === player && u.position && u.id !== id)
    const canPrimary = !s.hasUsedPrimaryAction
    const freeAttacks = act.freeAttacks
    const canAdvance = !act.advanced
    const myRound = getUnitRound(s.timeline, id) ?? s.timeline.currentRound

    // ── Amenaza: qué puede hacerle cada enemigo a la unidad en cada hex ──
    const enemyReach = new Map<string, string[]>()
    for (const e of enemies) enemyReach.set(e.id, [hexKey(e.position!), ...reachableFor(s, e.id, { kind: 'advance' }).keys()])
    const splash = enemies.some(e => e.weapons.some(w => w.area || w.effectData?.type === 'also_target_adjacent'))
    const threatCache = new Map<string, number>()
    const myShields = shieldsOf(me)
    function threatFrom(e: Unit, key: string): number {
        const ck = `${e.id}|${key}`
        const hit = threatCache.get(ck)
        if (hit !== undefined) return hit
        const to = keyToHex(key)
        const reach = enemyReach.get(e.id)!
        const bonus = upgradeCount(e, 'attack')
        let best = 0
        const weapons = [...e.weapons].sort((a, b) => b.strength - a.strength)
        for (const w of weapons) {
            const dmg = Math.max(0, (w.strength + bonus) * 0.55 - myShields)
            if (dmg <= best) continue
            const range = w.area ? Math.max(w.range, 2) : w.range
            if (reach.some(h => { const c = keyToHex(h); return gridDistance(c, to) <= range && checkLineOfSight(c, to, s.board).clear })) best = dmg
        }
        threatCache.set(ck, best)
        return best
    }
    // Enemigos que activan antes de que esta unidad vuelva a hacerlo si gasta `tl`
    const actsBefore = (e: Unit, tl: number) => {
        const r = getUnitRound(s.timeline, e.id)
        return r !== null && r <= myRound + tl
    }

    // ── Valor de terminar en `key` ──
    function position(key: string, tl: number, kills: Map<string, number>): { value: number; parts: PlanPart[] } | null {
        if (baseOwnerAt(s, key) !== null) return null      // no se puede terminar en la Base
        const parts: PlanPart[] = []
        const c = keyToHex(key)

        // Objetivos: mayoría alrededor de cada uno con la unidad en `key`
        const objectives = Object.values(s.board).filter(h => h.objectiveToken)
        let objValue = 0, nearest = Infinity, nearestVp = 0
        const count = (o: { q: number; r: number }, side: PlayerId, at: string | null) => {
            let n = Object.values(s.units).filter(u => u.playerId === side && u.position && u.id !== id && gridDistance(u.position, o) <= 1).length
            if (side === player && at && gridDistance(keyToHex(at), o) <= 1) n++
            return n
        }
        for (const o of objectives) {
            const obj = o.objectiveToken!
            const dEnd = gridDistance(c, o.coord), dNow = gridDistance(me.position!, o.coord)
            if (obj.controlledBy !== player && dEnd > 1 && dEnd < nearest) { nearest = dEnd; nearestVp = obj.vpValue }
            if (dEnd <= 1) {
                const mine = count(o.coord, player, key), theirs = count(o.coord, enemy, null)
                if (mine > theirs && obj.controlledBy === null) { objValue += obj.vpValue * W.objective; parts.push({ label: `Captura el Objetivo ${obj.id.replace(/\D/g, '')} (${obj.vpValue} VP)`, value: obj.vpValue * W.objective }) }
                else if (mine > theirs && obj.controlledBy === enemy) { objValue += obj.vpValue * W.objective * 0.6; parts.push({ label: `Neutraliza el Objetivo ${obj.id.replace(/\D/g, '')} del rival`, value: obj.vpValue * W.objective * 0.6 }) }
                else if (obj.controlledBy === player && enemies.some(e => gridDistance(e.position!, o.coord) <= 4)) objValue += obj.vpValue * 0.15
            } else if (dNow <= 1 && obj.controlledBy === player) {
                // Se va de un Objetivo propio y deja de tener mayoría
                if (count(o.coord, player, null) <= count(o.coord, enemy, null) + (enemies.some(e => gridDistance(e.position!, o.coord) <= 4) ? 1 : 0)) {
                    const v = -obj.vpValue * W.objective * 0.4
                    objValue += v; parts.push({ label: `Deja desprotegido el Objetivo ${obj.id.replace(/\D/g, '')}`, value: v })
                }
            }
        }
        if (nearest !== Infinity) objValue -= W.approach * (nearestVp / 5) * nearest
        let value = objValue

        // Peligro antes de volver a activar
        let incoming = 0
        for (const e of enemies) if (actsBefore(e, tl)) incoming += threatFrom(e, key) * (1 - (kills.get(e.id) ?? 0))
        incoming *= 0.75     // no todos dispararán a esta unidad
        if (incoming > 0) {
            const frac = Math.min(1, incoming / me.currentHp)
            const risk = W.safety * (me.vp * 0.5 * frac + (incoming >= me.currentHp ? 0.6 * (me.vp + 2) : 0))
            value -= risk
            if (risk > 0.3) parts.push({ label: `Expuesta: ≈${r1(incoming)} de daño antes de volver a activar${incoming >= me.currentHp ? ' (puede caer)' : ''}`, value: -risk })
        }
        // Aliados pegados delante de armas de área
        if (splash) {
            const adj = allies.filter(a => gridDistance(a.position!, c) === 1).length
            if (adj) { value -= adj * W.cluster; parts.push({ label: `Pegada a ${adj} aliad${adj > 1 ? 'as' : 'a'} con armas de área enfrente`, value: -adj * W.cluster }) }
        }
        // Enemigos a tiro para la próxima activación
        const maxRange = Math.max(...me.weapons.map(w => w.range))
        if (enemies.length) {
            const d = Math.min(...enemies.map(e => gridDistance(c, e.position!)))
            value += d <= maxRange + 3 ? W.offense : -0.1 * (d - maxRange - 3)
        }
        if (s.board[key].upgradeToken) { value += 1.5; parts.push({ label: 'Recoge un Upgrade', value: 1.5 }) }
        return { value, parts }
    }

    // ── Ataques posibles desde la posición actual (virtual) ──
    function attacks(): AttackOption[] {
        const out: AttackOption[] = []
        me.weapons.forEach((w: Weapon, wi) => {
            const free = canPrimary ? false : freeAttacks.includes(wi)
            if (!canPrimary && !free) return
            for (const key of attackableHexes(s, id!, wi)) {
                const t = targetAt(s, key, player)
                const p = t ? previewAttack(s, id!, w, key) : null
                if (!t || !p) continue
                const parts: PlanPart[] = []
                const kills = new Map<string, number>()
                let value = 0
                for (const tg of attackTargets(s, id!, w, key)) {
                    if (tg.kind === 'unit') {
                        const u = s.units[tg.id]
                        const sh = shieldsOf(u)
                        const dmg = Math.max(0, p.dice * p.hitChance + p.damageBonus - sh)
                        const kill = tg.key === key ? p.killChance : killProb(p.dice, p.hitChance, p.damageBonus, sh, u.currentHp)
                        // Cada punto de daño vale más cuanto más tocado está el objetivo (fuego concentrado)
                        const focus = 1 + 0.5 * (1 - u.currentHp / u.maxHp)
                        const v = W.damage * Math.min(dmg, u.currentHp) * (u.vp / 8) * focus + W.kill * kill * (u.vp + 2)
                        value += v; kills.set(u.id, kill)
                        parts.push({ label: `${w.name} contra ${nameOf(u)}: ≈${r1(dmg)} de daño${kill > 0.05 ? `, ${pct(kill)} de derribarla (+${u.vp} VP)` : ''}`, value: v })
                    } else {
                        const anyHit = 1 - (1 - p.hitChance) ** p.dice
                        const v = tg.kind === 'garrison' ? anyHit * 2 * W.garrison : anyHit * (s.rws[tg.id]?.vp ?? 2)
                        value += v
                        parts.push({ label: `${w.name} contra ${tg.kind === 'garrison' ? 'una Garrison' : 'una RWS'} (${pct(anyHit)} de destruirla)`, value: v })
                    }
                }
                const tl = free ? 0 : w.tlCost
                const action: GameAction = t.kind === 'unit' ? { type: 'ATTACK', unitId: id!, weaponIndex: wi, targetId: t.id }
                    : t.kind === 'rws' ? { type: 'ATTACK_RWS', unitId: id!, weaponIndex: wi, rwsId: t.id }
                        : { type: 'ATTACK_GARRISON', unitId: id!, weaponIndex: wi, garrisonId: t.id }
                out.push({ action, key, tl, value, parts, kills })
            }
        })
        return out
    }

    const plans: Plan[] = []
    const advanceKeys = canAdvance ? [...reachableFor(s, id, { kind: 'advance' }).keys()].filter(k => k !== here) : []
    const advance = (k: string): GameAction => ({ type: 'ADVANCE', unitId: id, to: keyToHex(k) })
    const tlPart = (tl: number): PlanPart[] => tl ? [{ label: `Gasta ${tl} TL`, value: -tl * W.tl }] : []
    // Mejor sitio donde terminar (quedarse o un Advance) tras el paso principal
    function bestEnd(tl: number, kills: Map<string, number>): { key: string; value: number; parts: PlanPart[] } | null {
        let best: { key: string; value: number; parts: PlanPart[] } | null = null
        for (const k of [here, ...advanceKeys]) {
            const p = position(k, tl, kills)
            if (p && (!best || p.value > best.value)) best = { key: k, ...p }
        }
        return best
    }
    function add(steps: GameAction[], gain: number, gainParts: PlanPart[], tl: number, end: { key: string; value: number; parts: PlanPart[] }, target: string | null) {
        const parts = [...gainParts, ...end.parts, ...tlPart(tl)]
        plans.push({ steps, score: gain + end.value - tl * W.tl, parts, end: end.key, target, tl })
    }
    const noKills = new Map<string, number>()

    // 1. Atacar desde aquí y luego, si puede, moverse
    if (canPrimary || freeAttacks.length) {
        for (const a of attacks()) {
            const end = bestEnd(a.tl, a.kills)
            if (end) add(end.key === here ? [a.action] : [a.action, advance(end.key)], a.value, a.parts, a.tl, end, a.key)
        }
        // 2. Avanzar y atacar desde el nuevo hex
        for (const k of advanceKeys) {
            withUnitAt(s, id, k, () => {
                for (const a of attacks()) {
                    const p = position(k, a.tl, a.kills)
                    if (p) add([advance(k), a.action], a.value, a.parts, a.tl, { key: k, ...p }, a.key)
                }
            })
        }
    }

    if (canPrimary) {
        // 3. Rescatar una Garrison propia (desde aquí o tras avanzar)
        const garrisonNear = (k: string) => Object.values(s.board).find(h => h.garrisonToken?.owner === player && gridDistance(h.coord, keyToHex(k)) === 1)
        const rescueGain = 2 * W.rescue
        const g0 = garrisonNear(here)
        if (g0) {
            const end = bestEnd(2, noKills)
            if (end) add(end.key === here ? [{ type: 'RESCUE', unitId: id, garrisonId: g0.garrisonToken!.id }] : [{ type: 'RESCUE', unitId: id, garrisonId: g0.garrisonToken!.id }, advance(end.key)],
                rescueGain, [{ label: 'Rescata una Garrison (+2 VP)', value: rescueGain }], 2, end, null)
        }
        for (const k of advanceKeys) {
            const g = garrisonNear(k)
            const p = g && position(k, 2, noKills)
            if (g && p) add([advance(k), { type: 'RESCUE', unitId: id, garrisonId: g.garrisonToken!.id }], rescueGain, [{ label: 'Rescata una Garrison (+2 VP)', value: rescueGain }], 2, { key: k, ...p }, null)
        }
        // 4. Energize (aquí o tras avanzar)
        const energyUse = me.abilities.some(a => (a.energyCost ?? 0) > 0) ? W.energy : W.energy * 0.3
        const eGain = energyUse * 2
        const eParts = [{ label: 'Gana 2 de Energy', value: eGain }]
        const endE = bestEnd(2, noKills)
        if (endE) add(endE.key === here ? [{ type: 'ENERGIZE', unitId: id }] : [{ type: 'ENERGIZE', unitId: id }, advance(endE.key)], eGain, eParts, 2, endE, null)
        // 5. Dash (y Advance después si aún no avanzó): para llegar lejos
        const dashKeys = [...reachableFor(s, id, { kind: 'dash' }).keys()].filter(k => k !== here)
        const scored = dashKeys.map(k => ({ k, p: position(k, 2, noKills) })).filter(x => x.p).sort((a, b) => b.p!.value - a.p!.value)
        for (const { k, p } of scored.slice(0, 6)) {
            add([{ type: 'DASH', unitId: id, to: keyToHex(k) }], 0, [], 2, { key: k, ...p! }, null)
            if (canAdvance) {
                withUnitAt(s, id, k, () => {
                    for (const k2 of reachableFor(s, id, { kind: 'advance' }).keys()) {
                        const p2 = position(k2, 2, noKills)
                        if (p2 && k2 !== k) add([{ type: 'DASH', unitId: id, to: keyToHex(k) }, advance(k2)], 0, [], 2, { key: k2, ...p2 }, null)
                    }
                })
            }
        }
    } else {
        // Ya hizo la acción principal: moverse si mejora, o terminar
        const end = bestEnd(0, noKills)
        if (end) add(end.key === here ? [{ type: 'END_ACTIVATION', unitId: id }] : [advance(end.key), { type: 'END_ACTIVATION', unitId: id }], 0, [], 0, end, null)
    }

    return plans.sort((a, b) => b.score - a.score)
}

// Las mejores jugadas distintas (por su primer paso y destino), para el consejero
export function suggestPlays(s: GameState, player: PlayerId, n = 3, W: PlannerWeights = ACTIVE): Plan[] {
    const seen = new Set<string>()
    const out: Plan[] = []
    for (const p of planActivation(s, player, W)) {
        const sig = `${JSON.stringify(p.steps[0])}|${p.end}`
        const kind = p.steps.map(x => x.type).join('+') + '|' + (p.target ?? '')
        if (seen.has(sig) || seen.has(kind)) continue
        seen.add(sig); seen.add(kind)
        out.push(p)
        if (out.length >= n) break
    }
    return out
}

// Texto de cada paso para el consejero
export function describeStep(s: GameState, a: GameAction): string {
    const unit = 'unitId' in a && typeof a.unitId === 'string' ? s.units[a.unitId] : null
    const weapon = unit && 'weaponIndex' in a && typeof a.weaponIndex === 'number' ? unit.weapons[a.weaponIndex]?.name : null
    switch (a.type) {
        case 'ADVANCE': return 'Advance hacia la casilla marcada'
        case 'DASH': return 'Dash hacia la casilla marcada'
        case 'ATTACK': return `Ataca a ${nameOf(s.units[a.targetId])} con ${weapon}`
        case 'ATTACK_GARRISON': return `Ataca a la Garrison con ${weapon}`
        case 'ATTACK_RWS': return `Ataca a la RWS con ${weapon}`
        case 'RESCUE': return 'Rescata la Garrison adyacente'
        case 'ENERGIZE': return 'Energize (+2 Energy)'
        case 'END_ACTIVATION': return 'Termina la activación'
        default: return a.type
    }
}

export function toSuggestion(s: GameState, p: Plan): import('../types').PlaySuggestion {
    return {
        steps: p.steps.map(a => describeStep(s, a)), actions: p.steps,
        score: r1(p.score), parts: p.parts.map(x => ({ label: x.label, value: r1(x.value) })),
        end: p.end, target: p.target, tl: p.tl,
    }
}
