import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()
const UNITS_FILE = path.join(__dirname, '../../data/units/unit_library.json')

router.get('/', (_req: Request, res: Response) => {
    try {
        const data = JSON.parse(fs.readFileSync(UNITS_FILE, 'utf-8'))
        res.json(data)
    } catch (err) {
        res.status(500).json({ error: 'Error leyendo unidades' })
    }
})

export default router