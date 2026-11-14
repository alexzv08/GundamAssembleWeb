import { useEffect, useState } from 'react'
import type { BufferGeometry, Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

// Modelos GLB comprimidos con meshopt (ver tools/stl-to-glb.mjs): ya vienen en
// Y arriba, a escala del tablero y con la base en y = 0. Se cachean por URL y se
// comparten entre todas las piezas que usan el mismo modelo.
const cache = new Map<string, Promise<BufferGeometry | null>>()
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

function load(url: string): Promise<BufferGeometry | null> {
  let p = cache.get(url)
  if (!p) {
    p = loader.loadAsync(url).then(gltf => {
      let geo: BufferGeometry | null = null
      gltf.scene.traverse(o => { if (!geo && (o as Mesh).isMesh) geo = (o as Mesh).geometry })
      return geo
    }).catch(() => null)   // sin modelo: se dibuja la pieza genérica
    cache.set(url, p)
  }
  return p
}

export function useUnitModel(url: string | null): BufferGeometry | null {
  const [state, setState] = useState<{ url: string | null; geo: BufferGeometry | null }>({ url: null, geo: null })
  useEffect(() => {
    if (!url) return
    let alive = true
    load(url).then(geo => { if (alive) setState({ url, geo }) })
    return () => { alive = false }
  }, [url])
  return state.url === url ? state.geo : null
}
