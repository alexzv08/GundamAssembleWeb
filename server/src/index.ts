import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { roomManager } from './rooms/roomManager'
import { registerGameEvents } from './socket/gameEvents'
import mapsRouter from './routes/maps'
import unitsRouter from './routes/units'
import cardsRouter from './routes/cards'

const app = express()
const http = createServer(app)
const io = new Server(http, {
    cors: { origin: 'http://localhost:5173', methods: ['GET', 'POST'] }
})

app.use(cors())
app.use(express.json())

// Rutas API
app.use('/api/maps', mapsRouter)
app.use('/api/units', unitsRouter)
app.use('/api/cards', cardsRouter)

app.get('/health', (_, res) => res.json({ ok: true }))

io.on('connection', socket => {
    console.log(`Cliente conectado: ${socket.id}`)
    registerGameEvents(io, socket, roomManager)
    socket.on('disconnect', () => {
        console.log(`Cliente desconectado: ${socket.id}`)
        roomManager.handleDisconnect(socket.id, io)
    })
})

http.listen(3001, () => console.log('Servidor en http://localhost:3001'))