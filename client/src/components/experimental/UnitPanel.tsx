import type { Unit } from '../../types/units'

interface UnitPanelProps {
    unit: Unit
    isActive: boolean
    isMyUnit: boolean
    isMyTurn: boolean
    isSelected: boolean
    hasMoved: boolean
    hasUsedPrimary: boolean
    selectedWeaponIndex: number | null
    currentTlRound?: number | null
    canRescue?: boolean
    onMove?: () => void
    onDash?: () => void
    onAttack?: (weaponIndex: number) => void
    onUseAbility?: (abilityIndex: number) => void
    onEnergize?: () => void
    onRescue?: () => void
    onEndTurn?: () => void
    onCancel?: () => void
}

const ABILITY_TYPE = {
    CMD: { bg: '#d27d2e', label: 'Command' },
    ONG: { bg: '#3a9b4e', label: 'Ongoing' },
    RSP: { bg: '#6a1b9a', label: 'Response' },
}

const MONO = "'IBM Plex Mono', monospace"
const CHAKRA = "'Chakra Petch', sans-serif"
const PLEX = "'IBM Plex Sans', system-ui, sans-serif"

export function UnitPanel({
    unit,
    isActive,
    isMyUnit,
    isMyTurn,
    isSelected,
    hasMoved,
    hasUsedPrimary,
    selectedWeaponIndex,
    currentTlRound,
    canRescue = false,
    onMove,
    onDash,
    onAttack,
    onUseAbility,
    onEnergize,
    onRescue,
    onEndTurn,
    onCancel,
}: UnitPanelProps) {
    const isP1 = unit.playerId === 'player1'
    const borderColor = isP1 ? '#2f9fbd' : '#9a4a44'
    const glowColor = isP1 ? 'rgba(47,159,189,.25)' : 'rgba(154,74,68,.2)'
    const accentColor = isP1 ? '#8fe6f7' : '#f0a8a8'
    const hpPct = unit.currentHp / unit.maxHp
    const showActions = isActive && isMyUnit && isMyTurn && isSelected

    const actionBtn = (
        label: string,
        onClick?: () => void,
        disabled?: boolean,
        color = accentColor,
    ) => (
        <button
            onClick={disabled ? undefined : onClick}
            style={{
                background: disabled ? 'transparent' : `rgba(${isP1 ? '31,143,168' : '154,74,68'},.12)`,
                border: `1px solid ${disabled ? '#1e2e3c' : color + '88'}`,
                borderRadius: 7,
                color: disabled ? '#3f4d5c' : color,
                fontFamily: PLEX,
                fontWeight: 600,
                fontSize: 11,
                padding: '6px 10px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                whiteSpace: 'nowrap' as const,
            }}
        >
            {label}
        </button>
    )

    return (
        <>
        <style>{`
            .exp-unit-panel::-webkit-scrollbar { width: 6px; }
            .exp-unit-panel::-webkit-scrollbar-track { background: transparent; }
            .exp-unit-panel::-webkit-scrollbar-thumb {
                background: ${borderColor}55;
                border-radius: 8px;
            }
            .exp-unit-panel::-webkit-scrollbar-thumb:hover {
                background: ${borderColor}99;
            }
        `}</style>
        <div
            className="exp-unit-panel"
            style={{
                width: 312,
                background: 'linear-gradient(180deg, #0e1a2a, #0b1521)',
                border: `1.5px solid ${isActive ? borderColor : '#1e2e3c'}`,
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: isActive
                    ? `0 0 0 1px ${glowColor}, 0 10px 30px rgba(0,0,0,.45)`
                    : '0 4px 16px rgba(0,0,0,.3)',
                fontFamily: PLEX,
                color: '#dbe4ec',
                maxHeight: 'calc(100vh - 150px)',
                overflowY: 'auto',
                scrollbarWidth: 'thin',
                scrollbarColor: `${borderColor}55 transparent`,
            }}>

            {/* ── Header ── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 15px 11px',
                borderBottom: '1px solid rgba(22,52,65,.32)',
                background: '#0e1a2a',
                position: 'sticky', top: 0, zIndex: 1,
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: CHAKRA, fontSize: 18, fontWeight: 700, color: '#eaf6fa' }}>
                            {unit.name}
                        </span>
                        {isActive && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{
                                    width: 7, height: 7, borderRadius: '50%',
                                    background: '#e0a94b', boxShadow: '0 0 6px #e0a94b',
                                    display: 'inline-block',
                                }} />
                                <span style={{ fontFamily: MONO, fontSize: 9, color: '#e0a94b', letterSpacing: 1 }}>
                                    ACTIVA
                                </span>
                            </span>
                        )}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: '#7e8a92', marginTop: 2 }}>
                        {unit.traits.filter(t => t !== 'Earth Federation' && t !== 'Zeon').join(' · ') || ' '}
                    </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: 13, color: accentColor, fontWeight: 600 }}>
                        VP {unit.vp}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 9, color: '#7e8a92' }}>
                        TL {unit.startingTl}
                        {currentTlRound != null && currentTlRound !== unit.startingTl && (
                            <span style={{ color: '#e0a94b' }}> → {currentTlRound}</span>
                        )}
                        {currentTlRound != null && currentTlRound === unit.startingTl && (
                            <span style={{ color: '#3f4d5c' }}> · slot {currentTlRound}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* ── HP + Energy ── */}
            <div style={{ padding: '12px 15px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: '#9fb0bc', letterSpacing: 1 }}>HP</span>
                    <span style={{
                        fontFamily: MONO, fontSize: 11,
                        color: hpPct > 0.5 ? '#cfe9d6' : hpPct > 0.25 ? '#e0a94b' : '#f0a8a8',
                    }}>
                        {unit.currentHp} / {unit.maxHp}
                    </span>
                </div>
                <div style={{ height: 8, background: '#15212e', borderRadius: 5, overflow: 'hidden', border: '1px solid #1e2e3c' }}>
                    <div style={{
                        width: `${hpPct * 100}%`, height: '100%', transition: 'width .3s',
                        background: hpPct > 0.5
                            ? 'linear-gradient(90deg, #3f9b5e, #5fd089)'
                            : hpPct > 0.25
                                ? 'linear-gradient(90deg, #9a7020, #e0a94b)'
                                : 'linear-gradient(90deg, #8a2020, #d04040)',
                    }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: '#9fb0bc', letterSpacing: 1 }}>ENERGÍA</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {Array.from({ length: Math.max(unit.energy, 3) }).map((_, i) => (
                            <span key={i} style={{
                                width: 11, height: 11, display: 'inline-block',
                                background: i < unit.energy ? '#e3c64b' : 'transparent',
                                border: i >= unit.energy ? '1px solid #3a4654' : 'none',
                                clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                            }} />
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Upgrades & Status ── */}
            {(unit.upgrades.length > 0 || unit.statusEffects.length > 0) && (
                <div style={{ padding: '0 15px 10px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {unit.upgrades.map((upg, i) => (
                        <span key={i} style={{
                            fontFamily: MONO, fontSize: 9, padding: '2px 7px', borderRadius: 4,
                            background: 'rgba(58,155,78,.15)', border: '1px solid #3a9b4e', color: '#5fd089',
                        }}>+{upg.value} {upg.type}</span>
                    ))}
                    {unit.statusEffects.map((eff, i) => (
                        <span key={i} style={{
                            fontFamily: MONO, fontSize: 9, padding: '2px 7px', borderRadius: 4,
                            background: 'rgba(154,74,68,.15)', border: '1px solid #9a4a44', color: '#f0a8a8',
                        }}>{eff.type}</span>
                    ))}
                </div>
            )}

            {/* ── Actions ── */}
            {showActions && (
                <div style={{ padding: '0 15px 12px' }}>
                    <div style={{
                        fontFamily: CHAKRA, fontSize: 10, color: '#6c7c88', letterSpacing: 2, fontWeight: 600,
                        borderBottom: '1px solid #1b2a38', paddingBottom: 6, marginBottom: 9,
                    }}>ACCIONES</div>

                    <div style={{ fontFamily: MONO, fontSize: 9, color: '#3f4d5c', letterSpacing: 1, marginBottom: 5 }}>
                        MOVIMIENTO
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                        {actionBtn('🚶 Avanzar', onMove, hasMoved)}
                        {actionBtn('💨 Dash ×2', onDash, hasUsedPrimary, '#ce93d8')}
                    </div>

                    <div style={{ fontFamily: MONO, fontSize: 9, color: '#3f4d5c', letterSpacing: 1, marginBottom: 5 }}>
                        ACCIÓN PRIMARIA
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {actionBtn('⚡ Energize', onEnergize, hasUsedPrimary, '#e3c64b')}
                        {actionBtn('🏠 Rescue', onRescue, hasUsedPrimary || !canRescue, '#5fd089')}
                    </div>
                </div>
            )}

            {/* ── Weapons ── */}
            <div style={{ padding: '4px 15px 8px' }}>
                <div style={{
                    fontFamily: CHAKRA, fontSize: 10, color: '#6c7c88', letterSpacing: 2, fontWeight: 600,
                    borderBottom: '1px solid #1b2a38', paddingBottom: 6, marginBottom: 8,
                }}>ARMAS</div>
                {unit.weapons.map((w, idx) => {
                    const isSel = selectedWeaponIndex === idx
                    return (
                        <div key={idx} style={{ marginBottom: idx < unit.weapons.length - 1 ? 11 : 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                                <span style={{ fontFamily: PLEX, fontWeight: 600, fontSize: 14, color: '#e6eef4' }}>{w.name}</span>
                                <div style={{ display: 'flex', gap: 7, fontFamily: MONO, fontSize: 11 }}>
                                    <span style={{ color: '#5fb0e0' }}>R{w.range}</span>
                                    <span style={{ color: '#ee8888' }}>S{w.strength}</span>
                                    <span style={{ color: '#e0a94b' }}>TL{w.tlCost}</span>
                                </div>
                            </div>
                            {(w.critEffect || w.effect) && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 3 }}>
                                    <span style={{ color: '#d27d2e', fontSize: 11 }}>★</span>
                                    <span style={{ fontSize: 11, color: '#9aa8b2', lineHeight: 1.3 }}>
                                        {w.critEffect || w.effect}
                                    </span>
                                </div>
                            )}
                            {showActions && !hasUsedPrimary && (
                                <button
                                    onClick={() => onAttack?.(idx)}
                                    style={{
                                        marginTop: 6, width: '100%',
                                        background: isSel ? 'rgba(154,74,68,.22)' : 'rgba(31,143,168,.08)',
                                        border: `1px solid ${isSel ? '#c66' : '#2f9fbd55'}`,
                                        borderRadius: 7, padding: '5px 10px',
                                        color: isSel ? '#f0a8a8' : accentColor,
                                        fontFamily: PLEX, fontWeight: 600, fontSize: 11,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {isSel ? '⚔ Atacando…' : '⚔ Atacar'}
                                </button>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* ── Abilities ── */}
            {unit.abilities.length > 0 && (
                <div style={{ padding: '6px 15px 12px' }}>
                    <div style={{
                        fontFamily: CHAKRA, fontSize: 10, color: '#6c7c88', letterSpacing: 2, fontWeight: 600,
                        borderBottom: '1px solid #1b2a38', paddingBottom: 6, marginBottom: 9,
                    }}>HABILIDADES</div>
                    {unit.abilities.map((ab, i) => {
                        const { bg, label } = ABILITY_TYPE[ab.type]
                        const canUse = showActions && !hasUsedPrimary && ab.type === 'CMD'
                        const noEnergy = ab.energyCost != null && unit.energy < ab.energyCost
                        const notImpl = !ab.abilityData
                        const disabled = noEnergy || notImpl
                        return (
                            <div key={i} style={{
                                background: '#0c1722', border: '1px solid #1a2836', borderRadius: 8,
                                padding: '9px 11px', marginBottom: i < unit.abilities.length - 1 ? 8 : 0,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span style={{
                                        fontFamily: MONO, fontSize: 9, fontWeight: 600, color: '#fff',
                                        background: bg, padding: '2px 7px', borderRadius: 4, letterSpacing: .5,
                                    }}>{label}</span>
                                    <span style={{ fontFamily: PLEX, fontWeight: 600, fontSize: 13, color: '#e6eef4', flex: 1 }}>
                                        {ab.name}
                                    </span>
                                    {ab.energyCost != null && (
                                        <span style={{ color: unit.energy >= ab.energyCost ? '#e3c64b' : '#3a4654', fontSize: 11 }}>
                                            {'◆'.repeat(ab.energyCost)}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: 11, color: '#9aa8b2', lineHeight: 1.35 }}>{ab.description}</div>
                                {canUse && (
                                    <button
                                        onClick={() => !disabled && onUseAbility?.(i)}
                                        disabled={disabled}
                                        title={notImpl ? 'No implementada' : noEnergy ? 'Energía insuficiente' : undefined}
                                        style={{
                                            marginTop: 8, width: '100%',
                                            background: disabled ? 'transparent' : 'rgba(171,71,188,.15)',
                                            border: `1px solid ${disabled ? '#2a3a52' : '#ab47bc88'}`,
                                            borderRadius: 7, padding: '5px 10px',
                                            color: disabled ? '#3f4d5c' : '#ce93d8',
                                            fontFamily: PLEX, fontWeight: 600, fontSize: 11,
                                            cursor: disabled ? 'not-allowed' : 'pointer',
                                        }}
                                    >Usar habilidad</button>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* ── End turn ── */}
            {showActions && (
                <div style={{ padding: '0 15px 15px', display: 'flex', gap: 6 }}>
                    <button
                        onClick={onEndTurn}
                        style={{
                            flex: 1,
                            background: 'linear-gradient(180deg, #28c0dd, #1f8fa8)',
                            border: 'none', borderRadius: 10,
                            color: '#04222a', fontFamily: PLEX, fontWeight: 700, fontSize: 13,
                            padding: '10px 16px', cursor: 'pointer',
                            boxShadow: '0 4px 14px rgba(31,143,168,.35)',
                        }}
                    >Pasar turno ▸</button>
                    <button
                        onClick={onCancel}
                        style={{
                            background: 'transparent', border: '1px solid #2a3a52', borderRadius: 10,
                            color: '#7e8a92', fontFamily: MONO, fontSize: 14,
                            padding: '10px 12px', cursor: 'pointer',
                        }}
                    >✕</button>
                </div>
            )}
        </div>
        </>
    )
}
