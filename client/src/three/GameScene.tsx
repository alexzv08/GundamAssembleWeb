import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Suspense } from 'react'
import type { GameState } from '../types'
import { GameBoard } from './GameBoard'
import { UnitMesh } from './UnitMesh'

interface GameSceneProps {
  gameState: GameState
  selectedUnitId: string | null
  reachableHexes: Set<string>
  attackableHexes: Set<string>
  onHexClick: (key: string) => void
  onUnitClick: (unitId: string) => void
}

export function GameScene({
  gameState,
  selectedUnitId,
  reachableHexes,
  attackableHexes,
  onHexClick,
  onUnitClick,
}: GameSceneProps) {
  const selectedUnit = selectedUnitId ? gameState.units[selectedUnitId] : null
  const selectedHexKey = selectedUnit?.position
    ? `${selectedUnit.position.q},${selectedUnit.position.r}`
    : null

  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      shadows
    >
      {/* Cámara isométrica */}
      <PerspectiveCamera
        makeDefault
        position={[0, 12, 10]}
        fov={45}
      />

      {/* Controles de órbita — el jugador puede rotar y hacer zoom */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={5}
        maxDistance={40}
        maxPolarAngle={Math.PI / 2.2}
        target={[9, 0, 12]}
        />

      {/* Iluminación */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 20, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-10, 10, -10]} intensity={0.3} />

      {/* Tablero */}
      <Suspense fallback={null}>
        <GameBoard
          board={gameState.board}
          selectedHex={selectedHexKey}
          reachableHexes={reachableHexes}
          attackableHexes={attackableHexes}
          onHexClick={onHexClick}
        />

        {/* Unidades */}
        {Object.values(gameState.units).map(unit => (
          <UnitMesh
            key={unit.id}
            unit={unit}
            isActive={gameState.activeUnitId === unit.id}
            isSelected={selectedUnitId === unit.id}
            onClick={() => onUnitClick(unit.id)}
          />
        ))}
      </Suspense>
    </Canvas>
  )
}