# Gundam Assemble Web

Juego de táctica por turnos sobre tablero hexagonal, con temática Gundam y multijugador en tiempo real. Dos jugadores se enfrentan con escuadras de unidades basadas en cartas reales, moviéndose por un tablero 3D y gestionando una línea temporal de activaciones.

Proyecto personal de Alejandro de la Torre Ruiz. Fan project sin ánimo de lucro: Gundam es una marca de sus respectivos propietarios.

## Funcionalidades

- **Multijugador en tiempo real** con Socket.IO: salas privadas con código y emparejamiento aleatorio.
- **Tablero hexagonal en 3D** con Three.js y React Three Fiber, con elevación, agua y modelos STL de las unidades.
- **Motor de reglas autoritativo en el servidor**: el cliente solo calcula ayudas visuales; el servidor valida cada acción y tira los dados (anti-trampas).
- **Acciones de juego**: avanzar (pathfinding A*), atacar con línea de visión y modificadores, dash, energize, rescate de guarniciones, habilidades y cartas de táctica.
- **Línea temporal** de activaciones en dos fases, con desempates por iniciativa.
- **Selección de escuadra y mazo** antes de cada partida.
- **Reconexión**: la sala se mantiene 5 minutos si un jugador se desconecta.
- **Registro de acciones** en pantalla.
- **Login con Google y Discord** mediante Supabase.

## Tecnologías

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19, TypeScript, Vite |
| 3D | Three.js, React Three Fiber, Drei |
| Backend | Node.js, Express 5, TypeScript |
| Tiempo real | Socket.IO |
| Autenticación y datos | Supabase (PostgreSQL) |
| Tests | Vitest |
| Despliegue | Vercel (cliente) y Railway (servidor) |

## Arquitectura

```
client/   React + Three.js. Interfaz, escena 3D y lógica de ayuda visual (rangos, caminos)
server/   Express + Socket.IO. Motor de juego autoritativo, salas y API REST de datos
  src/game/     Reglas: tablero hexagonal, línea temporal, acciones, efectos, victoria
  src/rooms/    Gestión de salas, cola de emparejamiento y reconexión
  data/         Unidades, mapas y cartas en JSON
```

Los tipos de TypeScript se comparten entre cliente y servidor, y cada acción trabaja sobre una copia del estado (estado inmutable). El detalle técnico completo está en [`CLAUDE.md`](CLAUDE.md) y el estado de las reglas frente al juego oficial en [`GAMEPLAN.md`](GAMEPLAN.md).

## Puesta en marcha

Requisitos: Node.js 20 o superior y un proyecto de Supabase.

1. Variables de entorno (no se suben al repositorio):

   `client/.env`
   ```
   VITE_SERVER_URL=http://localhost:3001
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```

   `server/.env`
   ```
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

   El esquema de la base de datos está en `server/scripts/schema.sql`.

2. Servidor (puerto 3001):

   ```bash
   cd server
   npm install
   npm run dev
   ```

3. Cliente (puerto 5173):

   ```bash
   cd client
   npm install
   npm run dev
   ```

## Tests

```bash
cd client
npm test
```

## Autor

Alejandro de la Torre Ruiz · [GitHub](https://github.com/alexzv08) · [LinkedIn](https://www.linkedin.com/in/alejandrodelatorreruiz/)
