import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { GameState } from '../types/gameState'
import { GameBoard } from './GameBoard'
import { UnitMesh } from './UnitMesh'
import { RwsMesh } from './RwsMesh'
import { AttackTracer } from './AttackTracer'
import { TerrainProps } from './TerrainProps'
import { SkyDome } from './SkyDome'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { hexKey } from '../game/hexGrid'
import { hexToWorld } from './hexUtils'
import { C } from '../theme'

interface GameSceneProps {
  gameState: GameState
  myPlayerId: 'player1' | 'player2' | null
  selectedUnitId: string | null
  reachableHexes: Set<string>
  attackableHexes: Set<string>
  onHexClick: (key: string) => void
  onUnitClick: (unitId: string) => void
  onTokenHover?: (info: string | null) => void
  logHighlightedHexes?: Set<string>
  /** Hex al que se acerca la cámara (la unidad activa al empezar su activación) */
  focusKey?: string | null
  compact?: boolean
}

// Ambientación: la mesa de juego flota sobre una superficie de proyección
// (rejilla cian tenue) en una sala oscura; luz principal cálida desde arriba a la
// izquierda, contraluz fría y niebla que funde los bordes del tablero con el fondo.
export function GameScene({
  gameState, myPlayerId, selectedUnitId, reachableHexes, attackableHexes,
  onHexClick, onUnitClick, onTokenHover, logHighlightedHexes, focusKey, compact = false,
}: GameSceneProps) {
  const selectedUnit = selectedUnitId ? gameState.units[selectedUnitId] : null
  const selectedHexKey = selectedUnit?.position ? hexKey(selectedUnit.position) : null

  // Centro y tamaño del tablero
  const bounds = useMemo(() => {
    const pts = Object.values(gameState.board).map(h => hexToWorld(h.coord.q, h.coord.r, 0))
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[2])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
    return { cx, cz, size }
    // El tablero no cambia de forma durante la partida
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.gameId])

  const camDist = bounds.size * (compact ? 1.05 : 0.72)

  return (
    <Canvas style={{ width: '100%', height: '100%', background: C.bgDeep }} shadows dpr={[1, 2]}
      camera={{ position: [bounds.cx, camDist * 0.85, bounds.cz + camDist * 0.75], fov: 42 }}>
      <color attach="background" args={[C.bgDeep]} />
      <fog attach="fog" args={['#0b1729', camDist * 1.2, camDist * 3]} />
      <SkyDome radius={Math.max(90, camDist * 4)} />

      <OrbitControlsWithFocus target={[bounds.cx, 0, bounds.cz]} focusKey={focusKey ?? null} gameState={gameState} maxDistance={camDist * 1.8} />

      <hemisphereLight args={['#c4d2ff', '#2a2110', 0.9]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[bounds.cx - 14, 26, bounds.cz - 8]} intensity={2.1} color="#ffe9c9" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-bounds.size} shadow-camera-right={bounds.size}
        shadow-camera-top={bounds.size} shadow-camera-bottom={-bounds.size} />
      <directionalLight position={[bounds.cx + 16, 8, bounds.cz + 20]} intensity={0.55} color="#5fb8ff" />

      {/* Mesa de proyección bajo el tablero */}
      <mesh position={[bounds.cx, -0.42, bounds.cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[bounds.size * 1.1, 64]} />
        <meshStandardMaterial color="#0b1222" roughness={0.9} metalness={0.2} />
      </mesh>
      <gridHelper args={[bounds.size * 2.2, Math.round(bounds.size * 1.1), '#1d4a66', '#11233a']} position={[bounds.cx, -0.41, bounds.cz]} />

      <Suspense fallback={null}>
        <TerrainProps board={gameState.board} />
        <GameBoard
          board={gameState.board}
          myPlayerId={myPlayerId}
          selectedHex={selectedHexKey}
          reachableHexes={reachableHexes}
          attackableHexes={attackableHexes}
          onHexClick={onHexClick}
          onTokenHover={onTokenHover}
          logHighlightedHexes={logHighlightedHexes}
        />

        {Object.values(gameState.rws ?? {}).map(rws => rws.position && (
          <RwsMesh
            key={rws.id}
            rws={rws}
            elevation={gameState.board[hexKey(rws.position)]?.elevation ?? 0}
            isMine={rws.owner === myPlayerId}
            onClick={() => onHexClick(hexKey(rws.position!))}
            onHover={onTokenHover}
          />
        ))}

        <AttackTracer gameState={gameState} myPlayerId={myPlayerId} />

        {Object.values(gameState.units).map(unit => (
          <UnitMesh
            key={unit.id}
            unit={unit}
            elevation={unit.position ? (gameState.board[hexKey(unit.position)]?.elevation ?? 0) : 0}
            isActive={gameState.activeUnitId === unit.id}
            isSelected={selectedUnitId === unit.id}
            isMine={unit.playerId === myPlayerId}
            onClick={() => onUnitClick(unit.id)}
          />
        ))}
      </Suspense>

      {/* Postprocesado: los brillos (resaltados, peanas, haces de los Objetivos)
          irradian y una viñeta suave centra la mirada. Solo en escritorio. */}
      {!compact && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.75} luminanceThreshold={0.62} luminanceSmoothing={0.2} />
          <Vignette offset={0.32} darkness={0.62} />
        </EffectComposer>
      )}
    </Canvas>
  )
}

// OrbitControls que se desliza hasta `focusKey` cuando cambia (H1: la cámara
// busca a la unidad activa). Mantiene el ángulo y la distancia del jugador.
function OrbitControlsWithFocus({ target, focusKey, gameState, maxDistance }: {
  target: [number, number, number]; focusKey: string | null; gameState: GameState; maxDistance: number
}) {
  const controls = useRef<OrbitControlsImpl>(null)
  const goal = useRef<Vector3 | null>(null)
  const { camera } = useThree()

  useEffect(() => {
    if (!focusKey) return
    const hex = gameState.board[focusKey]
    if (!hex) return
    const [x, y, z] = hexToWorld(hex.coord.q, hex.coord.r, hex.elevation)
    goal.current = new Vector3(x, y, z)
    // Solo cuando cambia la unidad enfocada, no en cada actualización del estado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  useFrame((_, delta) => {
    const c = controls.current
    if (!c || !goal.current) return
    const step = goal.current.clone().sub(c.target).multiplyScalar(1 - Math.exp(-delta * 4))
    c.target.add(step)
    camera.position.add(step)
    c.update()
    if (c.target.distanceTo(goal.current) < 0.02) goal.current = null
  })

  return (
    <OrbitControls ref={controls} makeDefault target={target} enableDamping dampingFactor={0.12}
      minDistance={5} maxDistance={maxDistance} maxPolarAngle={Math.PI / 2.25}
      onStart={() => { goal.current = null }} />
  )
}
