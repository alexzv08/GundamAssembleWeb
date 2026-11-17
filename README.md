# Gundam Assemble Web

Juego de táctica por turnos sobre tablero hexagonal, con temática Gundam y multijugador en tiempo real. Dos jugadores se enfrentan con escuadras de unidades basadas en cartas reales, moviéndose por un tablero 3D y gestionando una línea temporal de activaciones.

Proyecto personal de Alejandro de la Torre Ruiz. Fan project sin ánimo de lucro: Gundam es una marca de sus respectivos propietarios.

## Funcionalidades

- **Multijugador en tiempo real** con Socket.IO: salas privadas con código y emparejamiento aleatorio.
- **Partida contra la máquina** con cuatro niveles de dificultad (el experto planifica cada activación completa) y un **consejero** que propone las mejores jugadas y explica por qué.
- **Modo mesa**: para partidas con miniaturas en una mesa real. Apuntas lo que hacéis los dos y los dados que salen (el mazo del rival queda oculto) y el consejero te dice la mejor jugada.
- **Revancha, enlaces para invitar, modo espectador y repeticiones** de cada partida.
- **Reloj de turno, rendición y partidas guardadas** que sobreviven a un reinicio del servidor.
- **Mapas y escuadras de 3 o 5 unidades** a elegir al crear la sala.
- **Tablero hexagonal en 3D** con Three.js y React Three Fiber, con elevación, agua y modelos 3D de las unidades (GLB comprimidos).
- **Motor de reglas autoritativo en el servidor**: el cliente solo calcula ayudas visuales; el servidor valida cada acción y tira los dados (anti-trampas).
- **Acciones de juego**: avanzar (pathfinding A*), atacar con línea de visión y modificadores, dash, energize, rescate de guarniciones, habilidades y cartas de táctica.
- **Línea temporal** de activaciones en dos fases, con desempates por iniciativa.
- **Selección de escuadra y mazo** antes de cada partida, validada con las reglas oficiales de construcción.
- **Reconexión**: la sala se mantiene 5 minutos si un jugador se desconecta.
- **Registro de acciones**, chat de partida, animación de movimiento y sonidos (con botón de silencio).
- **Interfaz rediseñada**: tú siempre en cian y el rival en rojo, HUD que no tapa el tablero, bandeja de dados, daño flotante y versión compacta para móvil.
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

Para publicarlo (Supabase + Vercel + Railway), sigue [DEPLOY.md](DEPLOY.md). En local:

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
   # Opcionales
   GAME_STORE=file          # file (por defecto) | supabase | none: dónde se guardan partidas en curso y repeticiones
   TURN_SECONDS=120         # tiempo por activación (0 = sin reloj)
   RESPONSE_SECONDS=30      # tiempo para Response y elecciones
   BOT_DELAY_MS=700         # pausa entre acciones de la máquina
   ```

   El esquema de la base de datos está en `server/scripts/schema.sql`. Con `GAME_STORE=supabase` hay que aplicar también `server/supabase/migrations/` (tablas `active_rooms` y `replays`). Con `file`, se guardan en `server/data/runtime/` (en un despliegue, ese directorio debe ser un volumen persistente).

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
npm run duelo         # enfrenta dos niveles de bot (por defecto experto contra difícil)
npm run smoke         # prueba de humo de la capa Socket.IO (sin Supabase), incluida una partida contra el bot
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

## Aviso legal

Proyecto de fans **no oficial**, gratuito y en fase **beta**, sin licencia ni relación con Bandai ni con la marca Gundam.
Todos los nombres, diseños, ilustraciones y marcas de Gundam y de Gundam Assemble son propiedad de ©SOTSU·SUNRISE,
©SOTSU·MBS y BANDAI SPIRITS. Apoya el juego oficial en <https://global.bandai-hobby.net/en-us/site/gundam-assemble/>.

## Autor

Alejandro de la Torre Ruiz · [GitHub](https://github.com/alexzv08) · [LinkedIn](https://www.linkedin.com/in/alejandrodelatorreruiz/)
