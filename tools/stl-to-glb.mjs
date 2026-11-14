// STL binario → GLB para el tablero: Y arriba, escala 0.02 (mm → unidades del
// tablero), base en y = 0 y centrado en XZ; indexado, simplificado al 15 % de
// triángulos y comprimido con meshopt (el cliente lo lee con GLTFLoader +
// MeshoptDecoder y lo pinta con flatShading, así que no guarda normales).
//
// Uso (las dependencias no están en el proyecto; se instalan aparte):
//   mkdir /tmp/glb && cd /tmp/glb && npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22
//   cp <repo>/tools/stl-to-glb.mjs . && node stl-to-glb.mjs <repo>/assets-src/models <repo>/client/public/models 0.15
import fs from 'fs'
import path from 'path'
import { Document, NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { weld, simplify, reorder, quantize, normals } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

const [, , inDir, outDir, ratioArg] = process.argv
const RATIO = Number(ratioArg ?? 0.1)
await MeshoptEncoder.ready; await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
fs.mkdirSync(outDir, { recursive: true })
for (const f of fs.readdirSync(inDir).filter(f => f.endsWith('.stl'))) {
  const buf = fs.readFileSync(path.join(inDir, f))
  const n = buf.readUInt32LE(80)
  const pos = new Float32Array(n * 9)
  for (let i = 0; i < n; i++) for (let v = 0; v < 3; v++) {
    const o = 84 + i * 50 + 12 + v * 12
    const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4), z = buf.readFloatLE(o + 8)
    pos.set([x * 0.02, z * 0.02, -y * 0.02], i * 9 + v * 3)   // Z arriba → Y arriba
  }
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]) }
  const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= off[0]; pos[i + 1] -= off[1]; pos[i + 2] -= off[2] }
  const doc = new Document()
  const buffer = doc.createBuffer()
  // Indexar: unir vértices idénticos (cuantizados a 1e-5)
  const map = new Map(); const uniq = []; const idx = new Uint32Array(pos.length / 3)
  for (let i = 0; i < pos.length; i += 3) {
    const k = Math.round(pos[i] * 1e5) + ',' + Math.round(pos[i + 1] * 1e5) + ',' + Math.round(pos[i + 2] * 1e5)
    let j = map.get(k); if (j === undefined) { j = uniq.length / 3; map.set(k, j); uniq.push(pos[i], pos[i + 1], pos[i + 2]) }
    idx[i / 3] = j
  }
  const acc = doc.createAccessor().setType('VEC3').setArray(new Float32Array(uniq)).setBuffer(buffer)
  const prim = doc.createPrimitive().setAttribute('POSITION', acc).setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
  const mesh = doc.createMesh(f.replace('.stl', '')).addPrimitive(prim)
  doc.createScene().addChild(doc.createNode('model').setMesh(mesh))
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.01 }), reorder({ encoder: MeshoptEncoder }), quantize())
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  const out = path.join(outDir, f.replace('.stl', '.glb'))
  await io.write(out, doc)
  const tris = (doc.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getIndices()?.getCount() ?? NaN) / 3
  console.log(f.padEnd(28), String(n).padStart(7), '→', String(Math.round(tris)).padStart(6), 'tris', (fs.statSync(out).size / 1024).toFixed(0).padStart(5), 'KB', 'alto', (max[1] - min[1]).toFixed(2))
}
