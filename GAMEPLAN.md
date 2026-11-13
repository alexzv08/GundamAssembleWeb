# GAMEPLAN — Gundam Assemble Web
# Reglas oficiales (Core Rulebook v1.2, 06/11/2026) frente a la implementación

`✅ hecho` | `⚠️ parcial / aproximado` | `❌ falta`

Fuentes oficiales:
- Reglamento: https://global.bandai-hobby.net/en-us/site/gundam-assemble/rules-qa/rules/
- Q&A: https://global.bandai-hobby.net/en-us/site/gundam-assemble/rules-qa/qa/
- Unidades: https://global.bandai-hobby.net/en-us/site/gundam-assemble/unitlist/
- Cartas de Tactics: https://global.bandai-hobby.net/en-us/site/gundam-assemble/tacticscard/ (bloqueada desde el entorno de desarrollo; datos tomados de la wiki comunitaria https://gundamassemble.wiki.gg — revisar con las cartas físicas)
- Otras cartas: https://global.bandai-hobby.net/en-us/site/gundam-assemble/othercard/ (pendiente de volcar)
- Escenarios y material extra: https://global.bandai-hobby.net/en-us/site/gundam-assemble/data/enrich-gameplay/ (pendiente de volcar)
- Guía de juego organizado (06/11/2026): escuadra de exactamente 3 Mobile Suits + 9 cartas de Tactics en las partidas normales ✅

---

## 1. Preparación y construcción de escuadra

- ✅ **Escuadra libre**: cualquier combinación de unidades, sin bandos fijos
- ✅ **Sin copias** del mismo número de carta salvo rasgo *Mass Produced* (ids únicos por copia)
- ✅ **Mazo de 9 cartas** sin repetir; cartas con rasgo exigen una unidad con ese rasgo; cartas de firma exigen la unidad con ese título
- ⚠️ **Tamaño del mazo**: el catálogo actual solo tiene 18 cartas (todas con rasgo Earth Federation o Zeon). Si la escuadra tiene menos de 9 elegibles, se exigen todas
- ✅ **Validación en el servidor** (`deckRules.ts`, compartido con la pantalla de selección)
- ✅ **Robo inicial** 3 cartas; +3 al acabar la Fase 1
- ✅ **Orden propio en el Timeline**: cada jugador reordena sus fichas apiladas (pantalla de setup)
- ✅ **Iniciativa**: empieza quien tenga el TL inicial más bajo; si empatan, tirada de dado
- ❌ **Tamaño de escuadra por escenario** (3 o 5): fijo en 3
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
- ⚠️ **Plantillas de área "SP"** (Twin Buster Rifle, Quadruple Bop Missile, 240mm Cannon, War Edge): cono = 60° hasta 3 hexes; flor = hex elegido + 6 vecinos. La forma exacta está en el diagrama de la carta
- ⚠️ **Elección del jugador** en Push/Pull: se toma automáticamente el primer hex válido y siempre la distancia máxima (el Q&A 7 permite elegir mover menos, incluso 0)
- ✅ Push/Pull hacia un hex más bajo: la unidad cae sin daño (Q&A 10)

## 6. Habilidades y cartas

- ✅ Ongoing: Zero System, Firing Line, Exploit Weakness, Fight to the End, Coordinated Payload, Three-Times Faster, Hover, Newtype Destroyer…
- ✅ Command: Full Power, Checkmate, No Escape, Sundering Strike, Hunter's Edge, Frenzied Charge, Alaya-Vijnana, Annihilate, Rescue Maneuver…
- ✅ Response automáticas: Char Kick, Blitzing Slash, Escape from Side 7, Supply, Toss Away, Stunning Shot, Crowd Control
- ✅ Cartas Response en el turno del rival (ventana tras daño / rescate / movimiento enemigo)
- ❌ **RWS** (BIT Stave, Corax, Iśvara) y habilidades que dependen de ellos
- ❌ **Challenge**, Psycho-Frame Synchrony, Permet Burst, Inspiring Presence, Material Transfer
- ✅ **46 cartas de Tactics oficiales** (wiki) utilizables con las 15 unidades; **29 jugables**:
  - Attack: Epic Shot, War Edge, Claiming Vengeance
  - Command: Ghost Step, Thrust Boosters, Renewed Power, Armor Upgrade, Focus, Armor Shatter, Field Engineers, Salvage Systems, Hero's Might, Shoulder Bash, All In, Psycho-Frame Overload, Interference Pattern, Full System Burn, Critical Rescue, Swift Appropriation
  - Response en el ataque: Federation Shield, Quick Block, Grunt's Guard, Neutralize, Strikethrough, Limiter Release, Locked On, Breaking Blow, Turn of Fortune, Target Reacquisition
