// Modelo 3D (GLB comprimido) de cada carta de unidad, por cardId. Las que no
// tienen modelo se dibujan con una pieza genérica. Los originales STL están en
// assets-src/models y se convierten con tools/stl-to-glb.mjs.
const MODELS: Record<string, string> = {
  'ST01-U01': 'Gundam.glb',
  'PA01-U01': 'Gundam.glb',
  'DM01-U01': 'Gundam.glb',
  'PA01-U02': 'Guncannon.glb',
  'DM01-U02': 'Guncannon.glb',
  'PA01-U03': 'GunTank.glb',
  'DM01-U03': 'GunTank.glb',
  'ST01-U04': "Char's Zaku.glb",
  'DM01-U04': "Char's Zaku.glb",
  'ST01-U03': 'Barbatos.glb',
  'DM01-U05': 'Zaku II.glb',
  'DM01-U06': 'Zaku.glb',
}

// Los GLB vienen a escala de miniatura (~1,1 de alto); en el tablero se
// agrandan un poco para que se lean bien frente al hex.
export const DEFAULT_MODEL_SCALE: [number, number, number] = [1.3, 1.3, 1.3]

export function modelUrlFor(cardId: string | undefined): string | null {
  const file = cardId ? MODELS[cardId] : undefined
  return file ? `/models/${encodeURIComponent(file)}` : null
}
