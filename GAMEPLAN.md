# GAMEPLAN — Gundam Assemble Web
# Reglas oficiales (Core Rulebook v1.2, 06/11/2026) frente a la implementación

`✅ hecho` | `⚠️ parcial / aproximado` | `❌ falta`

Fuentes oficiales:
- Reglamento: https://global.bandai-hobby.net/en-us/site/gundam-assemble/rules-qa/rules/
- Q&A: https://global.bandai-hobby.net/en-us/site/gundam-assemble/rules-qa/qa/
- Unidades: https://global.bandai-hobby.net/en-us/site/gundam-assemble/unitlist/
- Cartas de Tactics, otras cartas (RWS) y Q&A completo: volcados de la web oficial en una hoja de cálculo aportada por el autor (`gundam_assemble_datos.xlsx`). Los números de las armas (unidades y cartas Attack) vienen de la wiki comunitaria https://gundamassemble.wiki.gg
- Otras cartas: https://global.bandai-hobby.net/en-us/site/gundam-assemble/othercard/ (pendiente de volcar)
- Escenarios y material extra: https://global.bandai-hobby.net/en-us/site/gundam-assemble/data/enrich-gameplay/ (pendiente de volcar)
- Guía de juego organizado (06/11/2026): escuadra de exactamente 3 Mobile Suits + 9 cartas de Tactics en las partidas normales ✅

---

## 1. Preparación y construcción de escuadra

- ✅ **Escuadra libre**: cualquier combinación de unidades, sin bandos fijos
- ✅ **Sin copias** del mismo número de carta salvo rasgo *Mass Produced* (ids únicos por copia)
- ✅ **Mazo de 9 cartas** sin repetir; cartas con rasgo exigen una unidad con ese rasgo; cartas de firma exigen la unidad con ese título
- ✅ **Tamaño del mazo**: 9 cartas de las 45 oficiales; si la escuadra tiene menos de 9 elegibles (rasgos o firmas), se exigen todas
- ✅ **Validación en el servidor** (`deckRules.ts`, compartido con la pantalla de selección)
- ✅ **Robo inicial** 3 cartas; +3 al acabar la Fase 1
- ✅ **Orden propio en el Timeline**: cada jugador reordena sus fichas apiladas (pantalla de setup)
- ✅ **Iniciativa**: empieza quien tenga el TL inicial más bajo; si empatan, tirada de dado
- ✅ **Tamaño de escuadra por escenario** (3 o 5): se elige al crear la sala junto con el mapa
- ❌ **Habilidades de Setup** (tipo `SETUP` existe, sin efectos)
- ❌ **Carriers**

## 2. Timeline

- ✅ 20 rondas continuas (Fase 1 = 1–10, Fase 2 = 11–20); más de 20 sale del Timeline
- ✅ Se paga el TL al declarar la acción
- ✅ Nuevas fichas debajo de las existentes; empates: actúa primero quien NO actuó el último
- ✅ Al terminar la activación **no** se paga TL extra

## 3. Despliegue y activación

- ✅ Las unidades empiezan en la **Reserva** y se despliegan en su Base al activarse
- ✅ Si no hay sitio para desplegar: Energize (2 TL) y sigue en la Reserva
- ✅ No se puede terminar la activación sobre la Base (si aún se puede mover)
- ✅ **Acción primaria obligatoria y única** (Attack, Dash, Energize, Rescue)
- ✅ **Advance** una vez por activación, 3 hexes + Speed Upgrades
- ✅ **Command** una vez por activación cada una; no gastan la acción primaria
- ✅ **Una carta de Tactics** por activación; las de tipo Attack sustituyen al ataque primario
- ✅ Acciones adicionales a TL 0 (Dash adicional, ataque adicional)
- ✅ Si la unidad activa es derrotada, su activación termina

## 4. Movimiento y terreno

- ✅ Subir cuesta +1 por nivel; bajar no cuesta
- ✅ **Saltar** desde terreno elevado (pasa huecos y enemigos más bajos)
- ✅ Atravesar aliados sí, enemigos / Garrisons enemigas / Base enemiga no
- ✅ **Engagement**: −1 al movimiento y obligación de atacar a un enemigo trabado
- ✅ **Agua y Debris**: −1 al movimiento iniciado dentro; −1 Accuracy al atacar a / desde ellos
- ✅ **Impassable**: solo se cruza con Hover y nunca se termina dentro
- ✅ **Minovsky Particles**: −2 Accuracy a no adyacentes (no acumulable)
- ✅ **Hover** (y Hover condicionado a Upgrades, p.ej. Jet Through)
- ✅ Recoger Upgrades / Energy al terminar un movimiento o desplegar

