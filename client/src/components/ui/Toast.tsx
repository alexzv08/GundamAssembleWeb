import type { ToastItem } from './useToasts'
import { C, FONT } from '../../theme'

// Avisos breves abajo en el centro del tablero; el tooltip de fichas va con ellos.
export function ToastContainer({ toasts, tooltip }: { toasts: ToastItem[]; tooltip?: string | null }) {
    if (toasts.length === 0 && !tooltip) return null
    return (
        <div style={{
            position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column-reverse', gap: 6, zIndex: 50, pointerEvents: 'none',
            alignItems: 'center', maxWidth: 'calc(100% - 32px)',
        }}>
            {tooltip && (
                <div style={{ background: C.panel, border: `1px solid ${C.lineStrong}`, borderRadius: 8, padding: '6px 14px', color: C.text, fontSize: 12.5, textAlign: 'center' }}>
                    {tooltip}
                </div>
            )}
            {/* Como mucho los dos más recientes: no deben tapar el tablero */}
            {toasts.slice(-2).map(t => (
                <div key={t.id} style={{
                    background: C.panel, border: `1px solid ${t.color}`, borderLeft: `3px solid ${t.color}`, borderRadius: 6,
                    padding: '6px 16px', color: C.text, fontFamily: FONT.display, fontSize: 13.5, fontWeight: 600,
                    letterSpacing: '0.02em', textAlign: 'center', boxShadow: `0 4px 18px ${t.color}33`,
                    animation: 'ga-rise 160ms ease-out',
                }}>
                    {t.message}
                </div>
            ))}
        </div>
    )
}
