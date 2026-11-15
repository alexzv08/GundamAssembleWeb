import type { AttackPreview } from '../../types/gameState'
import { C, FONT, eyebrow } from '../../theme'

const pct = (x: number) => `${Math.round(x * 100)} %`

// Previsión del ataque bajo el ratón: lo calcula el servidor con las mismas
// reglas que la resolución real (sin contar las Response, que aún no se conocen).
export function AttackPreviewBox({ preview, targetName }: { preview: AttackPreview; targetName: string }) {
  const row = (label: string, value: string, color: string = C.text) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: C.textSoft }}>{label}</span>
      <span style={{ fontFamily: FONT.mono, color }}>{value}</span>
    </div>
  )
  return (
    <div role="status" style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 27, pointerEvents: 'none',
      background: C.panel, border: `1px solid ${C.enemy}`, borderRadius: 10, padding: '10px 14px', minWidth: 240,
      fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
    }}>
      <span style={{ ...eyebrow, color: C.enemy }}>Previsión · {targetName}</span>
      {row('Dados', `${preview.dice} d10`)}
      {row('Accuracy', preview.accuracy > 0 ? `+${preview.accuracy}` : String(preview.accuracy), preview.accuracy < 0 ? C.warn : C.text)}
      {row('Impacto por dado', pct(preview.hitChance))}
      {row('Impactos esperados', preview.expectedHits.toFixed(1))}
      {preview.shields > 0 && row('Shields del objetivo', `−${preview.shields}`, C.warn)}
      {preview.damageBonus > 0 && row('Daño extra', `+${preview.damageBonus}`)}
      {row('Daño esperado', preview.expectedDamage.toFixed(1), C.amber)}
      {row('Algún crítico', pct(preview.critChance))}
      {preview.killChance > 0 && row('Lo derrota', pct(preview.killChance), C.danger)}
      {preview.targets > 1 && row('Objetivos alcanzados', String(preview.targets))}
      <span style={{ color: C.textDim, fontSize: 11 }}>Sin contar Response ni efectos de crítico.</span>
    </div>
  )
}
