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
    canRescue?: boolean
    onMove?: () => void
    onDash?: () => void
    onAttack?: (weaponIndex: number) => void
    onEnergize?: () => void
    onRescue?: () => void
    onEndTurn?: () => void
    onCancel?: () => void
}

const abilityTypeColor = (type: 'CMD' | 'ONG' | 'RSP') => {
    if (type === 'CMD') return { bg: '#e65100', label: 'Command' }
    if (type === 'ONG') return { bg: '#2e7d32', label: 'Ongoing' }
    return { bg: '#6a1b9a', label: 'Response' }
}

const btn = (bg: string, border?: string, disabled?: boolean) => ({
    padding: '5px 10px',
    background: disabled ? '#1a1a1a' : bg,
    color: disabled ? '#444' : 'white',
    border: border ?? 'none',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 11,
    whiteSpace: 'nowrap' as const,
    opacity: disabled ? 0.5 : 1,
})

export function UnitPanel({
    unit,
    isActive,
    isMyUnit,
    isMyTurn,
    isSelected,
    hasMoved,
    hasUsedPrimary,
    selectedWeaponIndex,
    canRescue = false,
    onMove,
    onDash,
    onAttack,
    onEnergize,
    onRescue,
    onEndTurn,
    onCancel,
}: UnitPanelProps) {
    const factionColor = unit.playerId === 'player1' ? '#4fc3f7' : '#ef9a9a'
    const hpPercent = unit.currentHp / unit.maxHp
    const showActions = isActive && isMyUnit && isMyTurn && isSelected

    return (
        <div style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            width: 290,
            background: 'rgba(10,10,20,0.95)',
            border: `1px solid ${isActive ? factionColor : '#333'}`,
            borderRadius: 10,
            color: 'white',
            fontSize: 12,
            zIndex: 15,
            overflow: 'hidden',
            boxShadow: isActive ? `0 0 12px ${factionColor}44` : 'none',
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto',
        }}>

            {/* Cabecera */}
            <div style={{
                padding: '8px 12px',
                background: isActive ? `${factionColor}22` : 'rgba(255,255,255,0.04)',
                borderBottom: '1px solid #222',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                position: 'sticky',
                top: 0,
                zIndex: 1,
            }}>
                <div>
                    <div style={{ fontWeight: 'bold', fontSize: 14, color: factionColor }}>
                        {unit.name}
                        {isActive && <span style={{ fontSize: 10, color: '#f5c518', marginLeft: 6 }}>● ACTIVA</span>}
                    </div>
                    <div style={{ color: '#666', fontSize: 11 }}>{unit.traits.join(' · ')}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#f5c518', fontSize: 11 }}>VP {unit.vp}</div>
                    <div style={{ color: '#aaa', fontSize: 11 }}>TL {unit.startingTl}</div>
                </div>
            </div>

            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

                {/* HP + Energía */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ color: '#aaa' }}>HP</span>
                            <span style={{ color: hpPercent > 0.5 ? '#4caf50' : hpPercent > 0.25 ? '#ff9800' : '#ef5350' }}>
                                {unit.currentHp}/{unit.maxHp}
                            </span>
                        </div>
                        <div style={{ height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${hpPercent * 100}%`,
                                background: hpPercent > 0.5 ? '#4caf50' : hpPercent > 0.25 ? '#ff9800' : '#ef5350',
                                borderRadius: 2,
                                transition: 'width 0.3s',
                            }} />
                        </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#aaa', fontSize: 10 }}>Energía</div>
                        <div style={{ color: '#f5c518', fontSize: 14 }}>
                            {unit.energy > 0 ? '⚡'.repeat(unit.energy) : '—'}
                        </div>
                    </div>
                </div>

                {/* Upgrades y status */}
                {(unit.upgrades.length > 0 || unit.statusEffects.length > 0) && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {unit.upgrades.map((upg, i) => (
                            <span key={i} style={{
                                padding: '2px 6px', borderRadius: 4, fontSize: 10,
                                background: '#1a3a1a', border: '1px solid #2e7d32', color: '#81c784',
                            }}>+{upg.value} {upg.type}</span>
                        ))}
                        {unit.statusEffects.map((eff, i) => (
                            <span key={i} style={{
                                padding: '2px 6px', borderRadius: 4, fontSize: 10,
                                background: '#3a1a1a', border: '1px solid #c62828', color: '#ef9a9a',
                            }}>{eff.type}</span>
                        ))}
                    </div>
                )}

                {/* Acciones */}
                {showActions && (
                    <div>
                        <div style={{ color: '#666', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Acciones
                        </div>

                        {/* Fila 1: Movimiento */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                            <button onClick={onMove} disabled={hasMoved} style={btn('#1565c0', undefined, hasMoved)}>
                                🚶 Mover
                            </button>
                            <button onClick={onDash} disabled={hasUsedPrimary} style={btn('#6a1b9a', undefined, hasUsedPrimary)}>
                                💨 Dash
                            </button>
                        </div>

                        {/* Fila 2: Acciones primarias */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                            <button onClick={onEnergize} disabled={hasUsedPrimary} style={btn('#e65100', undefined, hasUsedPrimary)}>
                                ⚡ Energize
                            </button>
                            <button
                                onClick={onRescue}
                                disabled={hasUsedPrimary || !canRescue}
                                style={btn('#1b5e20', undefined, hasUsedPrimary || !canRescue)}
                                title={!canRescue ? 'No hay garrison aliada adyacente' : 'Rescatar garrison aliada (+2 VP)'}
                            >
                                🏠 Rescue
                            </button>
                        </div>

                        {/* Armas */}
                        {!hasUsedPrimary && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 4 }}>
                                {unit.weapons.map((weapon, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => onAttack?.(idx)}
                                        style={{
                                            ...btn(
                                                selectedWeaponIndex === idx ? '#b71c1c' : '#7f1414',
                                                selectedWeaponIndex === idx ? '1px solid #ff5252' : '1px solid #444'
                                            ),
                                            textAlign: 'left',
                                            width: '100%',
                                        }}
                                    >
                                        ⚔ {weapon.name}
                                        <span style={{ color: '#aaa', marginLeft: 6 }}>
                                            R{weapon.range} · S{weapon.strength} · TL{weapon.tlCost}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Pasar / Cancelar */}
                        <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={onEndTurn} style={{ ...btn('#333', '1px solid #555'), flex: 1 }}>
                                Pasar turno →
                            </button>
                            <button onClick={onCancel} style={btn('transparent', '1px solid #444')}>
                                ✕
                            </button>
                        </div>
                    </div>
                )}

                {/* Armas (solo info si no es turno activo) */}
                {!showActions && (
                    <div>
                        <div style={{ color: '#666', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Armas
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {unit.weapons.map((w, i) => (
                                <div key={i} style={{
                                    background: 'rgba(255,255,255,0.04)', border: '1px solid #2a2a2a',
                                    borderRadius: 6, padding: '5px 8px',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                        <span style={{ color: '#ddd', fontWeight: 'bold' }}>{w.name}</span>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <span style={{ color: '#4fc3f7' }}>R{w.range}</span>
                                            <span style={{ color: '#f5c518' }}>S{w.strength}</span>
                                            <span style={{ color: '#aaa' }}>TL{w.tlCost}</span>
                                        </div>
                                    </div>
                                    {w.critEffect && (
                                        <div style={{ color: '#ff7043', fontSize: 10 }}>★ {w.critEffect}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Habilidades */}
                {unit.abilities.length > 0 && (
                    <div>
                        <div style={{ color: '#666', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Habilidades
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {unit.abilities.map((ab, i) => {
                                const { bg, label } = abilityTypeColor(ab.type)
                                return (
                                    <div key={i} style={{
                                        background: 'rgba(255,255,255,0.04)', border: '1px solid #2a2a2a',
                                        borderRadius: 6, padding: '5px 8px',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                            <span style={{
                                                background: bg, borderRadius: 3, padding: '1px 5px',
                                                fontSize: 9, fontWeight: 'bold', color: 'white',
                                            }}>{label}</span>
                                            <span style={{ color: '#ddd', fontWeight: 'bold' }}>{ab.name}</span>
                                            {ab.energyCost && <span style={{ color: '#f5c518', fontSize: 10 }}>⚡</span>}
                                        </div>
                                        <div style={{ color: '#999', fontSize: 10, lineHeight: 1.4 }}>
                                            {ab.description}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}