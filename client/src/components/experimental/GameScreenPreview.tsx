/**
 * GameScreenPreview — pantalla de vista previa del rediseño experimental.
 * Acceso: abre el dev-server con ?preview en la URL (ej: localhost:5173?preview)
 * No requiere auth ni servidor de juego.
 */

import { useState } from 'react'
import type { GameState } from '../../types/gameState'
import type { Hex } from '../../types/board'
import { UnitPanel } from './UnitPanel'
import { TimelineBar } from './TimelineBar'
import { ObjectivesPanel } from './ObjectivesPanel'
import { LegendPanel } from './LegendPanel'
import { ActionLog } from './ActionLog'
import { DiceRollPopup } from './DiceRollPopup'
import { GameScene } from '../../three/GameScene'
import { useGameData } from '../../game/useGameData'

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_STATE: GameState = {
    gameId: 'preview',
    phase: 'phase1',
    activePlayerId: 'player1',
    activeUnitId: 'gundam',
    lastActivePlayer: null,
    roundNumber: 4,
    hasUsedPrimaryAction: false,
    winner: null,
    pendingResponse: null,
    actionLog: [],

    players: {
        player1: {
            id: 'player1', name: 'Amuro', vp: 41,
            deployHex: { q: 0, r: 0 }, squadUnitIds: ['gundam', 'guncannon'],
            tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
        },
        player2: {
            id: 'player2', name: 'Char', vp: 20,
            deployHex: { q: 10, r: 7 }, squadUnitIds: ['zaku', 'gouf'],
            tactics: { deck: [], hand: [], discarded: [], usedResponseThisTurn: false },
        },
    },

    units: {
        gundam: {
            id: 'gundam', name: 'Gundam', unitType: 'mobile_suit',
            traits: ['Earth Federation', 'Newtype'],
            maxHp: 11, currentHp: 11, energy: 2, vp: 5, startingTl: 2,
            position: { q: 2, r: 3 }, playerId: 'player1', activated: false,
            weapons: [
                {
                    name: 'Beam Saber', range: 1, strength: 2, tlCost: 2,
                    critEffect: '[After Combat Damage] Gain a [Strength] Upgrade.',
                    effectData: null, critData: { trigger: 'after_combat_damage', type: 'gain_upgrade', target: 'self', upgradeType: 'attack' },
                },
                {
                    name: 'Beam Rifle', range: 4, strength: 5, tlCost: 4,
                    critEffect: '[Crit] +2 Damage.',
                    effectData: null, critData: null,
                },
            ],
            abilities: [
                {
                    name: 'White Base Unity', type: 'CMD',
                    description: 'If an allied unit within [Range 3] has 1 or fewer Upgrades, it gains an Upgrade of your choice.',
                    energyCost: 1,
                    abilityData: { type: 'heal_ally_after_rescue', range: 3 },
                },
                {
                    name: 'Newtype Instincts', type: 'ONG',
                    description: '[After Attack Roll] if this unit is attacking, it rerolls one miss.',
                    abilityData: { type: 'reroll_one_miss' },
                },
            ],
            statusEffects: [],
            upgrades: [{ type: 'attack', value: 1 }],
        },
        guncannon: {
            id: 'guncannon', name: 'Guncannon', unitType: 'mobile_suit',
            traits: ['Earth Federation'],
            maxHp: 9, currentHp: 6, energy: 0, vp: 4, startingTl: 4,
            position: { q: 3, r: 5 }, playerId: 'player1', activated: true,
            weapons: [
                { name: 'Cannon', range: 4, strength: 4, tlCost: 3, effectData: null, critData: null },
            ],
            abilities: [],
            statusEffects: [{ type: 'slow' }],
            upgrades: [],
        },
        zaku: {
            id: 'zaku', name: "Char's Zaku", unitType: 'mobile_suit',
            traits: ['Zeon'],
            maxHp: 12, currentHp: 9, energy: 1, vp: 5, startingTl: 2,
            position: { q: 8, r: 3 }, playerId: 'player2', activated: false,
            weapons: [
                {
                    name: 'Heat Hawk', range: 1, strength: 3, tlCost: 2,
                    critEffect: '[Crit] Fracture target.',
                    effectData: null, critData: { trigger: 'after_attack_roll', type: 'fracture', target: 'target' },
                },
                { name: 'Zaku Machine Gun', range: 3, strength: 4, tlCost: 3, effectData: null, critData: null },
            ],
            abilities: [
                {
                    name: 'Three Times Faster', type: 'ONG',
                    description: '[Dash] This unit may move up to 3 hexes instead of 2.',
                    abilityData: { type: 'dash_range_bonus', amount: 1 },
                },
            ],
            statusEffects: [],
            upgrades: [],
        },
        gouf: {
            id: 'gouf', name: 'Gouf', unitType: 'mobile_suit',
            traits: ['Zeon'],
            maxHp: 10, currentHp: 10, energy: 0, vp: 4, startingTl: 6,
            position: null, playerId: 'player2', activated: false,
            weapons: [
                { name: 'Heat Rod', range: 1, strength: 3, tlCost: 2, effectData: null, critData: null },
            ],
            abilities: [],
            statusEffects: [],
            upgrades: [],
        },
    },

    timeline: {
        currentRound: 4,
        slots: [
            { round: 1, tokens: [] },
            { round: 2, tokens: [] },
            { round: 3, tokens: [] },
            { round: 4, tokens: [{ unitId: 'gundam', playerId: 'player1' }, { unitId: 'gundam', playerId: 'player1' }, { unitId: 'zaku', playerId: 'player2' }, { unitId: 'zaku', playerId: 'player2' }, { unitId: 'zaku', playerId: 'player2' }] },
            { round: 5, tokens: [] },
            { round: 6, tokens: [{ unitId: 'guncannon', playerId: 'player1' }] },
            { round: 7, tokens: [] },
            { round: 8, tokens: [{ unitId: 'gouf', playerId: 'player2' }] },
            { round: 9, tokens: [] },
            { round: 10, tokens: [] },
            { round: 11, tokens: [] },
            { round: 12, tokens: [] },
            { round: 13, tokens: [] },
            { round: 14, tokens: [] },
            { round: 15, tokens: [] },
            { round: 16, tokens: [] },
            { round: 17, tokens: [] },
            { round: 18, tokens: [] },
            { round: 19, tokens: [] },
            { round: 20, tokens: [] },
        ],
    },

    board: {},

    log: [
        { message: "Char's Zaku ataca con Heat Hawk · 3 daño", playerId: 'player2', round: 3, category: 'attack', hexes: [] },
        { message: 'Gundam captura obj_2 · +5 VP', playerId: 'player1', round: 3, category: 'objective', hexes: [] },
        { message: 'Guncannon avanza 3 hexes', playerId: 'player1', round: 4, category: 'move', hexes: [] },
        { message: "Char's Zaku usa Three Times Faster", playerId: 'player2', round: 4, category: 'ability', hexes: [] },
    ],
}

