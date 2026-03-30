import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()
const MAPS_DIR = path.join(__dirname, '../../data/maps')

// GET /api/maps — lista todos los mapas disponibles
router.get('/', (_req: Request, res: Response) => {
    try {
        const files = fs.readdirSync(MAPS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                id: f.replace('.json', ''),
                name: f.replace('.json', '').replace(/([A-Z])/g, ' $1').trim(),
                file: f,
            }))
        res.json({ maps: files })
    } catch (err) {
        res.status(500).json({ error: 'Error leyendo mapas' })
    }
})

// GET /api/maps/:id — devuelve un mapa concreto
router.get('/:id', (req: Request, res: Response) => {
    try {
        const filePath = path.join(MAPS_DIR, `${req.params.id}.json`)
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Mapa no encontrado' })
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        res.json(data)
    } catch (err) {
        res.status(500).json({ error: 'Error leyendo mapa' })
    }
})

// POST /api/maps/community — subir mapa de comunidad
router.post('/community', (req: Request, res: Response) => {
    try {
        const { name, map } = req.body
        if (!name || !map) return res.status(400).json({ error: 'Faltan datos' })

        // Sanitizar nombre
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
        const communityDir = path.join(MAPS_DIR, 'community')
        if (!fs.existsSync(communityDir)) fs.mkdirSync(communityDir)

        const filePath = path.join(communityDir, `${safeName}.json`)
        fs.writeFileSync(filePath, JSON.stringify({ ...map, author: name, version: 1 }, null, 2))

        res.json({ ok: true, id: `community/${safeName}` })
    } catch (err) {
        res.status(500).json({ error: 'Error guardando mapa' })
    }
})

export default router