## 5. Combate

- ✅ Línea de visión oficial (terreno más alto que ambos; enemigos a la misma elevación; distinta elevación; los aliados no bloquean; si la línea pasa justo entre dos hexes, el atacante elige en cada punto por separado — Q&A 3)
- ✅ d10; Accuracy modifica el valor del dado salvo 1 (fallo) y 9-10 (crítico); impacta con 4+
- ✅ Elevación ±1 Accuracy
- ✅ Dados = Strength del arma + Strength Upgrades + modificadores (antes los dados extra se perdían)
- ✅ Efectos de crítico una sola vez por ataque; se aplican aunque los Shields eviten todo el daño
- ✅ Shields: se aplican tras el resto de efectos, se ponen boca abajo y se reactivan en la siguiente activación
- ✅ Fracture: +3 si recibe 3+ de daño de combate en un ataque
- ✅ Disarm: repite todos los impactos y no hay efectos de crítico
- ✅ Slow: el siguiente Advance no mueve
- ✅ Push / Pull con colisiones (2 de daño)
- ✅ Ataques que también alcanzan a los adyacentes al objetivo (una sola tirada)
- ✅ Derrota: VP al rival, Reserva, +2 TL, HP al máximo, sin estados, conserva Energy y Upgrades
- ✅ **Ventanas de Response durante el ataque**: antes y después de la tirada (primero el atacante, luego el defensor); el ataque se pausa solo si alguien tiene una carta jugable
- ⚠️ **Plantillas de área "SP"** (Twin Buster Rifle, Quadruple Bop Missile, 240mm Cannon, War Edge): cono = 60° hasta 3 hexes; flor = hex elegido + 6 vecinos. La forma exacta está en el diagrama de la carta (la hoja enlaza la imagen de War Edge)
- ✅ **Elección del jugador** en Push/Pull: quien empuja o atrae elige cada hex entre los válidos y puede parar antes, incluso sin mover (Q&A 7). Si no hay hex libre, la colisión es automática
- ✅ Push/Pull hacia un hex más bajo: la unidad cae sin daño (Q&A 10)

## 6. Habilidades y cartas

- ✅ Ongoing: Zero System, Firing Line, Exploit Weakness, Fight to the End, Three-Times Faster, Hover, Jet Through, Newtype Destroyer…
- ✅ Command: Full Power, Checkmate, No Escape, Sundering Strike, Hunter's Edge, Frenzied Charge, Alaya-Vijnana, Annihilate, Rescue Maneuver, BIT Stave / Corax / Iśvara B Type Direct…
- ✅ Response automáticas: Char Kick, Blitzing Slash, Escape from Side 7, Supply, Toss Away, Stunning Shot, Crowd Control, Coordinated Payload, Lockdown, Permet Burst, Psycho-Frame Synchrony, Inspiring Presence
- ✅ Las Response automáticas de unidad se pueden desactivar por unidad (interruptor en el panel) para guardar la Energy
- ✅ **Challenge** (botón durante el ataque enemigo) y **Material Transfer** (el jugador reparte los Upgrades)

### Remote Weapon Systems (Q&A 110)
- ✅ BIT Stave, Corax e Iśvara B Type: empiezan en la reserva de su unidad; se despliegan o recolocan en un hex vacío a alcance con su habilidad "Direct"
- ✅ No bloquean LoS ni movimiento, no causan Engagement, nadie termina en su hex; se pueden atacar (1 HP, 2 VP); vuelven a la reserva al ser destruidas o al caer su unidad; Push/Pull chocan con ellas
- ✅ Efectos: Corax +1 Accuracy a aliados contra enemigos adyacentes; BIT Stave −1 de daño a aliados adyacentes; Iśvara 1 de daño a un enemigo adyacente al desplegarse; Beam Rifle de Aerial; crítico del Beam Saber de Darilbalde
- ❌ Empujar o atraer RWS (ningún efecto actual lo hace)