const MOCK_OBJECTIVE_HEXES: Hex[] = [
    {
        coord: { q: 5, r: 7 }, terrain: 'normal', elevation: 0,
        occupiedBy: null, upgradeToken: null, garrisonToken: null, deployZone: null,
        objectiveToken: { id: 'obj_1', vpValue: 5, controlledBy: 'player1' },
    },
    {
        coord: { q: 6, r: 5 }, terrain: 'normal', elevation: 0,
        occupiedBy: null, upgradeToken: null, garrisonToken: null, deployZone: null,
        objectiveToken: { id: 'obj_2', vpValue: 5, controlledBy: 'player2' },
    },
    {
        coord: { q: 3, r: 2 }, terrain: 'normal', elevation: 0,
        occupiedBy: null, upgradeToken: null, garrisonToken: null, deployZone: null,
        objectiveToken: { id: 'obj_3', vpValue: 5, controlledBy: null },
    },
    {
        coord: { q: 8, r: 6 }, terrain: 'normal', elevation: 0,
        occupiedBy: null, upgradeToken: null, garrisonToken: null, deployZone: null,
        objectiveToken: { id: 'obj_4', vpValue: 5, controlledBy: null },
    },
]

// Cartas de mano (mockup visual)
const MOCK_HAND = [
    { id: 'T03', name: 'Last Shot Counts', color: '#2a3a52' },
    { id: 'T05', name: "Veteran's Momentum", color: '#2a3a52' },
    { id: 'T16', name: 'Built to Last', color: '#1c3a28' },
    { id: 'T18', name: 'Return Fire', color: '#3a2a2a' },
    { id: 'T17', name: 'Forward Artillery Position', color: '#2a3a52' },
]

