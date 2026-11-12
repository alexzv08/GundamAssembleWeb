// Modelo STL de cada carta de unidad (por cardId). Las que no tienen modelo
// se dibujan con una forma genérica.
const MODELS: Record<string, string> = {
  'ST01-U01': 'Gundam.stl',
  'PA01-U01': 'Gundam.stl',
  'DM01-U01': 'Gundam.stl',
  'PA01-U02': 'Guncannon.stl',
  'DM01-U02': 'Guncannon.stl',
  'PA01-U03': 'GunTank.stl',
  'DM01-U03': 'GunTank.stl',
  'ST01-U04': "Char's Zaku.stl",
  'DM01-U04': "Char's Zaku.stl",
  'ST01-U03': 'Barbatos.stl',
  'DM01-U05': 'Zaku II.stl',
  'DM01-U06': 'Zaku.stl',
}

export const DEFAULT_MODEL_SCALE: [number, number, number] = [0.02, 0.02, 0.02]

export function modelUrlFor(cardId: string | undefined): string | null {
  const file = cardId ? MODELS[cardId] : undefined
  return file ? `/models/${encodeURIComponent(file)}` : null
}
