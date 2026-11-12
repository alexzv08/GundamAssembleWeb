// Reglas de construcción de escuadra y mazo (Core Rulebook v1.2, "Squad and
// Deck Building"). Código puro compartido por servidor (validación) y cliente
// (pantalla de selección).

export interface SquadCard { cardId: string; name: string; traits: string[]; signature?: string }
export interface DeckCard { id: string; name: string; faction: string; signature?: string }

export const DECK_SIZE = 9
export const DEFAULT_SQUAD_SIZE = 3

export function isMassProduced(card: SquadCard): boolean {
  return card.traits.includes('Mass Produced')
}

// Escuadra: el tamaño lo marca el escenario (3 o 5). No se puede repetir el
// mismo número de carta salvo unidades Mass Produced.
export function validateSquad(unitCardIds: string[], catalog: SquadCard[], squadSize = DEFAULT_SQUAD_SIZE): string | null {
  if (!Array.isArray(unitCardIds) || unitCardIds.length !== squadSize) {
    return `La escuadra debe tener exactamente ${squadSize} unidades`
  }
  const seen = new Set<string>()
  for (const id of unitCardIds) {
    const card = catalog.find(c => c.cardId === id)
    if (!card) return `Unidad desconocida: ${id}`
    if (seen.has(id) && !isMassProduced(card)) {
      return `No puedes repetir ${card.name}: solo las unidades Mass Produced admiten copias`
    }
    seen.add(id)
  }
  return null
}

// Motivo por el que una carta no puede ir en el mazo de esta escuadra (o null).
export function cardRestriction(card: DeckCard, squad: SquadCard[]): string | null {
  if (card.faction && !squad.some(u => u.traits.includes(card.faction))) {
    return `Requiere una unidad con el rasgo ${card.faction}`
  }
  if (card.signature && !squad.some(u => u.signature === card.signature)) {
    return `Requiere la unidad "${card.signature}"`
  }
  return null
}

function squadOf(unitCardIds: string[], units: SquadCard[]): SquadCard[] {
  return unitCardIds.map(id => units.find(u => u.cardId === id)).filter((u): u is SquadCard => !!u)
}

export function eligibleCards<T extends DeckCard>(unitCardIds: string[], units: SquadCard[], cards: T[]): T[] {
  const squad = squadOf(unitCardIds, units)
  return cards.filter(c => cardRestriction(c, squad) === null)
}

// El mazo tiene exactamente 9 cartas. Mientras el catálogo de cartas sea
// pequeño, si la escuadra tiene menos de 9 elegibles se exige incluirlas todas.
export function requiredDeckSize(unitCardIds: string[], units: SquadCard[], cards: DeckCard[]): number {
  return Math.min(DECK_SIZE, eligibleCards(unitCardIds, units, cards).length)
}

export function validateDeck(cardIds: string[], unitCardIds: string[], units: SquadCard[], cards: DeckCard[]): string | null {
  const size = requiredDeckSize(unitCardIds, units, cards)
  if (!Array.isArray(cardIds) || cardIds.length !== size) return `El mazo debe tener exactamente ${size} cartas`
  if (new Set(cardIds).size !== cardIds.length) return 'Solo se permite una copia de cada carta'
  const squad = squadOf(unitCardIds, units)
  for (const id of cardIds) {
    const card = cards.find(c => c.id === id)
    if (!card) return `Carta desconocida: ${id}`
    const why = cardRestriction(card, squad)
    if (why) return `"${card.name}": ${why.toLowerCase()}`
  }
  return null
}