// ─── Preview Component ─────────────────────────────────────────────────────────

const PLEX = "'IBM Plex Sans', system-ui, sans-serif"
const MONO = "'IBM Plex Mono', monospace"
const CHAKRA = "'Chakra Petch', sans-serif"

export function GameScreenPreview() {
    const [myPlayer, setMyPlayer] = useState<'player1' | 'player2'>('player1')
    const [hasMoved, setHasMoved] = useState(false)
    const [hasUsedPrimary, setHasUsedPrimary] = useState(false)
    const [selectedWeapon, setSelectedWeapon] = useState<number | null>(null)
    const [logHoveredHexes, setLogHoveredHexes] = useState<Set<string>>(new Set())
    const [showDiceDemo, setShowDiceDemo] = useState(false)

    const { board, loaded: boardLoaded } = useGameData()

    const isMyTurn = myPlayer === MOCK_STATE.activePlayerId
    const activeUnit = MOCK_STATE.units[MOCK_STATE.activeUnitId!]

    // Mezcla el board real con los datos mock (unidades en posiciones hardcodeadas)
    const gameState: GameState = { ...MOCK_STATE, board }

    return (
        <div style={{
            width: '100vw', height: '100vh', overflow: 'hidden',
            background: 'radial-gradient(120% 90% at 50% 0%, #10192c 0%, #0a111e 60%, #070c16 100%)',
            fontFamily: PLEX, color: '#dbe4ec',
            display: 'flex', flexDirection: 'column',
            position: 'relative',
        }}>
            {/* Dev toggle — cambia perspectiva entre J1/J2 */}
            {/* <div style={{
                position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
                zIndex: 999, display: 'flex', gap: 6, alignItems: 'center',
                background: 'rgba(0,0,0,.6)', borderRadius: 8, padding: '3px 10px',
                fontFamily: MONO, fontSize: 10, color: '#5e6a72',
            }}>
                PREVIEW ·
                <span
                    onClick={() => setMyPlayer('player1')}
                    style={{
                        cursor: 'pointer', padding: '2px 7px', borderRadius: 5,
                        background: myPlayer === 'player1' ? 'rgba(31,143,168,.3)' : 'transparent',
                        color: myPlayer === 'player1' ? '#8fe6f7' : '#5e6a72',
                    }}
                >J1 Amuro</span>
                <span style={{ color: '#3f4d5c' }}>|</span>
                <span
                    onClick={() => setMyPlayer('player2')}
                    style={{
                        cursor: 'pointer', padding: '2px 7px', borderRadius: 5,
                        background: myPlayer === 'player2' ? 'rgba(154,74,68,.3)' : 'transparent',
                        color: myPlayer === 'player2' ? '#f0a8a8' : '#5e6a72',
                    }}
                >J2 Char</span>
                <span style={{ color: '#3f4d5c' }}>·</span>
                <span
                    onClick={() => { setHasMoved(false); setHasUsedPrimary(false); setSelectedWeapon(null) }}
                    style={{ cursor: 'pointer', color: '#5e6a72', textDecoration: 'underline' }}
                >reset acciones</span>
            </div> */}

            {/* ── Timeline Bar ── */}
            <TimelineBar gameState={gameState} myPlayerId={myPlayer} />

            {/* ── Game area ── */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

                {/* Unit Panel (left) */}
                <div style={{ position: 'absolute', left: 16, top: 16, zIndex: 20 }}>
                    <UnitPanel
                        unit={activeUnit}
                        isActive
                        isMyUnit={myPlayer === 'player1'}
                        isMyTurn={isMyTurn}
                        isSelected={isMyTurn}
                        hasMoved={hasMoved}
                        hasUsedPrimary={hasUsedPrimary}
                        selectedWeaponIndex={selectedWeapon}
                        currentTlRound={4}
                        canRescue={false}
                        onMove={() => setHasMoved(true)}
                        onDash={() => setHasUsedPrimary(true)}
                        onAttack={idx => setSelectedWeapon(prev => prev === idx ? null : idx)}
                        onUseAbility={() => setHasUsedPrimary(true)}
                        onEnergize={() => setHasUsedPrimary(true)}
                        onRescue={() => setHasUsedPrimary(true)}
                        onEndTurn={() => { setHasMoved(false); setHasUsedPrimary(false); setSelectedWeapon(null) }}
                        onCancel={() => setSelectedWeapon(null)}
                    />
                </div>

                {/* ── Tablero 3D ── */}
                {!boardLoaded ? (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: MONO, fontSize: 11, color: '#3f4d5c',
                    }}>
                        Cargando mapa… (servidor en :3001)
                    </div>
                ) : (
                    <GameScene
                        gameState={gameState}
                        myPlayerId={myPlayer}
                        selectedUnitId={null}
                        reachableHexes={new Set()}
                        attackableHexes={new Set()}
                        onHexClick={() => { }}
                        onUnitClick={() => { }}
                        logHighlightedHexes={logHoveredHexes}
                    />
                )}

                {/* Right rail: Objectives + Legend */}
                <div style={{
                    position: 'absolute', right: 16, top: 16,
                    display: 'flex', flexDirection: 'column', gap: 10,
                    zIndex: 20,
                }}>
                    <ObjectivesPanel
                        objectiveHexes={MOCK_OBJECTIVE_HEXES}
                        players={MOCK_STATE.players}
                    />
                    <LegendPanel players={MOCK_STATE.players} />
                </div>

                {/* Demo: botón para abrir el popup de dados */}
                <button
                    onClick={() => setShowDiceDemo(true)}
                    style={{
                        position: 'absolute', bottom: 18, left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 30,
                        background: 'rgba(224,169,75,.1)', border: '1px solid #b8882a55',
                        borderRadius: 8, padding: '6px 14px',
                        fontFamily: MONO, fontSize: 10, color: '#e0a94b',
                        cursor: 'pointer', letterSpacing: 1,
                    }}
                >⚄ DEMO DADOS</button>

                {/* Action Log (bottom-left) */}
                <ActionLog
                    log={MOCK_STATE.log}
                    myPlayerId={myPlayer}
                    player1Name={MOCK_STATE.players.player1.name}
                    player2Name={MOCK_STATE.players.player2.name}
                    onHoverHexes={hexes => setLogHoveredHexes(hexes ? new Set(hexes) : new Set())}
                />

                {/* Hand cards (bottom center) */}
                <div style={{
                    position: 'absolute',
                    bottom: -8, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', alignItems: 'flex-end', height: 170,
                }}>
                    {MOCK_HAND.map((card, i) => {
                        const mid = (MOCK_HAND.length - 1) / 2
                        const rot = (i - mid) * 7
                        const ty = Math.abs(i - mid) * 10
                        const selected = i === 2
                        return (
                            <div key={card.id} style={{
                                width: 118, height: 165,
                                borderRadius: 9, overflow: 'hidden',
                                cursor: 'zoom-in', margin: '0 -14px',
                                transform: `rotate(${rot}deg) translateY(${ty - (selected ? 20 : 0)}px)`,
                                border: `2px solid ${selected ? '#8fe6f7' : '#1a2836'}`,
                                background: card.color,
                                boxShadow: selected
                                    ? '0 0 16px rgba(143,230,247,.45)'
                                    : '0 6px 14px rgba(0,0,0,.5)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'transform .15s',
                            }}>
                                <div style={{
                                    fontFamily: MONO, fontSize: 9, color: '#5e6a72',
                                    textAlign: 'center', padding: '0 8px', lineHeight: 1.4,
                                }}>{card.name}</div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Dice roll popup demo */}
            {showDiceDemo && (
                <DiceRollPopup
                    attackerName="Gundam"
                    targetName="Char's Zaku"
                    weaponName="Beam Rifle"
                    rolls={[7, 5, 2, 6, 8]}
                    hitThreshold={4}
                    critThreshold={7}
                    totalHits={4}
                    damage={3}
                    onClose={() => setShowDiceDemo(false)}
                />
            )}
        </div>
    )
}
