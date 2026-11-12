/**
 * seed-catalog.ts
 *
 * Puebla las tablas sets, units y commands en Supabase a partir de los
 * JSON locales. Es idempotente: usa upsert, se puede re-ejecutar sin riesgo.
 *
 * Uso:
 *   cd server
 *   npx tsx scripts/seed-catalog.ts
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── Tipos mínimos para leer los JSON (formato v2 de unit_library.json) ──────

interface WeaponJSON { name: string; tlCost: number; range: number; strength: number }

interface UnitCardJSON {
  cardId: string
  set: string
  name: string
  traits: string[]
  hp: number
  vp: number
  tl: number
  weapons: WeaponJSON[]
  abilities: unknown[]
}

interface CommandCardJSON {
  cardId: string
  name: string
  type: string
  faction: string
  effect: string
  effectData: unknown
}

// ── Cliente Supabase con service_role (se salta RLS) ────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Rutas de datos ───────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', 'data')
const UNITS_FILE    = path.join(DATA_DIR, 'units', 'unit_library.json')
const COMMANDS_FILE = path.join(DATA_DIR, 'cards', 'card_library.json')

// ── Helpers ──────────────────────────────────────────────────────────────────

function maxWeaponStat(weapons: WeaponJSON[], field: 'strength' | 'range'): number {
  return weapons.reduce((max, w) => Math.max(max, w[field] || 0), 0)
}

const FACTIONS = ['Earth Federation', 'Zeon', 'Asticassia', 'Gjallarhorn', 'Tekkadan', 'G Team', 'White Fang', 'OZ', 'Londo Bell']

function log(msg: string) {
  console.log(`[seed] ${msg}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('Iniciando seed del catálogo...')

  // 1. Sets (uno por prefijo de cardId: ST01, EX01, PA01, DM01...)
  const unitsRaw: { cards: UnitCardJSON[] } = JSON.parse(fs.readFileSync(UNITS_FILE, 'utf-8'))
  const setNames = new Map<string, string>()
  for (const card of unitsRaw.cards) setNames.set(card.cardId.split('-')[0], card.set)
  const setIds = new Map<string, string>()
  for (const [code, name] of setNames) {
    const { data, error } = await supabase
      .from('sets')
      .upsert({ code, name }, { onConflict: 'code' })
      .select('id')
      .single()
    if (error || !data) {
      console.error(`Error insertando set ${code}:`, error)
      process.exit(1)
    }
    setIds.set(code, data.id)
  }
  log(`${setIds.size} sets insertados/actualizados.`)

  // 2. Units
  log(`Procesando ${unitsRaw.cards.length} unidades...`)
  const unitRows = unitsRaw.cards.map(card => ({
    set_id:   setIds.get(card.cardId.split('-')[0]),
    code:     card.cardId,
    name:     card.name,
    pilot:    card.traits[0] ?? null,
    faction:  card.traits.find(t => FACTIONS.includes(t)) ?? null,
    cost:     card.tl,
    movement: 3,                                      // Advance básico
    attack:   maxWeaponStat(card.weapons, 'strength'),
    defense:  0,
    range:    maxWeaponStat(card.weapons, 'range'),
    hp:       card.hp,
    vp:       card.vp,
    role:     'Mobile Suit',
    abilities: card,                                  // ficha completa
  }))

  const { error: unitsError } = await supabase
    .from('units')
    .upsert(unitRows, { onConflict: 'code' })

  if (unitsError) {
    console.error('Error insertando units:', unitsError)
    process.exit(1)
  }
  log(`${unitRows.length} unidades insertadas/actualizadas.`)

  // 3. Commands
  const commandsRaw: { cards: CommandCardJSON[] } = JSON.parse(fs.readFileSync(COMMANDS_FILE, 'utf-8'))
  log(`Procesando ${commandsRaw.cards.length} cartas de táctica...`)

  const commandRows = commandsRaw.cards.map(card => ({
    set_id:  setIds.get('DM01') ?? [...setIds.values()][0],
    code:    card.cardId,
    name:    card.name,
    faction: card.faction,
    cost:    0,
    timing:  card.type,   // 'command' | 'response'
    effect:  {
      text:       card.effect,
      effectData: card.effectData ?? null,
    },
  }))

  const { error: commandsError } = await supabase
    .from('commands')
    .upsert(commandRows, { onConflict: 'code' })

  if (commandsError) {
    console.error('Error insertando commands:', commandsError)
    process.exit(1)
  }
  log(`${commandRows.length} cartas insertadas/actualizadas.`)

  log('✓ Seed completado.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
