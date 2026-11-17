import type { GameState, PlayerId } from '../../types/gameState'
import { C, FONT, button } from '../../theme'

interface MesaBarProps {
  gameState: GameState
  seatId: PlayerId
  acting: PlayerId
  onUndo: () => void
  onNobodyResponds?: () => void
  compact?: boolean
}

// Modo mesa: quién debe decidir ahora en la mesa real, y los atajos para apuntarlo
// (Deshacer y "Nadie responde", que pasa todas las ventanas de Response del ataque).
export function MesaBar({ gameState, seatId, acting, onUndo, onNobodyResponds, compact = false }: MesaBarProps) {
  const mine = acting === seatId
  const rival = gameState.players[acting].name
  const color = mine ? C.ally : C.enemy
  const what = gameState.pendingDice ? 'mete los dados de la tirada'
    : gameState.pendingResponse ? '¿juega alguna Response?'
      : gameState.pendingForcedMove ? 'elige el hex del Push / Pull'
        : 'apunta su activación'
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: `6px max(12px, env(safe-area-inset-left, 0px))`, background: mine ? C.allyDeep + '66' : C.enemyDeep + '88',
      borderBottom: `1px solid ${color}55`, fontSize: compact ? 12.5 : 13.5,
    }}>
      <span style={{ fontFamily: FONT.mono, fontSize: 10.5, letterSpacing: '0.14em', color: C.textSoft }}>MESA</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontFamily: FONT.display, color }}>{mine ? 'Tú' : rival}</b>: {what}
      </span>
      {onNobodyResponds && gameState.pendingResponse && !gameState.pendingDice && (
        <button type="button" onClick={onNobodyResponds} style={{ ...button('subtle'), padding: '6px 10px' }}
          title="Pasa todas las ventanas de Response de esta acción, de los dos jugadores">Nadie responde</button>
      )}
      <button type="button" onClick={onUndo} style={{ ...button('ghost'), padding: '6px 10px' }} title="Vuelve al estado anterior a la última acción apuntada">Deshacer</button>
    </div>
  )
}
