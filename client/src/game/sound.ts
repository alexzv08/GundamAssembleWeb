// Efectos de sonido sintetizados con WebAudio (sin ficheros de audio).
// El silencio se recuerda en localStorage cuando está disponible.
let ctx: AudioContext | null = null
let muted = false
try { muted = localStorage.getItem('ga-muted') === '1' } catch { /* sin almacenamiento */ }

export function isMuted(): boolean { return muted }
export function setMuted(value: boolean): void {
  muted = value
  try { localStorage.setItem('ga-muted', value ? '1' : '0') } catch { /* sin almacenamiento */ }
}

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0, slideTo?: number) {
  const a = audio()
  if (!a) return
  const t = a.currentTime + delay
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(g).connect(a.destination)
  osc.start(t)
  osc.stop(t + duration)
}

export const sfx = {
  dice: () => { for (let i = 0; i < 5; i++) tone(300 + Math.random() * 500, 0.04, 'square', 0.03, i * 0.05) },
  hit: () => tone(180, 0.18, 'sawtooth', 0.07, 0, 60),
  defeat: () => { tone(220, 0.5, 'sawtooth', 0.09, 0, 40); tone(110, 0.6, 'triangle', 0.08, 0.05, 30) },
  myTurn: () => { tone(660, 0.12, 'sine', 0.06); tone(880, 0.16, 'sine', 0.06, 0.12) },
  move: () => tone(420, 0.08, 'triangle', 0.04, 0, 520),
  chat: () => tone(1200, 0.06, 'sine', 0.04),
}
