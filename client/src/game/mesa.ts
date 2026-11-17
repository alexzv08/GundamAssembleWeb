// Modo mesa: el mazo del rival no se conoce y su "mano" son todas las cartas que
// podría llevar (unas 30). Para que se pueda elegir la que ha jugado, solo se
// enseñan las que tienen sentido ahora: en una ventana de Response, las que puede
// jugar; en su activación, las que no son Response y puede usar la unidad activa.
import type { GameState, PlayerId } from '../types/gameState'
import type { TacticsCard } from '../types/tactics'
import { canPlayResponseCard } from './queries'

export function mesaHand(state: GameState, acting: PlayerId, seat: PlayerId | null): TacticsCard[] {
  const hand = state.players[acting].tactics.hand
  if (!state.mesa || acting === seat) return hand
  if (state.pendingResponse?.forPlayerId === acting) return hand.filter(c => canPlayResponseCard(state, acting, c))
  const unit = state.activeUnitId ? state.units[state.activeUnitId] : null
  return hand.filter(c => c.type !== 'response' && (!c.signature || c.signature === unit?.signature))
}
