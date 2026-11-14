// Arte oficial de las cartas (aportado por el autor, en public/cards):
//  - units/<cardId>.webp      carta de unidad completa (800×567)
//  - portraits/<cardId>.webp  retrato circular recortado de la carta (192×192)
//  - tactics/<cardId>.webp    carta de Tactics completa (560 px de ancho)
// Las cartas de la demo no tienen arte: se dibujan con su diseño de texto.
const OFFICIAL_UNIT = /^(ST01|EX01|EX02|PA01)-U\d{2}$/
const OFFICIAL_TACTICS = /^(ST01|EX01|EX02|PA01)-T\d{2}$/

export function unitCardArt(cardId?: string | null): string | null {
  return cardId && OFFICIAL_UNIT.test(cardId) ? `/cards/units/${cardId}.webp` : null
}

export function unitPortrait(cardId?: string | null): string | null {
  return cardId && OFFICIAL_UNIT.test(cardId) ? `/cards/portraits/${cardId}.webp` : null
}

export function tacticsArt(cardId?: string | null): string | null {
  return cardId && OFFICIAL_TACTICS.test(cardId) ? `/cards/tactics/${cardId}.webp` : null
}
