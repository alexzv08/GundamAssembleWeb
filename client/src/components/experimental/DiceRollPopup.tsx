import { useEffect, useState } from 'react'

export interface DiceRollPopupProps {
    attackerName: string
    targetName: string
    weaponName: string
    rolls: number[]
    hitThreshold?: number
    critThreshold?: number   // d8: valores 1–8
    totalHits: number
    damage: number
    onClose: () => void
}

const MONO = "'IBM Plex Mono', monospace"
const CHAKRA = "'Chakra Petch', sans-serif"
const PLEX = "'IBM Plex Sans', system-ui, sans-serif"

export function DiceRollPopup({
    attackerName, targetName, weaponName,
    rolls, hitThreshold = 4, critThreshold = 7,
    totalHits, damage, onClose,
}: DiceRollPopupProps) {
    const [revealed, setRevealed] = useState<boolean[]>(rolls.map(() => false))

    useEffect(() => {
        rolls.forEach((_, i) => {
            setTimeout(() => {
                setRevealed(prev => {
                    const next = [...prev]
                    next[i] = true
                    return next
                })
            }, i * 140 + 80)
        })
    }, [])  // eslint-disable-line react-hooks/exhaustive-deps

    const crits = rolls.filter(r => r >= critThreshold).length

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(3,8,18,.72)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(5px)',
            }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'linear-gradient(180deg, #0e1c2e, #0b1521)',
                    border: '1px solid #2f9fbd',
                    borderRadius: 18,
                    padding: '24px 28px 20px',
                    minWidth: 340, maxWidth: 440,
                    boxShadow: '0 0 50px rgba(47,159,189,.2), 0 24px 60px rgba(0,0,0,.7)',
                    animation: 'popIn .18s ease',
                }}
            >
                {/* Header */}
                <div style={{ marginBottom: 18 }}>
                    <div style={{
                        fontFamily: CHAKRA, fontSize: 10, color: '#8fe6f7',
                        letterSpacing: 2, fontWeight: 600, marginBottom: 6,
                    }}>
                        RESULTADO DE ATAQUE
                    </div>
                    <div style={{ fontFamily: PLEX, fontSize: 13, color: '#9aa8b2', lineHeight: 1.5 }}>
                        <span style={{ color: '#dbe4ec', fontWeight: 600 }}>{attackerName}</span>
                        {' '}<span style={{ color: '#3f4d5c' }}>→</span>{' '}
                        <span style={{ color: '#dbe4ec', fontWeight: 600 }}>{targetName}</span>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: '#e0a94b', marginTop: 2 }}>
                        {weaponName}
                    </div>
                </div>

                {/* Dice grid */}
                <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 10,
                    marginBottom: 18, justifyContent: 'center',
                    minHeight: 62,
                }}>
                    {rolls.map((val, i) => {
                        const isCrit = val >= critThreshold
                        const isHit = val >= hitThreshold
                        const show = revealed[i]
                        const color = isCrit ? '#e0a94b' : isHit ? '#8fe6f7' : '#3f4d5c'
                        const bg = isCrit
                            ? 'rgba(224,169,75,.12)'
                            : isHit
                                ? 'rgba(143,230,247,.08)'
                                : 'rgba(15,22,34,.7)'
                        const border = isCrit ? '#b8882a' : isHit ? '#2f9fbd' : '#1e2e3c'
                        return (
                            <div
                                key={i}
                                style={{
                                    width: 56, height: 56,
                                    borderRadius: 11,
                                    background: bg,
                                    border: `2px solid ${border}`,
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center',
                                    boxShadow: isCrit
                                        ? '0 0 14px rgba(224,169,75,.3)'
                                        : isHit
                                            ? '0 0 8px rgba(143,230,247,.15)'
                                            : 'none',
                                    opacity: show ? 1 : 0,
                                    transform: show ? 'scale(1) translateY(0)' : 'scale(.4) translateY(8px)',
                                    transition: 'opacity .18s ease, transform .18s ease',
                                }}
                            >
                                <span style={{
                                    fontFamily: MONO, fontSize: 24, fontWeight: 700,
                                    color, lineHeight: 1,
                                }}>{val}</span>
                                <span style={{
                                    fontFamily: MONO, fontSize: 8, letterSpacing: .5, marginTop: 2,
                                    color: isCrit ? '#e0a94b' : isHit ? '#8fe6f7' : '#2a3a52',
                                }}>
                                    {isCrit ? 'CRIT' : isHit ? 'HIT' : 'FALLO'}
                                </span>
                            </div>
                        )
                    })}
                </div>

                {/* Legend */}
                <div style={{
                    display: 'flex', gap: 16, marginBottom: 16,
                    justifyContent: 'center', flexWrap: 'wrap',
                }}>
                    {[
                        { dot: '#2a3a52', label: `FALLO  1–${hitThreshold - 1}` },
                        { dot: '#2f9fbd', label: `HIT  ${hitThreshold}–${critThreshold - 1}` },
                        { dot: '#e0a94b', label: `CRIT  ${critThreshold}+` },
                    ].map(({ dot, label }) => (
                        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{
                                width: 7, height: 7, borderRadius: '50%',
                                background: dot, display: 'inline-block', flexShrink: 0,
                            }} />
                            <span style={{ fontFamily: MONO, fontSize: 9, color: '#4a5a6a', letterSpacing: .5 }}>
                                {label}
                            </span>
                        </span>
                    ))}
                </div>

                {/* Summary bar */}
                <div style={{
                    background: 'rgba(8,14,24,.8)',
                    border: '1px solid #1a2836',
                    borderRadius: 12, padding: '14px 20px',
                    display: 'flex', justifyContent: 'space-around',
                    marginBottom: 18,
                }}>
                    {[
                        { value: rolls.length, label: 'DADOS', color: '#5e6a72' },
                        { value: totalHits, label: 'IMPACTOS', color: '#8fe6f7' },
                        { value: crits, label: 'CRITS', color: '#e0a94b' },
                        { value: damage, label: 'DAÑO', color: '#ee8888' },
                    ].map(({ value, label, color }, i, arr) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
                            <div style={{ textAlign: 'center', padding: '0 14px' }}>
                                <div style={{
                                    fontFamily: MONO, fontSize: 26, fontWeight: 700,
                                    color, lineHeight: 1,
                                }}>{value}</div>
                                <div style={{
                                    fontFamily: MONO, fontSize: 8, color: '#3f4d5c',
                                    marginTop: 4, letterSpacing: 1,
                                }}>{label}</div>
                            </div>
                            {i < arr.length - 1 && (
                                <div style={{ width: 1, background: '#1a2836', alignSelf: 'stretch' }} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Close */}
                <button
                    onClick={onClose}
                    style={{
                        width: '100%',
                        background: 'rgba(31,143,168,.08)',
                        border: '1px solid #2f9fbd44',
                        borderRadius: 10,
                        color: '#8fe6f7', fontFamily: PLEX, fontWeight: 600, fontSize: 12,
                        padding: '10px', cursor: 'pointer',
                        letterSpacing: .5,
                    }}
                >Continuar</button>
            </div>
        </div>
    )
}
