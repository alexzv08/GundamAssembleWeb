import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3, type Mesh } from 'three'
import type { GameState } from '../types/gameState'
import { hexToWorld } from './hexUtils'
import { hexKey } from '../game/hexGrid'
import { C } from '../theme'

// Trazo luminoso del atacante a cada objetivo durante un instante tras cada ataque.
export function AttackTracer({ gameState, myPlayerId }: { gameState: GameState; myPlayerId: string | null }) {
  const report = gameState.lastAttack
  const sig = report ? JSON.stringify([report.attackerId, report.rolls, report.targets.map(t => t.id)]) : ''
  const [beams, setBeams] = useState<{ key: string; from: Vector3; to: Vector3; color: string }[]>([])
  const last = useRef(sig)

  useEffect(() => {
    if (!report || sig === last.current) return
    last.current = sig
    const attacker = gameState.units[report.attackerId]
    if (!attacker?.position) return
    const at = (q: number, r: number) => {
      const h = gameState.board[hexKey({ q, r })]
      const [x, y, z] = hexToWorld(q, r, h?.elevation ?? 0)
      return new Vector3(x, y + 0.75, z)
    }
    const from = at(attacker.position.q, attacker.position.r)
    const color = attacker.playerId === myPlayerId ? C.ally : C.enemy
    const list = report.targets.map((t, i) => {
      const pos = t.kind === 'unit' ? gameState.units[t.id]?.position
        : t.kind === 'rws' ? gameState.rws[t.id]?.position
          : Object.values(gameState.board).find(h => h.garrisonToken?.id === t.id)?.coord
      return pos ? { key: `${sig}-${i}`, from, to: at(pos.q, pos.r), color } : null
    }).filter((b): b is NonNullable<typeof b> => !!b)
    const show = setTimeout(() => setBeams(list), 0)
    const hide = setTimeout(() => setBeams([]), 900)
    return () => { clearTimeout(show); clearTimeout(hide) }
    // Solo cuando llega un ataque nuevo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  return <>{beams.map(b => <Beam key={b.key} from={b.from} to={b.to} color={b.color} />)}</>
}

function Beam({ from, to, color }: { from: Vector3; to: Vector3; color: string }) {
  const ref = useRef<Mesh>(null)
  const born = useRef<number | null>(null)
  const dir = to.clone().sub(from)
  const len = dir.length()
  const mid = from.clone().add(to).multiplyScalar(0.5)
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize())
  useFrame(({ clock }) => {
    if (!ref.current) return
    if (born.current === null) born.current = clock.elapsedTime
    const t = (clock.elapsedTime - born.current) / 0.9
    ;(ref.current.material as { opacity: number }).opacity = Math.max(0, 1 - t)
    ref.current.scale.set(1 + t * 2, 1, 1 + t * 2)
  })
  return (
    <mesh ref={ref} position={mid} quaternion={quat}>
      <cylinderGeometry args={[0.035, 0.035, len, 8, 1, true]} />
      <meshBasicMaterial color={color} transparent opacity={1} toneMapped={false} depthWrite={false} />
    </mesh>
  )
}
