import { useMemo } from 'react'
import { BackSide, BufferGeometry, Float32BufferAttribute } from 'three'

// Cielo: degradado de azul noche a un horizonte verdoso y un campo de estrellas,
// como un campo de batalla de colonia espacial al anochecer.
export function SkyDome({ radius = 120 }: { radius?: number }) {
  const stars = useMemo(() => {
    const g = new BufferGeometry(), pts: number[] = []
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let i = 0; i < 900; i++) {
      const u = rnd() * Math.PI * 2, v = 0.08 + rnd() * 0.9
      const y = v, rr = Math.sqrt(1 - y * y)
      pts.push(Math.cos(u) * rr * radius * 0.95, y * radius * 0.95, Math.sin(u) * rr * radius * 0.95)
    }
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    return g
  }, [radius])
  return (
    <group>
      <mesh raycast={() => null}>
        <sphereGeometry args={[radius, 32, 16]} />
        <shaderMaterial side={BackSide} depthWrite={false} fog={false}
          uniforms={{ top: { value: [0.02, 0.035, 0.08] }, mid: { value: [0.04, 0.09, 0.16] }, low: { value: [0.06, 0.12, 0.13] } }}
          vertexShader={`varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
          fragmentShader={`uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;
            void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, low, smoothstep(0.0, -0.4, h));
            gl_FragColor = vec4(c, 1.0); }`} />
      </mesh>
      <points geometry={stars} raycast={() => null}>
        <pointsMaterial size={0.35} color="#cfe3ff" transparent opacity={0.7} fog={false} sizeAttenuation depthWrite={false} />
      </points>
    </group>
  )
}
