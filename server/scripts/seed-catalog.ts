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

// ── Tipos mínimos para leer los JSON ────────────────────────────────────────

interface WeaponJSON {
  name: string
  cost: string
  range: string
  str: string
  effect: string
  crit: string
  dots: number
  effectData: unknown
  critData: unknown
}

interface AbilityJSON {
  name: string
  type: string
  tags: string
  effect: string
  abilityData: unknown
}

interface UnitCardJSON {
  cardId: string
  unitName: string
  pilot: string
  faction: string
  hp: string
  vp: string
  tl: string
  weapons: WeaponJSON[]
  abilities: AbilityJSON[]
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

function maxWeaponStat(weapons: WeaponJSON[], field: 'str' | 'range'): number {
  return weapons.reduce((max, w) => Math.max(max, parseInt(w[field]) || 0), 0)
}

function log(msg: string) {
  console.log(`[seed] ${msg}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('Iniciando seed del catálogo...')

  // 1. Upsert del set base DM01
  log('Insertando set DM01...')
  const { data: setData, error: setError } = await supabase
    .from('sets')
    .upsert({ code: 'DM01', name: 'Gundam Assemble — Base Set', released_at: '2026-01-01' }, { onConflict: 'code' })
    .select('id')
    .single()

  if (setError || !setData) {
    console.error('Error insertando set:', setError)
    process.exit(1)
  }
  const setId = setData.id
  log(`Set DM01 id: ${setId}`)

  // 2. Units
  const unitsRaw: { cards: UnitCardJSON[] } = JSON.parse(fs.readFileSync(UNITS_FILE, 'utf-8'))
  log(`Procesando ${unitsRaw.cards.length} unidades...`)

  const unitRows = unitsRaw.cards.map(card => ({
    set_id:   setId,
    code:     card.cardId,
    name:     card.unitName,
    pilot:    card.pilot,
    faction:  card.faction,
    cost:     parseInt(card.tl),
    movement: 3,                                      // valor por defecto del motor
    attack:   maxWeaponStat(card.weapons, 'str'),
    defense:  0,                                      // sin stat de defensa base
    range:    maxWeaponStat(card.weapons, 'range'),
    hp:       parseInt(card.hp),
    vp:       parseInt(card.vp),
    role:     'Mobile Suit',
    abilities: {
      weapons:   card.weapons,
      abilities: card.abilities,
    },
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
    set_id:  setId,
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
