import { useEffect, useState } from 'react'
import type { AttackReport, GameState, PlayerId } from '../../types/gameState'
import { C, FONT, sideColor } from '../../theme'

// Bandeja de dados (H10): aparece con cada ataque nuevo y se va sola.
// Muestra los d10 tal como salieron (1 = fallo seguro, 9-10 = crítico) y el
// resultado que calculó el servidor (impactos, críticos y daño por objetivo).
export function DiceTray({ gameState, myPlayerId }: { gameState: GameState; myPlayerId: PlayerId | null }) {
  const report = gameState.lastAttack
  const [shown, setShown] = useState<AttackReport | null>(null)
  const [hiddenFor, setHiddenFor] = useState<AttackReport | null>(null)

  // Mostrar el informe nuevo durante unos segundos
  if (report && report !== shown && report !== hiddenFor && JSON.stringify(report) !== JSON.stringify(shown)) {
    setShown(report)
  }
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setHiddenFor(shown), 5000)
    return () => clearTimeout(t)
  }, [shown])

  if (!shown || hiddenFor === shown) return null
  const attacker = gameState.units[shown.attackerId]
  const color = sideColor(attacker?.playerId, myPlayerId)
  const targetName = (t: AttackReport['targets'][number]) =>
    t.kind === 'unit' ? gameState.units[t.id]?.name ?? 'objetivo' : t.kind === 'rws' ? gameState.rws[t.id]?.name ?? 'RWS' : 'Garrison'

  return (
    <div role="status" onClick={() => setHiddenFor(shown)} style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 26,
      background: C.panel, border: `1px solid ${color}`, borderRadius: 10, padding: '10px 14px',
      boxShadow: `0 0 24px ${color}33, 0 10px 30px rgba(0,0,0,0.5)`, color: C.text,
      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', cursor: 'pointer',
      maxWidth: 'calc(100% - 32px)', animation: 'ga-rise 180ms ease-out',
    }}>
      <div style={{ fontSize: 12.5, textAlign: 'center' }}>
        <b style={{ color }}>{attacker?.shortName ?? attacker?.name ?? '?'}</b>
        <span style={{ color: C.textSoft }}> ataca con </span>{shown.weaponName}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
        {shown.rolls.map((r, i) => {
          const crit = r >= 9, miss = r === 1
          return (
            <span key={i} style={{
              width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 6,
              fontFamily: FONT.mono, fontSize: 15, fontWeight: 600,
              background: crit ? C.amberDeep : miss ? 'transparent' : C.panelRaised,
              border: `1px solid ${crit ? C.amber : miss ? C.line : C.lineStrong}`,
              color: crit ? C.amber : miss ? C.textDim : C.text,
              textDecoration: miss ? 'line-through' : 'none',
              animation: `ga-rise 200ms ease-out ${i * 70}ms both`,
            }}>{r}</span>
          )
        })}
      </div>
      {shown.targets.map((t, i) => (
        <div key={i} style={{ fontSize: 12.5, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ color: C.textSoft }}>{targetName(t)}:</span>
          <span><b>{t.hits}</b> {t.hits === 1 ? 'impacto' : 'impactos'}</span>
          {t.crits > 0 && <span style={{ color: C.amber }}>crítico</span>}
          <span style={{ color: t.damage ? C.danger : C.textSoft }}><b>{t.damage}</b> de daño</span>
          {t.defeated && <span style={{ color: C.danger, fontWeight: 700 }}>¡Derrotado!</span>}
        </div>
      ))}
      {shown.rerolled.length > 0 && <div style={{ fontSize: 11, color: C.textDim }}>Repetidos: {shown.rerolled.join(', ')}</div>}
    </div>
  )
}