- ❌ 17 cartas oficiales sin implementar (se pueden llevar en el mazo pero no jugar): las de RWS (BIT, Corax, Iśvara), Challenge/Interception, elección de Upgrade, Vantage Point, Ball Reinforcements, Zaku Ambush Tactics, Protective Shot, Iron-Blooded Tenacity, Three Man Team
- ❌ 11 cartas omitidas por pertenecer a unidades que aún no están en la lista oficial (GM, Zeong, Rick Dom…)
- Se conservan las 18 cartas de la demo (marcadas como `demo`)

## 6b. Q&A oficial revisado (página 1 de 9)

- ✅ Q1 movimiento no fraccionable · Q4 unidad derrotada en su activación · Q6 no terminar donde empezó (Slow no cuenta como moverse) · Q9 Command una vez, Response una por trigger · Q10 caer de terreno elevado sin daño · Q13 dados adicionales no reactivan el crítico · Q14 unidades fuera de la fase siguen usando Response
- ✅ Q3 línea de visión entre dos hexes, elección por punto
- ⚠️ Q7 Push/Pull de 0 hexes (no se puede elegir)
- ❌ Q2 efectos que hacen retroceder fichas en el Timeline (ninguna unidad actual lo usa)
- ❌ Páginas 2–9 del Q&A sin revisar

## 7. Objetivos y victoria

- ✅ Se disputan al **terminar la activación** en o junto al Objetivo; con mayoría, uno neutral se captura y uno del rival se neutraliza; el control se mantiene
- ✅ VP de Objetivos al final de **cada** Fase
- ✅ Garrison enemiga destruida +2 VP; Garrison aliada rescatada +2 VP
- ✅ Empate a VP: gana el último jugador que actuó
- ✅ Eliminada la "victoria por eliminar todas las unidades" (no existe en las reglas)

## 8. Datos

- ✅ Las 15 unidades oficiales (ST01, EX01, EX02, PA01) con HP, VP, TL, rasgos, firma y textos oficiales
- ✅ **Coste de TL, alcance, Strength, tipo de habilidad y coste de Energy** de las 15 unidades tomados de la wiki comunitaria (la web oficial solo los muestra en la imagen de la carta). ⚠️ La wiki tiene erratas en nombres de armas del PA01 y le falta Challenge del Guncannon; conviene revisarlos con las cartas físicas
- ⚠️ Habilidades Response con coste de Energy (Toss Away, Blitzing Slash, Coordinated Payload, Stunning Shot…) se usan automáticamente si hay Energy; el jugador no puede elegir no usarlas
- ✅ Se conservan las 6 unidades de la demo (DM01)

## 9. Multijugador / Red

- ✅ Salas privadas y emparejamiento; reconexión 5 min **solo para el mismo usuario autenticado**
- ✅ El servidor valida escuadra, mazo, turno y reglas, y tira todos los dados

## 10. Pendiente (UI / 3D)

- ❌ Animaciones de movimiento, sonidos, chat, selector de mapa
- ❌ Elegir manualmente el hex en Push/Pull y la plantilla de AoE
- ❌ Modelos STL ligeros (GLB + Draco) en lugar de 143 MB de STL
