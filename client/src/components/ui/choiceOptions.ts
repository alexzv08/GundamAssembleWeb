export interface ChoiceOption { value: string; label: string }

export const UPGRADE_OPTIONS: ChoiceOption[] = [
  { value: 'attack', label: '⚔ Strength' },
  { value: 'shield', label: '🛡 Shield' },
  { value: 'movement', label: '👟 Speed' },
]
