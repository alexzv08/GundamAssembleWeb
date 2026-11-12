import type { ToastItem } from './useToasts'

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
    if (toasts.length === 0) return null
    return (
        <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', gap: 6,
            zIndex: 50, pointerEvents: 'none', alignItems: 'center',
        }}>
            {toasts.map(t => (
                <div key={t.id} style={{
                    background: 'rgba(10,10,20,0.96)',
                    border: `1px solid ${t.color}`,
                    borderRadius: 8,
                    padding: '7px 20px',
                    color: t.color,
                    fontSize: 13,
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    boxShadow: `0 2px 14px ${t.color}44`,
                }}>
                    {t.message}
                </div>
            ))}
        </div>
    )
}
