import { useState } from 'react'
import type { Unit } from '../../types/units'
import { C, FONT, eyebrow, button, ABILITY_TYPE, chip } from '../../theme'

interface UnitPanelProps {
    unit: Unit
    isActive: boolean
    isMyUnit: boolean
    isMyTurn: boolean
    isSelected: boolean
    advanced: boolean
    usedCommands: number[]
    freeDashes: number
    freeAttacks: number[]
    hasUsedPrimary: boolean
    selectedWeaponIndex: number | null
    currentTlRound?: number | null
    canRescue?: boolean
    /** Está sobre su Base y aún puede moverse: no puede terminar ahí */
    mustLeaveBase?: boolean
    /** Modo de selección actual, para marcar el botón pulsado */
    mode?: string
    compact?: boolean
    onMove?: () => void
    onDash?: () => void
    onAttack?: (weaponIndex: number) => void
    onUseAbility?: (abilityIndex: number) => void
    onEnergize?: () => void
    onRescue?: () => void
    onEndTurn?: () => void
    onCancel?: () => void
    onToggleAutoResponses?: (enabled: boolean) => void
    onClose?: () => void
}

const UPGRADE_LABEL: Record<string, string> = {
    attack: 'Strength', movement: 'Speed', shield: 'Shield', energy: 'Energy',
}
const STATUS_LABEL: Record<string, string> = { disarm: 'Disarm', fracture: 'Fracture', slow: 'Slow' }

