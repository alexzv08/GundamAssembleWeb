import { useState, useCallback } from 'react'

export interface ToastItem {
    id: number
    message: string
    color: string
}

let _nextId = 0

export function useToasts() {
    const [toasts, setToasts] = useState<ToastItem[]>([])

    const addToast = useCallback((message: string, color = '#f5c518', duration = 3500) => {
        const id = ++_nextId
        setToasts(prev => [...prev, { id, message, color }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
    }, [])

    return { toasts, addToast }
}

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