### Cartas de Tactics (lista oficial: 45)
- ✅ **Las 45 jugables**: 3 Attack, 25 Command y 17 Response (antes de tirar, después de tirar y tras el daño), incluidas On-Site Integration y Special OPs (elegir Upgrade), Bit Assault (recolocar varias RWS), Interception (Challenge) y Protective Shot (ataque fuera de turno)
- ⚠️ Iron-Blooded Tenacity: evita la derrota (queda a 1 HP), pero no aplica el movimiento ni el ataque posteriores del texto
- Se conservan 17 cartas de la demo (marcadas como `demo`)

## 6b. Q&A oficial (130 preguntas revisadas)

- ✅ Q1 movimiento no fraccionable · Q3 LoS entre dos hexes, elección por punto · Q4/Q24 derrota en mitad de la activación o del ataque · Q6 no terminar donde empezó · **Q7 Push/Pull a elegir, también de 0 hexes** · Q9 Command una vez · Q10 caer sin daño · Q13 dados extra · Q14 · **Q16 empujar contra el borde no hace daño** · Q18 las áreas no dañan aliados · Q19 · Q20 Push/Pull ignoran penalizaciones · Q29 Engagement · Q34 colisión con aliados al atraer · Q37 colisión no es daño de ataque · Q38 · Q39 · **Q43/Q44 Newtype Destroyer también bloquea las Response tras el daño** · Q87 hex vacío · Q100 Move afectado por terreno · Q110 RWS
- ❌ Q2/Q22/Q28 efectos que hacen retroceder fichas en el Timeline (ninguna carta actual)
- Las preguntas sobre unidades y productos aún no publicados en la lista de unidades (Zeong, Strike, Buster, Deathscythe, Heavyarms, Carriers…) no aplican todavía

## 7. Objetivos y victoria

- ✅ Se disputan al **terminar la activación** en o junto al Objetivo; con mayoría, uno neutral se captura y uno del rival se neutraliza; el control se mantiene
- ✅ VP de Objetivos al final de **cada** Fase
- ✅ Garrison enemiga destruida +2 VP; Garrison aliada rescatada +2 VP
- ✅ Empate a VP: gana el último jugador que actuó
- ✅ Eliminada la "victoria por eliminar todas las unidades" (no existe en las reglas)

## 8. Datos

- ✅ Las 15 unidades oficiales (ST01, EX01, EX02, PA01) con HP, VP, TL, rasgos, firma y textos oficiales
- ✅ **Coste de TL, alcance, Strength, tipo de habilidad y coste de Energy** de las 15 unidades tomados de la wiki comunitaria (la web oficial solo los muestra en la imagen de la carta). ⚠️ La wiki tiene erratas en nombres de armas del PA01 y le falta Challenge del Guncannon; conviene revisarlos con las cartas físicas
- ✅ Habilidades Response con coste de Energy (Toss Away, Blitzing Slash, Coordinated Payload, Stunning Shot…): se usan solas si hay Energy, salvo que el jugador desactive las Response automáticas de esa unidad
- ✅ Se conservan las 6 unidades de la demo (DM01)

## 9. Multijugador / Red

- ✅ Salas privadas y emparejamiento; reconexión 5 min **solo para el mismo usuario autenticado**
- ✅ **Partida contra la máquina**: el servidor juega por el rival con la misma IA del self-play (`bot.ts`)
- ✅ Chat de partida (200 caracteres, 1 mensaje por segundo)
- ✅ Rutas de mapas protegidas: ids sin rutas (`/^[A-Za-z0-9_-]+$/`) y subida de mapas con sesión y límite de 200 KB
- ✅ El servidor valida escuadra, mazo, turno y reglas, y tira todos los dados

## 10. Pendiente (UI / 3D)

- ✅ Animación de movimiento, sonidos (con botón de silencio), chat, selector de mapa con miniatura
- ✅ Rediseño visual (revisión de UX): sistema de colores relativo (tú cian, rival rojo), tipografía, HUD por zonas, acciones visibles sin pulsar el modelo, cámara que sigue a la unidad activa, bandeja de dados, daño flotante, trazo de ataque, HUD para móvil
- ✅ Modelos GLB comprimidos con meshopt (1,6 MB en lugar de 143 MB de STL)
- ⚠️ 9 de las 15 unidades oficiales no tienen modelo 3D (se dibuja una pieza genérica) y los modelos no están pintados
- ❌ Colocar a mano la plantilla de AoE (cono / flor)
- ❌ Postprocesado (bloom, oclusión ambiental), props de terreno y efectos distintos por arma
