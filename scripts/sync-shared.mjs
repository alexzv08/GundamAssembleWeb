#!/usr/bin/env node
// Copia el código compartido desde el servidor (fuente única de verdad) al cliente.
// Uso: node scripts/sync-shared.mjs          → copia
//      node scripts/sync-shared.mjs --check  → falla si las copias del cliente están desactualizadas
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HEADER = '// AUTO-GENERADO por scripts/sync-shared.mjs desde server/src — NO EDITAR AQUÍ.\n'

export const SHARED_FILES = [
  ['server/src/types/units.ts', 'client/src/types/units.ts'],
  ['server/src/types/board.ts', 'client/src/types/board.ts'],
  ['server/src/types/timeline.ts', 'client/src/types/timeline.ts'],
  ['server/src/types/tactics.ts', 'client/src/types/tactics.ts'],
  ['server/src/types/gameState.ts', 'client/src/types/gameState.ts'],
  ['server/src/types/index.ts', 'client/src/types/index.ts'],
  ['server/src/game/hexGrid.ts', 'client/src/game/hexGrid.ts'],
  ['server/src/game/timeline.ts', 'client/src/game/timeline.ts'],
  ['server/src/game/queries.ts', 'client/src/game/queries.ts'],
  ['server/src/game/deckRules.ts', 'client/src/game/deckRules.ts'],
]

const check = process.argv.includes('--check')
let stale = []
for (const [src, dst] of SHARED_FILES) {
  const expected = HEADER + readFileSync(join(root, src), 'utf8')
  const current = existsSync(join(root, dst)) ? readFileSync(join(root, dst), 'utf8') : null
  if (current === expected) continue
  if (check) stale.push(dst)
  else { writeFileSync(join(root, dst), expected); console.log(`sync ${src} → ${dst}`) }
}
if (check && stale.length) {
  console.error('Copias desactualizadas (ejecuta `node scripts/sync-shared.mjs`):\n  ' + stale.join('\n  '))
  process.exit(1)
}