export function UnitPanel({
    unit, isActive, isMyUnit, isMyTurn, advanced, usedCommands, freeDashes, freeAttacks, hasUsedPrimary,
    selectedWeaponIndex, currentTlRound, canRescue = false, mustLeaveBase = false, mode, compact = false,
    onMove, onDash, onAttack, onUseAbility, onEnergize, onRescue, onEndTurn, onCancel, onToggleAutoResponses, onClose,
}: UnitPanelProps) {
    const side = isMyUnit ? C.ally : C.enemy
    const hpPercent = unit.currentHp / unit.maxHp
    const hpColor = hpPercent > 0.5 ? C.ok : hpPercent > 0.25 ? C.warn : C.danger
    // H1: en tu turno, la unidad activa enseña sus acciones sin tener que pulsar el modelo
    const showActions = isActive && isMyUnit && isMyTurn
    const canDash = !(hasUsedPrimary && freeDashes === 0)
    const attackable = !hasUsedPrimary || freeAttacks.length > 0
    // En móvil los detalles (armas, habilidades) se despliegan a petición
    const [details, setDetails] = useState(false)
    const showDetails = !compact || details || !showActions

    const actionBtn = (active: boolean, enabled: boolean, variant: 'primary' | 'amber' | 'danger' = 'primary') => ({
        ...button(active ? 'amber' : variant, !enabled),
        ...(active ? { boxShadow: `0 0 0 1px ${C.amber}` } : {}),
    })

    return (
        <div style={{
            width: compact ? '100%' : 300,
            background: C.panel, backdropFilter: 'blur(6px)',
            border: `1px solid ${isActive ? side : C.line}`,
            borderRadius: 10, color: C.text, fontSize: 12.5,
            boxShadow: isActive ? `0 0 24px ${side}26, 0 8px 24px rgba(0,0,0,0.45)` : '0 8px 24px rgba(0,0,0,0.45)',
            maxHeight: compact ? '42vh' : '100%', overflowY: 'auto',
            animation: 'ga-rise 160ms ease-out',
        }}>
            {/* Cabecera */}
            <div style={{
                padding: '10px 14px 9px', borderBottom: `1px solid ${C.line}`,
                display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start',
                position: 'sticky', top: 0, zIndex: 1,
                background: `linear-gradient(180deg, ${side}1f, ${C.panelSolid} 90%)`,
            }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 17, color: side, lineHeight: 1.15 }}>{unit.name}</span>
                        {isActive && <span style={{ ...chip(C.amber), animation: 'ga-pulse 2s infinite' }}>Activa</span>}
                    </div>
                    {unit.signature && !compact && <div style={{ color: C.textSoft, fontSize: 11, fontStyle: 'italic' }}>{unit.signature}</div>}
                    {!compact && <div style={{ color: C.textDim, fontSize: 11 }}>{unit.traits.join(' · ')}</div>}
                    {!unit.position && <div style={{ color: C.amber, fontSize: 11, marginTop: 2 }}>En la Reserva: se despliega en su próxima activación</div>}
                </div>
                <div style={{ textAlign: 'right', fontFamily: FONT.mono, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                    {onClose && <button onClick={onClose} aria-label="Cerrar panel" style={{ ...button('subtle'), padding: '0 6px', fontSize: 11 }}>✕</button>}
                    <span style={{ color: C.amber }}>{unit.vp} VP</span>
                    <span style={{ color: C.textSoft }} title="Posición en la Timeline">
                        T{currentTlRound ?? unit.startingTl}
                    </span>
                </div>
            </div>

            <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* HP + Energy */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={eyebrow}>HP</span>
                            <span style={{ fontFamily: FONT.mono, color: hpColor }}>{unit.currentHp} / {unit.maxHp}</span>
                        </div>
                        <div style={{ height: 6, background: C.line, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${hpPercent * 100}%`, background: hpColor, transition: 'width 0.4s' }} />
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={eyebrow}>Energy</div>
                        <div style={{ fontFamily: FONT.mono, color: unit.energy ? C.amber : C.textDim, fontSize: 15 }}>
                            {unit.energy > 0 ? '◆'.repeat(Math.min(unit.energy, 6)) : '0'}
                        </div>
                    </div>
                </div>

                {/* Upgrades y estados */}
                {(unit.upgrades.length > 0 || unit.statusEffects.length > 0) && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {unit.upgrades.map((upg, i) => {
                            const used = upg.type === 'shield' && upg.active === false
                            return (
                                <span key={i} title={used ? 'Shield usado: se reactiva al empezar su próxima activación' : undefined}
                                    style={{ ...chip(C.ok), opacity: used ? 0.45 : 1, textDecoration: used ? 'line-through' : 'none' }}>
                                    {UPGRADE_LABEL[upg.type] ?? upg.type}{upg.value > 1 ? ` ×${upg.value}` : ''}
                                </span>
                            )
                        })}
                        {unit.statusEffects.map((eff, i) => <span key={i} style={chip(C.danger)}>{STATUS_LABEL[eff.type] ?? eff.type}</span>)}
                    </div>
                )}

                {/* Acciones */}
                {showActions && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 8, background: `${C.ally}0d`, border: `1px solid ${C.ally}33` }}>
                        <div style={{ ...eyebrow, color: C.ally }}>Tu turno · acciones</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button onClick={onMove} disabled={advanced} style={actionBtn(mode === 'moving', !advanced)}
                                title="Advance: hasta 3 hexes + Speed, sin coste de TL, una vez por activación">Avanzar</button>
                            <button onClick={onDash} disabled={!canDash} style={actionBtn(mode === 'dashing', canDash)}
                                title={freeDashes > 0 ? 'Dash adicional a TL 0' : hasUsedPrimary ? 'Ya usaste tu acción primaria' : 'Dash (acción primaria): 2 TL'}>
                                Dash{freeDashes > 0 ? ' · TL 0' : ' · 2 TL'}
                            </button>
                            <button onClick={onEnergize} disabled={hasUsedPrimary} style={actionBtn(false, !hasUsedPrimary)}
                                title="Acción primaria: +1 Energy, 2 TL">Energize · 2 TL</button>
                            <button onClick={onRescue} disabled={hasUsedPrimary || !canRescue} style={actionBtn(false, !hasUsedPrimary && canRescue)}
                                title={!canRescue ? 'No hay ninguna Garrison aliada adyacente' : 'Rescatar Garrison aliada (+2 VP), 2 TL'}>Rescue · 2 TL</button>
                        </div>

                        {attackable && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                {unit.weapons.map((w, idx) => (hasUsedPrimary && !freeAttacks.includes(idx)) ? null : (
                                    <button key={idx} onClick={() => onAttack?.(idx)}
                                        style={{ ...actionBtn(selectedWeaponIndex === idx && mode === 'attacking', true, 'danger'), display: 'flex', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}>
                                        <span>Atacar · {w.name}</span>
                                        <span style={{ fontFamily: FONT.mono, color: C.textSoft }}>
                                            {w.area ? (w.area === 'cone' ? 'cono ' : 'flor ') : ''}R{w.range} S{w.strength} TL{hasUsedPrimary ? 0 : w.tlCost}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={onEndTurn} disabled={!hasUsedPrimary || mustLeaveBase}
                                title={mustLeaveBase ? 'No puedes terminar sobre tu Base' : hasUsedPrimary ? undefined : 'Antes haz una acción primaria: Atacar, Dash, Energize o Rescue'}
                                style={{ ...button(hasUsedPrimary && !mustLeaveBase ? 'amber' : 'ghost', !hasUsedPrimary || mustLeaveBase), flex: 1, fontWeight: 600 }}>
                                Terminar activación
                            </button>
                            {mode && mode !== 'none' && (
                                <button onClick={onCancel} style={button('ghost')} title="Cancelar la selección">Cancelar</button>
                            )}
                        </div>
                        {!hasUsedPrimary && <div style={{ color: C.textDim, fontSize: 11 }}>Falta tu acción primaria: Atacar, Dash, Energize o Rescue.</div>}
                        {mustLeaveBase && <div style={{ color: C.warn, fontSize: 11 }}>Estás sobre tu Base: muévete a otro hex antes de terminar.</div>}
                    </div>
                )}

                {compact && showActions && (
                    <button onClick={() => setDetails(d => !d)} style={{ ...button('subtle'), alignSelf: 'flex-start' }}>
                        {details ? 'Ocultar detalles' : 'Detalles: armas y habilidades'}
                    </button>
                )}

                {/* Armas */}
                {!showActions && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={eyebrow}>Armas</div>
                        {unit.weapons.map((w, i) => (
                            <div key={i} style={{ background: C.panelRaised, border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 9px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                                    <span style={{ fontWeight: 600 }}>{w.name}</span>
                                    <span style={{ fontFamily: FONT.mono, fontSize: 11, display: 'flex', gap: 7 }}>
                                        {w.area && <span style={{ color: C.response }} title="Plantilla de área (forma aproximada)">{w.area === 'cone' ? 'Cono' : 'Flor'}</span>}
                                        <span style={{ color: C.ally }} title="Range">R{w.range}</span>
                                        <span style={{ color: C.amber }} title="Strength">S{w.strength}</span>
                                        <span style={{ color: C.textSoft }} title="Coste de Timeline">TL{w.tlCost}</span>
                                    </span>
                                </div>
                                {w.effect && <div style={{ color: C.textSoft, fontSize: 11 }}>{w.effect}</div>}
                                {w.critEffect && <div style={{ color: C.warn, fontSize: 11 }}>★ Crit: {w.critEffect}</div>}
                            </div>
                        ))}
                    </div>
                )}

                {showDetails && isMyUnit && onToggleAutoResponses && unit.abilities.some(a => a.type === 'RSP' && (a.energyCost ?? 0) > 0 && a.abilityData) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: C.textSoft, cursor: 'pointer' }}
                        title="Si está activo, sus Response con coste de Energy se usan solas cuando se cumple su condición">
                        <input id={`auto-${unit.id}`} type="checkbox" checked={unit.autoResponses !== false} onChange={e => onToggleAutoResponses(e.target.checked)} />
                        Usar sus Response con Energy automáticamente
                    </label>
                )}

                {/* Habilidades */}
                {showDetails && unit.abilities.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={eyebrow}>Habilidades</div>
                        {unit.abilities.map((ab, i) => {
                            const t = ABILITY_TYPE[ab.type]
                            const canUse = showActions && ab.type === 'CMD' && !usedCommands.includes(i)
                            const noEnergy = ab.energyCost != null && unit.energy < ab.energyCost
                            const notImplemented = !ab.abilityData
                            const disabled = noEnergy || notImplemented
                            return (
                                <div key={i} style={{ background: C.panelRaised, border: `1px solid ${C.line}`, borderRadius: 6, padding: '7px 9px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                                        <span style={chip(t.color)}>{t.label}</span>
                                        <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{ab.name}</span>
                                        {ab.energyCost != null && (
                                            <span style={{ fontFamily: FONT.mono, color: noEnergy ? C.textDim : C.amber, fontSize: 11 }} title={`Cuesta ${ab.energyCost} Energy`}>
                                                {'◆'.repeat(ab.energyCost)}
                                            </span>
                                        )}
                                        {canUse && (
                                            <button onClick={() => onUseAbility?.(i)} disabled={disabled}
                                                title={notImplemented ? 'Aún no implementada' : noEnergy ? 'Energy insuficiente' : undefined}
                                                style={{ ...button('primary', disabled), padding: '3px 9px' }}>Usar</button>
                                        )}
                                    </div>
                                    <div style={{ color: C.textSoft, fontSize: 11, lineHeight: 1.45 }}>{ab.description}</div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
