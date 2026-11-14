// Sistema visual del juego: "mesa táctica holográfica".
// Fondo azul marino, acentos cian (tú) y rojo (rival), ámbar para el turno y los
// avisos. Los colores del jugador son RELATIVOS a quien mira: tú siempre en cian,
// el rival siempre en rojo, en todas las pantallas (Timeline, tablero, paneles).
import type { CSSProperties } from 'react'
import type { PlayerId } from './types'

export const C = {
  bg: '#0a0f1e',          // fondo de la app
  bgDeep: '#060a15',      // fondo de la escena 3D / laterales
  panel: 'rgba(14, 20, 38, 0.94)',
  panelSolid: '#0e1426',
  panelRaised: '#151d36',
  line: '#24304f',        // bordes y separadores
  lineStrong: '#34426a',
  text: '#e6ebf5',
  textSoft: '#aab4cc',    // secundario (contraste ≥ 7:1 sobre bg)
  textDim: '#8590ab',     // terciario (contraste ≥ 4.5:1 sobre bg)
  ally: '#4fc3f7',        // tú
  allyDeep: '#0d3b57',
  enemy: '#ff5a5f',       // rival
  enemyDeep: '#4a1418',
  amber: '#f5c518',       // turno activo, objetivos, avisos
  amberDeep: '#3a2f05',
  ok: '#66bb6a',
  warn: '#ffa040',
  danger: '#ff5a5f',
  // Tipos de habilidad / carta (siempre con etiqueta, nunca solo color)
  command: '#ff8a3d',
  response: '#b388ff',
  ongoing: '#66bb6a',
  attack: '#ff5a5f',
  setup: '#90a4ae',
} as const

export const FONT = {
  display: "'Chakra Petch', 'Segoe UI', system-ui, sans-serif",
  body: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
} as const

// Color de un jugador visto por `me` (null = espectador: J1 cian, J2 rojo)
export function sideColor(player: PlayerId | 'neutral' | null | undefined, me: PlayerId | null | undefined): string {
  if (!player) return C.textDim
  if (player === 'neutral') return C.textSoft
  if (!me) return player === 'player1' ? C.ally : C.enemy
  return player === me ? C.ally : C.enemy
}

export function sideDeep(player: PlayerId | 'neutral' | null | undefined, me: PlayerId | null | undefined): string {
  return sideColor(player, me) === C.ally ? C.allyDeep : C.enemyDeep
}

// Etiqueta pequeña en mayúsculas (cabeceras de sección)
export const eyebrow: CSSProperties = {
  fontFamily: FONT.mono, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textDim,
}

// Botón base del HUD. variant: primary (acción principal), ghost, danger, subtle
export function button(variant: 'primary' | 'ghost' | 'danger' | 'subtle' | 'amber' = 'ghost', disabled = false): CSSProperties {
  const palette = {
    primary: { bg: C.allyDeep, border: C.ally, color: C.text },
    amber: { bg: C.amberDeep, border: C.amber, color: C.text },
    danger: { bg: C.enemyDeep, border: C.enemy, color: C.text },
    ghost: { bg: 'transparent', border: C.lineStrong, color: C.text },
    subtle: { bg: C.panelRaised, border: C.line, color: C.textSoft },
  }[variant]
  return {
    fontFamily: FONT.body, fontSize: 12, fontWeight: 500,
    padding: '6px 11px', borderRadius: 6, whiteSpace: 'nowrap',
    background: disabled ? 'transparent' : palette.bg,
    border: `1px solid ${disabled ? C.line : palette.border}`,
    color: disabled ? C.textDim : palette.color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'background 120ms, border-color 120ms',
  }
}

export const ABILITY_TYPE: Record<'CMD' | 'ONG' | 'RSP' | 'SETUP', { color: string; label: string }> = {
  CMD: { color: C.command, label: 'Command' },
  ONG: { color: C.ongoing, label: 'Ongoing' },
  RSP: { color: C.response, label: 'Response' },
  SETUP: { color: C.setup, label: 'Setup' },
}

export function chip(color: string): CSSProperties {
  return {
    fontFamily: FONT.mono, fontSize: 9.5, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase',
    color, border: `1px solid ${color}`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap',
  }
}

// Tipos de carta de Tactics: color, nombre y glifo
export const CARD_TYPE: Record<'attack' | 'command' | 'response', { color: string; label: string; glyph: string }> = {
    attack: { color: C.attack, label: 'Attack', glyph: '✕' },
    command: { color: C.command, label: 'Command', glyph: '▲' },
    response: { color: C.response, label: 'Response', glyph: '◆' },
}
