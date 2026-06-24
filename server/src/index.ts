import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { roomManager } from './rooms/roomManager'
import { registerGameEvents } from './socket/gameEvents'
import mapsRouter from './routes/maps'
import unitsRouter from './routes/units'
import cardsRouter from './routes/cards'
import authRouter from './routes/auth'
import { supabaseAdmin } from './lib/supabase'

const app = express()
const http = createServer(app)
const ALLOWED_ORIGINS = process.env.CLIENT_URL
    ? [process.env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:5174']
    : ['http://localhost:5173', 'http://localhost:5174']

const io = new Server(http, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] }
})

app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json())

// Rutas API
app.use('/api/maps', mapsRouter)
app.use('/api/units', unitsRouter)
app.use('/api/cards', cardsRouter)
app.use('/api/auth', authRouter)

app.get('/health', (_, res) => res.json({ ok: true }))

io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next(new Error('AUTH_REQUIRED'))
    try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
        if (error || !user) return next(new Error('AUTH_INVALID'))
        socket.data.userId = user.id
        socket.data.userName = (user.user_metadata?.full_name as string)
            || (user.user_metadata?.name as string)
            || user.email
            || 'Jugador'
        next()
    } catch {
        next(new Error('AUTH_ERROR'))
    }
})

io.on('connection', socket => {
    registerGameEvents(io, socket, roomManager)
    socket.on('disconnect', () => {
        roomManager.handleDisconnect(socket.id, io)
    })
})

const PORT = process.env.PORT ?? 3001
http.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`))