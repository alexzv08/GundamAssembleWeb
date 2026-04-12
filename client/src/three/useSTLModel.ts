import { useEffect, useState } from 'react'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { BufferGeometry } from 'three'

const cache: Record<string, BufferGeometry> = {}

export function useSTLModel(url: string): BufferGeometry | null {
    const [geometry, setGeometry] = useState<BufferGeometry | null>(cache[url] ?? null)

    useEffect(() => {
        if (cache[url]) { setGeometry(cache[url]); return }
        const loader = new STLLoader()
        loader.load(url, (geo) => {
            geo.center()
            geo.computeVertexNormals()
            cache[url] = geo
            setGeometry(geo)
        })
    }, [url])

    return geometry
}