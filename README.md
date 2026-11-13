# Gundam Assemble Web

Juego de táctica por turnos sobre tablero hexagonal, con temática Gundam y multijugador en tiempo real. Dos jugadores se enfrentan con escuadras de unidades basadas en cartas reales, moviéndose por un tablero 3D y gestionando una línea temporal de activaciones.

Proyecto personal de Alejandro de la Torre Ruiz. Fan project sin ánimo de lucro: Gundam es una marca de sus respectivos propietarios.

## Funcionalidades

- **Multijugador en tiempo real** con Socket.IO: salas privadas con código y emparejamiento aleatorio.
- **Tablero hexagonal en 3D** con Three.js y React Three Fiber, con elevación, agua y modelos STL de las unidades.
- **Motor de reglas autoritativo en el servidor**: el cliente solo calcula ayudas visuales; el servidor valida cada acción y tira los dados (anti-trampas).
- **Acciones de juego**: avanzar (pathfinding A*), atacar con línea de visión y modificadores, dash, energize, rescate de guarniciones, habilidades y cartas de táctica.
- **Línea temporal** de activaciones en dos fases, con desempates por iniciativa.
- **Selección de escuadra y mazo** antes de cada partida, validada con las reglas oficiales de construcción.
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

El motor de reglas se prueba contra el código autoritativo del servidor:

```bash
cd server
npm test              # tests unitarios del motor (reglas del Core Rulebook v1.2)
npm run typecheck     # tipos de servidor, tests y scripts
npm run selfplay      # 100 partidas bot contra bot de principio a fin
npm run smoke         # prueba de humo de la capa Socket.IO (sin Supabase)
```

## Código compartido

Los tipos, el tablero hexagonal, el Timeline, las consultas de reglas y las
reglas de construcción de mazo viven en `server/src` y se copian al cliente con:

```bash
node scripts/sync-shared.mjs
```

Las copias del cliente llevan una cabecera `AUTO-GENERADO` y no se editan a mano;
un test falla si quedan desincronizadas.

## Datos de unidades y cartas

- `server/data/units/unit_library.json`: las 15 unidades oficiales (ST01, EX01, EX02, PA01) con HP, VP, TL, rasgos y textos de la [web oficial](https://global.bandai-hobby.net/en-us/site/gundam-assemble/unitlist/). El coste de TL, alcance y Strength de las armas y los costes de Energy vienen de la [wiki comunitaria](https://gundamassemble.wiki.gg), porque la web oficial solo los muestra en la imagen de la carta. Incluye también las 6 unidades de la demo previa.
- `server/data/cards/card_library.json`: las 45 cartas de Tactics de la lista oficial (39 jugables) más las 17 de la demo. Los números de las cartas Attack vienen de la wiki.

Conviene revisar ambos ficheros con las cartas físicas: la wiki tiene alguna errata.

## Autor

Alejandro de la Torre Ruiz · [GitHub](https://github.com/alexzv08) · [LinkedIn](https://www.linkedin.com/in/alejandrodelatorreruiz/)
