import { Router, Request, Response } from 'express'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'
import { listMaps, mapExists } from '../game/maps'

const router = Router()
const MAPS_DIR = path.join(__dirname, '../../data/maps')

// GET /api/maps — lista los mapas disponibles
router.get('/', (_req: Request, res: Response) => {
    try {
        res.json({ maps: listMaps() })
    } catch {
        res.status(500).json({ error: 'Error leyendo mapas' })
    }
})

// GET /api/maps/:id — devuelve un mapa concreto (solo ids simples: nada de rutas)
router.get('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id)
    if (!mapExists(id)) return res.status(404).json({ error: 'Mapa no encontrado' })
    try {
        res.json(JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${id}.json`), 'utf-8')))
    } catch {
        res.status(500).json({ error: 'Error leyendo mapa' })
    }
})

// POST /api/maps/community — subir un mapa de la comunidad.
// Requiere sesión (token de Supabase) y como mucho 200 KB.
router.post('/community', express.json({ limit: '200kb' }), async (req: Request, res: Response) => {
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'No token' })
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) return res.status(401).json({ error: 'Invalid token' })

    try {
        const { name, map } = req.body ?? {}
        if (typeof name !== 'string' || !map || typeof map !== 'object') return res.status(400).json({ error: 'Faltan datos' })
        if (!Array.isArray(map.grid) || typeof map.cols !== 'number' || typeof map.rows !== 'number') {
            return res.status(400).json({ error: 'Formato de mapa no válido' })
        }
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'mapa'
        const communityDir = path.join(MAPS_DIR, 'community')
        if (!fs.existsSync(communityDir)) fs.mkdirSync(communityDir)
        const id = `${safeName}_${user.id.slice(0, 8)}`
        fs.writeFileSync(path.join(communityDir, `${id}.json`), JSON.stringify({ ...map, author: user.id, version: 1 }, null, 2))
        res.json({ ok: true, id: `community/${id}` })
    } catch {
        res.status(500).json({ error: 'Error guardando mapa' })
    }
})

export default router
