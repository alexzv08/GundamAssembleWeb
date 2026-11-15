// Enlaces para compartir: unirse a una sala, verla como espectador o abrir una
// repetición. Se leen una vez al conectar y se quitan de la barra de direcciones.
export type LinkKind = 'sala' | 'ver' | 'repeticion'

export function shareUrl(kind: LinkKind, id: string): string {
  return `${window.location.origin}${window.location.pathname}?${kind}=${encodeURIComponent(id)}`
}

export function readLink(): { kind: LinkKind; id: string } | null {
  const params = new URLSearchParams(window.location.search)
  for (const kind of ['sala', 'ver', 'repeticion'] as const) {
    const id = params.get(kind)?.trim()
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) return { kind, id }
  }
  return null
}

export function clearLink(): void {
  const url = new URL(window.location.href)
  for (const k of ['sala', 'ver', 'repeticion']) url.searchParams.delete(k)
  window.history.replaceState(null, '', url.pathname + (url.search === '?' ? '' : url.search) + url.hash)
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false)
}
