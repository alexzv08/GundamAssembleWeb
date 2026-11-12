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
