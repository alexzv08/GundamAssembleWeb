import { useEffect, useState } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Mesh } from 'three'
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
      let mesh: Mesh | null = null
      gltf.scene.traverse(o => { if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh })
      if (!mesh) return null
      const m = mesh as Mesh
      // Los GLB van cuantizados (KHR_mesh_quantization): la escala y el
      // desplazamiento reales están en el nodo. Se pasan las posiciones a float
      // y se les aplica la matriz del nodo para tener la geometría ya colocada.
      m.updateWorldMatrix(true, false)
      const src = m.geometry.getAttribute('position')
      const pos = new Float32Array(src.count * 3)
      for (let i = 0; i < src.count; i++) { pos[i * 3] = src.getX(i); pos[i * 3 + 1] = src.getY(i); pos[i * 3 + 2] = src.getZ(i) }
      const geo = new BufferGeometry()
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
      if (m.geometry.index) geo.setIndex(m.geometry.index.clone())
      geo.applyMatrix4(m.matrixWorld)
      geo.computeVertexNormals()
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
