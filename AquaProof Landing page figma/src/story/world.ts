import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CANAL_Z, FIELD, PATH_X, PUMP, TAGS, sstep } from './timeline'

/* ---------- small maths ---------- */
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
function makeRandom(seed: number) {
  let s = seed >>> 0
  return (a = 1, b?: number) => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    const r = s / 4294967296
    return b === undefined ? r * a : a + r * (b - a)
  }
}
const rand = makeRandom(0x5eed2026)


/* ---------- camera choreography ---------- */
type Key = { p: number; pos: [number, number, number]; look: [number, number, number]; fx: number; fy: number; far?: boolean }
const AERIAL_POS: [number, number, number] = [0, 104, 38]
const AERIAL_LOOK: [number, number, number] = [-4, 0, 4]
const KEYS: Key[] = [
  { p: 0.0, pos: [-74, 42, 80], look: [-6, 0, 2], fx: 0.6, fy: 0.42, far: true },
  { p: 0.06, pos: [-64, 33, 70], look: [-9, 0, 4], fx: 0.6, fy: 0.42, far: true },
  { p: 0.1, pos: [-19.2, 1.3, 12.2], look: [-29.0, 1.35, 15.6], fx: 0.6, fy: 0.4 },
  { p: 0.165, pos: [-20.0, 1.32, 12.6], look: [-29.0, 1.38, 15.6], fx: 0.6, fy: 0.4 },
  { p: 0.215, pos: AERIAL_POS, look: AERIAL_LOOK, fx: 0.66, fy: 0.34, far: true },
  { p: 0.405, pos: [0, 101, 36], look: AERIAL_LOOK, fx: 0.66, fy: 0.34, far: true },
  { p: 0.44, pos: AERIAL_POS, look: AERIAL_LOOK, fx: 0.66, fy: 0.34, far: true },
  { p: 0.55, pos: AERIAL_POS, look: AERIAL_LOOK, fx: 0.66, fy: 0.34, far: true },
  { p: 0.585, pos: [8, 86, 62], look: [-2, 0, 0], fx: 0.66, fy: 0.34, far: true },
  { p: 0.67, pos: [7, 84, 64], look: [-2, 0, 0], fx: 0.66, fy: 0.34, far: true },
  { p: 0.705, pos: [-6.4, 1.6, 8.9], look: [-12.0, 1.0, 4.4], fx: 0.6, fy: 0.4 },
  { p: 0.78, pos: [-6.9, 1.55, 8.6], look: [-12.0, 1.0, 4.4], fx: 0.6, fy: 0.4 },
  { p: 0.815, pos: [-16.2, 1.55, 10.4], look: [-11.6, 2.7, -6], fx: 0.6, fy: 0.42 },
  { p: 0.89, pos: [-16.6, 1.6, 11.2], look: [-11.6, 2.9, -6], fx: 0.6, fy: 0.42 },
  { p: 0.935, pos: [40, 26, 62], look: [-4, 6, -24], fx: 0.5, fy: 0.62, far: true },
  { p: 1.0, pos: [56, 36, 86], look: [-6, 10, -46], fx: 0.5, fy: 0.62, far: true },
]

/* ---------- light and weather through the season ---------- */
type Env = { p: number; top: string; hor: string; sun: string; sunI: number; sky: string; ground: string; hemiI: number; dir: [number, number, number]; fogN: number; fogF: number; storm: number }
const ENV: Env[] = [
  { p: 0, top: '#8fb6cf', hor: '#efe4cc', sun: '#fff1d6', sunI: 2.1, sky: '#e4ecee', ground: '#a48c66', hemiI: 1.55, dir: [70, 62, 46], fogN: 120, fogF: 520, storm: 0 },
  { p: 0.44, top: '#90b7cf', hor: '#efe3c8', sun: '#fff0d0', sunI: 2.1, sky: '#e4ecee', ground: '#a48c66', hemiI: 1.55, dir: [70, 62, 46], fogN: 120, fogF: 520, storm: 0 },
  { p: 0.56, top: '#86a9c4', hor: '#f2d9aa', sun: '#ffdca6', sunI: 2.4, sky: '#e8e3d4', ground: '#a8895a', hemiI: 1.4, dir: [-80, 45, 30], fogN: 110, fogF: 480, storm: 0.12 },
  { p: 0.8, top: '#71879a', hor: '#dcc8a2', sun: '#ffd49a', sunI: 2.4, sky: '#d2d4cf', ground: '#9c7f52', hemiI: 1.25, dir: [-90, 32, 30], fogN: 100, fogF: 460, storm: 0.62 },
  { p: 1, top: '#56636f', hor: '#c8b38c', sun: '#ffcf8c', sunI: 2.6, sky: '#babfbe', ground: '#927548', hemiI: 1.1, dir: [-95, 26, 34], fogN: 90, fogF: 440, storm: 1 },
]

/* ---------- geometry kit: merge many coloured pieces into one mesh ---------- */
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

type Part = {
  c: string
  x?: number
  y?: number
  z?: number
  sx?: number
  sy?: number
  sz?: number
  rx?: number
  ry?: number
  rz?: number
  /** brightness at the bottom of the piece (1 at the top) */
  grad?: number
  /** random brightness variation */
  j?: number
}
const BASE = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 7, 1).translate(0, 0.5, 0),
  cone: new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0),
  ico: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
}

class Kit {
  parts: THREE.BufferGeometry[] = []
  add(base: THREE.BufferGeometry, o: Part) {
    const g = (base.index ? base.toNonIndexed() : base.clone()) as THREE.BufferGeometry
    g.deleteAttribute('uv')
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const pos = g.attributes.position
    const n = pos.count
    const col = new Float32Array(n * 3)
    _c.set(o.c)
    const jit = 1 + (rand() * 2 - 1) * (o.j ?? 0.04)
    const h = bb.max.y - bb.min.y || 1
    for (let i = 0; i < n; i++) {
      const t = (pos.getY(i) - bb.min.y) / h
      const f = jit * lerp(o.grad ?? 1, 1, t)
      col[i * 3] = _c.r * f
      col[i * 3 + 1] = _c.g * f
      col[i * 3 + 2] = _c.b * f
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)
    _q.setFromEuler(_e)
    _m.compose(_v.set(o.x ?? 0, o.y ?? 0, o.z ?? 0), _q, _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1))
    g.applyMatrix4(_m)
    this.parts.push(g)
    return this
  }
  box(o: Part) {
    return this.add(BASE.box, o)
  }
  mesh(material: THREE.Material, cast = true, receive = true) {
    const g = mergeGeometries(this.parts, false)
    this.parts.forEach((p) => p.dispose())
    this.parts = []
    const m = new THREE.Mesh(g, material)
    m.castShadow = cast
    m.receiveShadow = receive
    m.matrixAutoUpdate = false
    m.updateMatrix()
    return m
  }
}

/* ---------- people ---------- */
type Person = {
  root: THREE.Group
  hips: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  foreL: THREE.Group
  foreR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  handR: THREE.Group
}
const matCache = new Map<string, THREE.MeshLambertMaterial>()
const mat = (hex: string) => {
  let m = matCache.get(hex)
  if (!m) matCache.set(hex, (m = new THREE.MeshLambertMaterial({ color: hex })))
  return m
}
function piece(parent: THREE.Object3D, geo: THREE.BufferGeometry, hex: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const m = new THREE.Mesh(geo, mat(hex))
  m.position.set(x, y, z)
  m.scale.set(sx, sy, sz)
  m.castShadow = true
  parent.add(m)
  return m
}
function makeFarmer(): Person {
  const kameez = '#ebe4d2'
  const shalwar = '#e2dac6'
  const skin = '#9c6a45'
  const turban = '#f4f1e8'
  const root = new THREE.Group()
  const hips = new THREE.Group()
  hips.position.y = 0.94
  root.add(hips)
  const legL = new THREE.Group()
  const legR = new THREE.Group()
  legL.position.set(0.1, 0, 0)
  legR.position.set(-0.1, 0, 0)
  hips.add(legL, legR)
  for (const leg of [legL, legR]) {
    piece(leg, BASE.box, shalwar, 0, -0.9, 0, 0.17, 0.9, 0.19)
    piece(leg, BASE.box, '#4a3b2c', 0, -0.94, 0.05, 0.13, 0.06, 0.26)
  }
  const torso = new THREE.Group()
  hips.add(torso)
  // long kameez down to the knees
  piece(torso, BASE.box, kameez, 0, -0.42, 0, 0.46, 0.96, 0.27)
  piece(torso, BASE.box, kameez, 0, 0.42, 0, 0.5, 0.1, 0.29)
  const head = new THREE.Group()
  head.position.set(0, 0.66, 0)
  torso.add(head)
  piece(head, BASE.cyl, skin, 0, -0.14, 0, 0.06, 0.1, 0.06)
  piece(head, BASE.ico1, skin, 0, 0.04, 0, 0.12, 0.14, 0.13)
  piece(head, BASE.ico, '#4f4740', 0, -0.06, 0.08, 0.09, 0.07, 0.06)
  piece(head, BASE.ico1, turban, 0, 0.14, -0.01, 0.15, 0.09, 0.155)
  const arm = (side: number) => {
    const a = new THREE.Group()
    a.position.set(0.27 * side, 0.4, 0)
    torso.add(a)
    piece(a, BASE.box, kameez, 0, -0.33, 0, 0.12, 0.34, 0.13)
    const f = new THREE.Group()
    f.position.set(0, -0.32, 0)
    a.add(f)
    piece(f, BASE.box, kameez, 0, -0.27, 0, 0.11, 0.27, 0.12)
    const hand = new THREE.Group()
    hand.position.set(0, -0.31, 0)
    f.add(hand)
    piece(hand, BASE.ico, skin, 0, 0, 0, 0.06, 0.075, 0.05)
    return { a, f, hand }
  }
  const L = arm(1)
  const R = arm(-1)
  // the phone, shown later in the season
  const phone = piece(R.hand, BASE.box, '#1d2124', 0, -0.06, 0.04, 0.07, 0.14, 0.015)
  phone.name = 'phone'
  return { root, hips, torso, head, armL: L.a, armR: R.a, foreL: L.f, foreR: R.f, legL, legR, handR: R.hand }
}

/* ---------- world ---------- */
export type WorldOptions = { low: boolean }
export type TagScreen = { x: number; y: number; on: boolean }
export type World = {
  renderer: THREE.WebGLRenderer
  resize: (w: number, h: number) => void
  render: (p: number, time: number, opts: { still: boolean }) => TagScreen[]
  setQuality: (tier: number) => void
  dispose: () => void
}

export function createWorld(canvas: HTMLCanvasElement, { low }: WorldOptions): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' })
  let dpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2)
  renderer.setPixelRatio(dpr)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02
  renderer.shadowMap.enabled = !low
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.3, 2400)
  const fog = new THREE.Fog('#efe4cc', 120, 520)
  scene.fog = fog

  const worldMat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const GREEN = new THREE.Color('#7fae47')
  const GOLD = new THREE.Color('#f0c35a')
  const ripenMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: GREEN.clone() })

  /* ground and the patchwork of neighbouring plots */
  const ground = new Kit()
  ground.add(BASE.plane, { c: '#a68e69', x: 0, y: -0.05, z: 0, sx: 2400, sz: 2400, j: 0 })
  const ripen = new Kit()
  const plotKinds = ['fallow', 'fallow', 'wheat', 'wheat', 'wheat', 'fodder', 'fodder', 'ploughed', 'fallow', 'mustard']
  const plotColor: Record<string, string> = { fallow: '#b39a72', ploughed: '#8e7253', fodder: '#4c7f3a', mustard: '#d2bb45' }
  // keep plots clear of the hero field, the path and the canal by trimming them
  type Rect = [number, number, number, number]
  const keepOut: Rect[] = [
    [FIELD.x0 - 6, FIELD.x1 + 3, FIELD.z0 - 3, FIELD.z1 + 4],
    [PATH_X - 2.6, PATH_X + 2.6, -400, CANAL_Z],
    [-1000, 1000, CANAL_Z - 4.2, CANAL_Z + 4.2],
    [PUMP.x - 5, PUMP.x + 3, PUMP.z - 5, PUMP.z + 6],
  ]
  const trim = (r: Rect): Rect | null => {
    let cur: Rect | null = r
    for (const k of keepOut) {
      if (!cur) return null
      const [x0, x1, z0, z1] = cur
      if (x1 <= k[0] || x0 >= k[1] || z1 <= k[2] || z0 >= k[3]) continue
      const options: Rect[] = [
        [x0, Math.min(x1, k[0]), z0, z1],
        [Math.max(x0, k[1]), x1, z0, z1],
        [x0, x1, z0, Math.min(z1, k[2])],
        [x0, x1, Math.max(z0, k[3]), z1],
      ]
      const area = (o: Rect) => (o[1] - o[0] > 6 && o[3] - o[2] > 6 ? (o[1] - o[0]) * (o[3] - o[2]) : 0)
      const best = options.reduce((a, b) => (area(b) > area(a) ? b : a))
      cur = area(best) > 0 ? best : null
    }
    return cur
  }
  for (let gx = -260; gx < 260; ) {
    const w = rand(26, 46)
    for (let gz = -300; gz < 200; ) {
      const d = rand(22, 38)
      const r = trim([gx + 1.2, gx + w - 1.2, gz + 1.2, gz + d - 1.2])
      if (r) {
        const [x0, x1, z0, z1] = r
        const kind = plotKinds[Math.floor(rand() * plotKinds.length)]
        const cx = (x0 + x1) / 2
        const cz = (z0 + z1) / 2
        if (kind === 'wheat') {
          // striped rows that ripen with the season
          const rows = Math.max(3, Math.round((z1 - z0) / 1.6))
          for (let r = 0; r < rows; r++) {
            const rz = z0 + ((r + 0.5) * (z1 - z0)) / rows
            ripen.box({ c: '#ffffff', x: cx, y: 0, z: rz, sx: x1 - x0, sy: 0.32, sz: ((z1 - z0) / rows) * 0.92, j: 0.05, grad: 0.7 })
          }
        } else {
          ground.box({ c: plotColor[kind], x: cx, y: -0.04, z: cz, sx: x1 - x0, sy: kind === 'fodder' || kind === 'mustard' ? 0.3 : 0.08, sz: z1 - z0, j: 0.06 })
        }
        // earthen bunds
        ground.box({ c: '#a48b65', x: cx, y: -0.05, z: z0 - 0.6, sx: x1 - x0 + 2.4, sy: 0.22, sz: 0.5, j: 0.02 })
        ground.box({ c: '#a48b65', x: x0 - 0.6, y: -0.05, z: cz, sx: 0.5, sy: 0.22, sz: z1 - z0 + 2.4, j: 0.02 })
      }
      gz += d
    }
    gx += w
  }
  // the hero field's soil, bunds and the little watercourse from the pump
  ground.box({ c: '#a48b65', x: 0, y: -0.05, z: FIELD.z0 - 0.7, sx: 50, sy: 0.3, sz: 0.7 })
  ground.box({ c: '#a48b65', x: FIELD.x1 + 0.7, y: -0.05, z: 0, sx: 0.7, sy: 0.3, sz: 36 })
  ground.box({ c: '#a48b65', x: 0, y: -0.05, z: FIELD.z1 + 0.7, sx: 50, sy: 0.3, sz: 0.7 })
  ground.box({ c: '#7b6448', x: -3, y: -0.06, z: FIELD.z1 + 1.7, sx: 56, sy: 0.08, sz: 0.9 })
  ground.box({ c: '#a48b65', x: -3, y: -0.05, z: FIELD.z1 + 2.5, sx: 56, sy: 0.28, sz: 0.6 })
  // dusty path along the west edge
  ground.box({ c: '#cdb98f', x: PATH_X, y: -0.04, z: -100, sx: 2.6, sy: 0.08, sz: 241, j: 0 })
  // the canal: banks, bed and a footbridge
  ground.box({ c: '#9d8a69', x: 0, y: -0.05, z: CANAL_Z - 2.7, sx: 900, sy: 0.7, sz: 1.6, j: 0.01, grad: 0.85 })
  ground.box({ c: '#9d8a69', x: 0, y: -0.05, z: CANAL_Z + 2.7, sx: 900, sy: 0.7, sz: 1.6, j: 0.01, grad: 0.85 })
  ground.box({ c: '#6c5d47', x: 0, y: -0.6, z: CANAL_Z, sx: 900, sy: 0.3, sz: 3.8, j: 0 })
  ground.box({ c: '#b9ac94', x: PATH_X, y: 0.45, z: CANAL_Z, sx: 2.4, sy: 0.22, sz: 6.4, j: 0 })
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 3.8).rotateX(-Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: '#5f8a93', specular: '#c9d8d0', shininess: 60, transparent: true, opacity: 0.94 }),
  )
  water.position.set(0, 0.1, CANAL_Z)
  water.receiveShadow = true
  scene.add(water)

  /* the pump house: brick walls, flat roof, switch box, pipe and a dry basin */
  const B = new Kit()
  const px = PUMP.x
  const pz = PUMP.z
  B.box({ c: '#bd8466', x: px, y: 0, z: pz, sx: 4, sy: 3, sz: 4, grad: 0.85, j: 0 })
  B.box({ c: '#cfc3aa', x: px, y: 3, z: pz, sx: 4.6, sy: 0.25, sz: 4.6, j: 0 })
  B.box({ c: '#3b2f27', x: px - 0.6, y: 0, z: pz + 2.01, sx: 1.1, sy: 2.1, sz: 0.06, j: 0 })
  B.box({ c: '#8d8f88', x: px + 2.02, y: 1.25, z: pz + 0.6, sx: 0.12, sy: 0.46, sz: 0.36, j: 0 })
  B.box({ c: '#d9d4c4', x: px + 2.09, y: 1.4, z: pz + 0.6, sx: 0.04, sy: 0.12, sz: 0.06, j: 0 })
  B.box({ c: '#4b4c48', x: px + 2.03, y: 1.71, z: pz + 0.6, sx: 0.04, sy: 1.3, sz: 0.04, j: 0 })
  B.box({ c: '#5d5f5a', x: px + 1.0, y: 0.7, z: pz + 2.0, sx: 0.28, sy: 0.28, sz: 1.6, j: 0 })
  B.box({ c: '#b8ae98', x: px + 1.0, y: -0.05, z: pz + 3.6, sx: 2.2, sy: 0.55, sz: 1.8, j: 0 })
  B.box({ c: '#7d6b52', x: px + 1.0, y: 0.05, z: pz + 3.6, sx: 1.8, sy: 0.52, sz: 1.4, j: 0 })
  // a few kikar and shisham trees along the canal, the path and the village edge
  const tree = (x: number, z: number, s: number, kind: 'kikar' | 'shisham') => {
    const trunk = kind === 'kikar' ? 2.6 : 3.4
    B.add(BASE.cyl, { c: '#6a5440', x, y: 0, z, sx: 0.16 * s, sy: trunk * s, sz: 0.16 * s, j: 0.08 })
    if (kind === 'kikar') {
      B.add(BASE.ico, { c: '#86a256', x, y: (trunk + 0.5) * s, z, sx: 2.6 * s, sy: 0.8 * s, sz: 2.4 * s, ry: rand(6), grad: 0.75, j: 0.1 })
    } else {
      B.add(BASE.ico, { c: '#6f944b', x, y: (trunk + 1.2) * s, z, sx: 2.0 * s, sy: 1.7 * s, sz: 2.0 * s, ry: rand(6), grad: 0.7, j: 0.1 })
      B.add(BASE.ico, { c: '#7a9d50', x: x + 1.1 * s, y: (trunk + 0.6) * s, z: z + 0.4 * s, sx: 1.4 * s, sy: 1.2 * s, sz: 1.4 * s, ry: rand(6), grad: 0.7, j: 0.1 })
    }
  }
  for (let x = -220; x < 220; x += rand(6, 11)) {
    if (Math.abs(x - PATH_X) < 5) continue
    if (rand() < 0.7) tree(x, CANAL_Z - 4.4 - rand(0, 1), rand(0.8, 1.2), rand() < 0.5 ? 'kikar' : 'shisham')
    if (rand() < 0.6) tree(x + 3, CANAL_Z + 4.6 + rand(0, 1.4), rand(0.8, 1.25), rand() < 0.5 ? 'kikar' : 'shisham')
  }
  for (let z = -150; z < FIELD.z0 - 4; z += rand(9, 16)) tree(PATH_X - 3.2, z, rand(0.8, 1.15), rand() < 0.6 ? 'kikar' : 'shisham')
  tree(px - 4.2, pz - 2.5, 1.15, 'shisham')
  tree(FIELD.x1 + 4, FIELD.z0 + 4, 1.05, 'kikar')
  for (let i = 0; i < 60; i++) {
    const x = rand(-260, 260)
    const z = rand(-300, 10)
    if (x > FIELD.x0 - 8 && x < FIELD.x1 + 8 && z > FIELD.z0 - 8) continue
    tree(x, z, rand(0.8, 1.3), rand() < 0.5 ? 'kikar' : 'shisham')
  }
  // a small village to the north-west: mud houses, walls, haystacks and a mosque
  const V = { x: -96, z: -78 }
  for (let i = 0; i < 14; i++) {
    const x = V.x + rand(-26, 26)
    const z = V.z + rand(-18, 18)
    const w = rand(5, 8)
    const d = rand(4, 6)
    const ry = rand(-0.2, 0.2)
    B.box({ c: rand() < 0.5 ? '#c9a77c' : '#bf9a70', x, y: 0, z, sx: w, sy: rand(2.6, 3.2), sz: d, ry, grad: 0.85 })
    B.box({ c: '#b48e65', x, y: 2.9, z, sx: w + 0.3, sy: 0.25, sz: d + 0.3, ry })
  }
  B.box({ c: '#e8e2d2', x: V.x + 30, y: 0, z: V.z - 6, sx: 8, sy: 4.4, sz: 8 })
  B.add(BASE.ico1, { c: '#e8e2d2', x: V.x + 30, y: 4.4, z: V.z - 6, sx: 2.8, sy: 2.4, sz: 2.8 })
  B.add(BASE.cyl, { c: '#e8e2d2', x: V.x + 34.5, y: 0, z: V.z - 9.5, sx: 0.7, sy: 11, sz: 0.7 })
  for (let i = 0; i < 6; i++) B.add(BASE.cone, { c: '#d8bf7c', x: V.x + rand(-34, 34), y: 0, z: V.z + rand(20, 30), sx: 1.6, sy: 2.4, sz: 1.6, grad: 0.8 })
  // a neighbour's tubewell across the canal
  B.box({ c: '#a8644a', x: 74, y: 0, z: 48, sx: 3.6, sy: 2.8, sz: 3.6, grad: 0.8 })
  B.box({ c: '#b8aa92', x: 74, y: 2.8, z: 48, sx: 4.2, sy: 0.22, sz: 4.2 })

  scene.add(ground.mesh(worldMat, false, true))
  scene.add(ripen.mesh(ripenMat, false, true))
  // the hero field's canopy base, tinted with the wheat so it reads as one crop from above
  const heroBaseMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: GREEN.clone() })
  const heroBase = new Kit()
  heroBase.box({ c: '#e4e0c8', x: 0, y: -0.02, z: 0, sx: FIELD.x1 - FIELD.x0, sy: 0.5, sz: FIELD.z1 - FIELD.z0, j: 0 })
  scene.add(heroBase.mesh(heroBaseMat, false, true))
  scene.add(B.mesh(worldMat, true, true))

  /* the wheat: instanced tufts that sway in the wind and ripen with the season */
  const uTime = { value: 0 }
  const uWind = { value: 1 }
  const tuft = new Kit()
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand(0.6)
    const ox = Math.cos(a) * 0.09
    const oz = Math.sin(a) * 0.09
    const h = rand(0.78, 0.95)
    const lean = rand(-0.12, 0.12)
    tuft.add(new THREE.ConeGeometry(0.03, 1, 3, 1, true).translate(0, 0.5, 0), { c: '#ffffff', x: ox, y: 0, z: oz, sy: h, rx: lean, rz: -lean, grad: 0.6, j: 0.05 })
    tuft.add(BASE.ico, { c: '#fff6d8', x: ox + Math.sin(-lean) * h * 0.1, y: h + 0.05, z: oz + Math.sin(lean) * h * 0.1, sx: 0.045, sy: 0.13, sz: 0.045, j: 0.04 })
  }
  const tuftGeo = mergeGeometries(tuft.parts, false)
  tuft.parts.forEach((p) => p.dispose())
  const wheatMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: GREEN.clone() })
  wheatMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.uniforms.uWind = uWind
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hh = max(position.y, 0.0);
        float gust = sin(uTime * 1.35 + ip.x * 0.16 + ip.z * 0.09) * 0.6 + sin(uTime * 2.7 + ip.x * 0.55 - ip.z * 0.3) * 0.4;
        transformed.x += gust * 0.09 * hh * hh * uWind;
        transformed.z += gust * 0.05 * hh * hh * uWind;`,
      )
  }
  const sx = low ? 0.72 : 0.52
  const sz = low ? 0.8 : 0.6
  const nx = Math.floor((FIELD.x1 - FIELD.x0 - 0.6) / sx)
  const nz = Math.floor((FIELD.z1 - FIELD.z0 - 0.6) / sz)
  const wheat = new THREE.InstancedMesh(tuftGeo, wheatMat, nx * nz)
  wheat.receiveShadow = true
  let wi = 0
  const tint = new THREE.Color()
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = FIELD.x0 + 0.3 + (i + 0.5) * sx + rand(-0.12, 0.12)
      const z = FIELD.z0 + 0.3 + (j + 0.5) * sz + rand(-0.06, 0.06)
      const s = rand(0.85, 1.15)
      _e.set(0, rand(6.28), 0)
      _q.setFromEuler(_e)
      _m.compose(_v.set(x, 0, z), _q, _s.set(s, s * rand(0.9, 1.1), s))
      wheat.setMatrixAt(wi, _m)
      const k = rand(0.86, 1.08)
      wheat.setColorAt(wi, tint.setRGB(k, k * rand(0.97, 1.03), k))
      wi++
    }
  wheat.instanceMatrix.needsUpdate = true
  if (wheat.instanceColor) wheat.instanceColor.needsUpdate = true
  scene.add(wheat)

  /* the field boundary: a ribbon traced around the field, kept for the rest of the story */
  const SEG = 160
  const corners = [
    [FIELD.x0 - 0.35, FIELD.z0 - 0.35],
    [FIELD.x1 + 0.35, FIELD.z0 - 0.35],
    [FIELD.x1 + 0.35, FIELD.z1 + 0.35],
    [FIELD.x0 - 0.35, FIELD.z1 + 0.35],
  ]
  const perim: [number, number][] = []
  for (let s = 0; s < 4; s++) {
    const [ax, az] = corners[s]
    const [bx, bz] = corners[(s + 1) % 4]
    for (let i = 0; i < SEG / 4; i++) perim.push([lerp(ax, bx, i / (SEG / 4)), lerp(az, bz, i / (SEG / 4))])
  }
  perim.push(perim[0])
  const ribbonPos: number[] = []
  const ribbonIdx: number[] = []
  const RW = 0.17
  const RY = 1.22
  for (let i = 0; i < perim.length; i++) {
    const [x, z] = perim[i]
    // offset across the line, outward/inward from field centre
    const nxn = Math.sign(x) * (Math.abs(x) > FIELD.x1 ? 1 : 0)
    const nzn = Math.sign(z) * (Math.abs(z) > FIELD.z1 ? 1 : 0)
    const len = Math.hypot(nxn, nzn) || 1
    ribbonPos.push(x - (nxn / len) * RW, RY, z - (nzn / len) * RW, x + (nxn / len) * RW, RY, z + (nzn / len) * RW)
    if (i < perim.length - 1) {
      const a = i * 2
      ribbonIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const ribbonGeo = new THREE.BufferGeometry()
  ribbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPos, 3))
  ribbonGeo.setIndex(ribbonIdx)
  const ribbonMat = new THREE.MeshBasicMaterial({ color: '#fffaf0', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, fog: false })
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat)
  ribbon.renderOrder = 5
  scene.add(ribbon)
  const posts = new THREE.Group()
  for (const [x, z] of corners) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5).translate(0, 1.1, 0), ribbonMat)
    post.position.set(x, 0, z)
    posts.add(post)
  }
  scene.add(posts)
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.x1 - FIELD.x0, FIELD.z1 - FIELD.z0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#fffaf0', transparent: true, opacity: 0, depthWrite: false, fog: false }),
  )
  fill.position.y = 1.18
  fill.renderOrder = 4
  scene.add(fill)

  /* the farmer */
  const farmer = makeFarmer()
  scene.add(farmer.root)
  const phone = farmer.handR.getObjectByName('phone')!

  /* sky, sun, clouds */
  const skyU = {
    uTop: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uGround: { value: new THREE.Color('#b9a37c') },
    uSunDir: { value: new THREE.Vector3(-0.6, 0.7, 0.4) },
    uSunCol: { value: new THREE.Color('#fff1d6') },
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunCol; varying vec3 vW;
        void main(){ vec3 d = normalize(vW - cameraPosition); float h = d.y;
          vec3 c = mix(uHor, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
          c = mix(c, uGround, clamp(-h * 8.0, 0.0, 1.0));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          c += uSunCol * (pow(s, 40.0) * 0.5 + pow(s, 5.0) * 0.1);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  )
  sky.renderOrder = -10
  scene.add(sky)

  const hemi = new THREE.HemisphereLight('#dfe8ea', '#9a8460', 1)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4)
  sun.castShadow = !low
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = -55
  sc.right = 55
  sc.top = 55
  sc.bottom = -55
  sc.near = 10
  sc.far = 400
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.3
  scene.add(sun, sun.target)

  const cloudKit = new Kit()
  for (let i = 0; i < 5; i++) cloudKit.add(BASE.ico1, { c: '#ffffff', x: rand(-1.6, 1.6), y: rand(-0.2, 0.4), z: rand(-0.8, 0.8), sx: rand(0.9, 1.6), sy: rand(0.5, 0.8), sz: rand(0.8, 1.2), j: 0.03, grad: 0.82 })
  const cloudGeo = mergeGeometries(cloudKit.parts, false)
  const fairMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: '#ffffff', emissive: '#c8c2b4', emissiveIntensity: 0.35, transparent: true, opacity: 0.95, fog: false })
  const stormMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: '#7a838b', emissive: '#3c434a', emissiveIntensity: 0.4, transparent: true, opacity: 0, fog: false })
  const fair: THREE.Mesh[] = []
  for (let i = 0; i < (low ? 10 : 16); i++) {
    const m = new THREE.Mesh(cloudGeo, fairMat)
    m.position.set(rand(-500, 500), rand(90, 140), rand(-600, 200))
    m.scale.set(rand(16, 30), rand(10, 16), rand(12, 22))
    m.userData.v = rand(1, 2.5)
    scene.add(m)
    fair.push(m)
  }
  const storm: THREE.Mesh[] = []
  for (let i = 0; i < (low ? 9 : 14); i++) {
    const m = new THREE.Mesh(cloudGeo, stormMat)
    m.userData.base = new THREE.Vector3(rand(-420, 360), rand(55, 95), rand(-60, 60))
    m.scale.set(rand(40, 70), rand(18, 30), rand(26, 44))
    m.rotation.y = rand(-0.4, 0.4)
    scene.add(m)
    storm.push(m)
  }
  // rain shafts under the storm, far off
  const shaftTex = (() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 256
    const x = c.getContext('2d')!
    const g = x.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, 'rgba(110,120,128,0.9)')
    g.addColorStop(1, 'rgba(110,120,128,0)')
    x.fillStyle = g
    for (let i = 0; i < 40; i++) x.fillRect(rand(64), 0, rand(1, 3), 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })()
  const shafts: THREE.Mesh[] = []
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide })
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(70, 80).translate(0, -40, 0), shaftMat)
    m.userData.i = i
    scene.add(m)
    shafts.push(m)
  }

  /* ---------- per-frame ---------- */
  let W = 1
  let H = 1
  let narrow = false
  const resize = (w: number, h: number) => {
    W = w
    H = h
    narrow = w / h < 1 || (w <= 820 && w / h < 1.25)
    renderer.setSize(w, h, false)
    camera.fov = narrow ? (w / h < 0.7 ? 52 : 46) : 38
  }

  const camPos = new THREE.Vector3()
  const camLook = new THREE.Vector3()
  const a3 = new THREE.Vector3()
  const b3 = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const cA = new THREE.Color()
  const cB = new THREE.Color()
  let fx = 0.6
  let fy = 0.4

  function cameraAt(p: number) {
    let i = 0
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++
    const ka = KEYS[i]
    const kb = KEYS[i + 1]
    const u = smoother(clamp((p - ka.p) / (kb.p - ka.p)))
    const zoom = (k: Key, out: THREE.Vector3, look: THREE.Vector3) => {
      if (!narrow) return out
      const f = clamp(1.05 / (W / H), 1, 2.3)
      return out.sub(look).multiplyScalar(k.far ? f : Math.pow(f, 0.5)).add(look)
    }
    const la = a3.fromArray(ka.look)
    const lb = b3.fromArray(kb.look)
    camLook.lerpVectors(la, lb, u)
    const pa = zoom(ka, new THREE.Vector3().fromArray(ka.pos), la.clone())
    const pb = zoom(kb, new THREE.Vector3().fromArray(kb.pos), lb.clone())
    camPos.lerpVectors(pa, pb, u)
    // fly over rather than through things when travelling between a close shot and the aerial
    const lift = Math.sin(u * Math.PI) * Math.min(pa.distanceTo(pb) * 0.12, 18)
    if (ka.p !== kb.p && pa.distanceTo(pb) > 20) camPos.y += lift
    return { fx: lerp(ka.fx, kb.fx, u), fy: lerp(ka.fy, kb.fy, u) }
  }

  function envAt(p: number) {
    let i = 0
    while (i < ENV.length - 2 && p > ENV[i + 1].p) i++
    const a = ENV[i]
    const b = ENV[i + 1]
    const u = clamp((p - a.p) / (b.p - a.p))
    const mix = (x: string, y: string, out: THREE.Color) => out.set(x).lerp(cB.set(y), u)
    mix(a.top, b.top, skyU.uTop.value)
    mix(a.hor, b.hor, skyU.uHor.value)
    mix(a.sun, b.sun, sun.color)
    skyU.uSunCol.value.copy(sun.color)
    mix(a.hor, b.hor, fog.color)
    mix(a.sky, b.sky, hemi.color)
    mix(a.ground, b.ground, hemi.groundColor)
    sun.intensity = lerp(a.sunI, b.sunI, u)
    hemi.intensity = lerp(a.hemiI, b.hemiI, u)
    fog.near = lerp(a.fogN, b.fogN, u)
    fog.far = lerp(a.fogF, b.fogF, u)
    tmp.set(lerp(a.dir[0], b.dir[0], u), lerp(a.dir[1], b.dir[1], u), lerp(a.dir[2], b.dir[2], u))
    skyU.uSunDir.value.copy(tmp).normalize()
    sun.position.copy(tmp).normalize().multiplyScalar(160).add(sun.target.position)
    return lerp(a.storm, b.storm, u)
  }

  function poseFarmer(p: number, t: number) {
    const F = farmer
    const groups = [F.armL, F.armR, F.foreL, F.foreR, F.legL, F.legR, F.head, F.torso]
    groups.forEach((g) => g.rotation.set(0, 0, 0))
    F.hips.position.y = 0.94
    const breathe = Math.sin(t * 1.6) * 0.012
    F.torso.rotation.x = breathe
    if (p < 0.44) {
      // at the pump house, reaching for the switch, then letting it be
      F.root.position.set(PUMP.x + 2.85, 0, PUMP.z + 0.45)
      F.root.rotation.y = -Math.PI / 2
      const r = sstep(0.06, 0.14, p) * (1 - sstep(0.33, 0.4, p))
      F.armR.rotation.x = -r * 1.05
      F.armR.rotation.z = r * 0.12
      F.foreR.rotation.x = -r * 0.55
      F.head.rotation.x = 0.06 + r * 0.05
      F.head.rotation.y = -r * 0.12
      phone.visible = false
    } else if (p < 0.676) {
      // later in the season, on the path, reading the message
      F.root.position.set(PATH_X + 0.4, 0, 8.6)
      F.root.rotation.y = Math.PI / 2 - 0.3
      const read = sstep(0.56, 0.6, p)
      phone.visible = p > 0.56
      F.armR.rotation.x = -0.7 * read
      F.foreR.rotation.x = -1.2 * read
      F.armR.rotation.z = 0.15 * read
      F.head.rotation.x = 0.38 * read
    } else {
      phone.visible = true
      const A = { x: PATH_X + 0.4, z: 8.6 }
      const Bp = { x: -12.4, z: 4.0 }
      const k = clamp((p - 0.676) / 0.026)
      const e = smoother(k)
      F.root.position.set(lerp(A.x, Bp.x, e), 0, lerp(A.z, Bp.z, e))
      if (k < 1) {
        F.root.rotation.y = Math.atan2(Bp.x - A.x, Bp.z - A.z)
        const ph = t * 7.5
        F.legL.rotation.x = Math.sin(ph) * 0.45
        F.legR.rotation.x = -Math.sin(ph) * 0.45
        F.armL.rotation.x = -Math.sin(ph) * 0.3
        F.armR.rotation.x = Math.sin(ph) * 0.3
        F.hips.position.y = 0.94 + Math.abs(Math.cos(ph)) * 0.03
      } else {
        // checking an ear of wheat, then replying to the advisory on his phone
        const reply = sstep(0.792, 0.818, p)
        F.root.rotation.y = lerp(0.55, Math.PI / 2 + 0.35, reply)
        F.torso.rotation.x = lerp(0.22, 0.06, reply)
        F.head.rotation.x = lerp(0.45, 0.4, reply)
        F.armL.rotation.x = lerp(-0.85, -0.55, reply)
        F.foreL.rotation.x = lerp(-0.5, -1.15, reply)
        F.armR.rotation.x = lerp(0.05, -0.6, reply)
        F.foreR.rotation.x = lerp(-0.2, -1.25, reply)
        F.armR.rotation.z = lerp(0, 0.12, reply)
      }
    }
  }

  const tagScreen: TagScreen[] = TAGS.map(() => ({ x: 0, y: 0, on: false }))
  function render(p: number, time: number, { still }: { still: boolean }) {
    uTime.value = still ? 0 : time
    const stormAmt = envAt(p)
    uWind.value = still ? 0 : 1 + stormAmt * 1.2

    // season: the match cut runs as a time-lapse while the camera holds
    const season = sstep(0.452, 0.548, p)
    wheatMat.color.copy(GREEN).lerp(GOLD, season)
    heroBaseMat.color.copy(wheatMat.color)
    cA.set('#6f9a3f').lerp(cB.set('#c99a45'), season)
    ripenMat.color.copy(cA)

    // boundary
    const trace = sstep(0.198, 0.245, p)
    ribbonGeo.setDrawRange(0, Math.round(trace * SEG) * 6)
    ribbon.visible = trace > 0.001
    // corners appear one by one as the officer clicks them, and the line follows
    posts.visible = trace > 0.001
    posts.children.forEach((o, i) => (o.scale.y = Math.max(0.001, sstep(i / 4 - 0.02, i / 4 + 0.03, trace))))
    ;(fill.material as THREE.MeshBasicMaterial).opacity = 0.16 * sstep(0.24, 0.255, p) * (1 - sstep(0.27, 0.3, p))

    // weather
    fair.forEach((m, i) => {
      m.position.x += 0
      const drift = still ? 0 : time * m.userData.v
      m.position.x = ((((i * 97) % 1000) - 500 + drift + 500) % 1000) - 500
    })
    stormMat.opacity = clamp(stormAmt * 1.15)
    fairMat.opacity = 0.95 * (1 - stormAmt * 0.6)
    const sz = lerp(-760, -320, smoother(clamp(stormAmt)))
    storm.forEach((m, i) => {
      const b = m.userData.base as THREE.Vector3
      m.position.set(b.x + (still ? 0 : Math.sin(time * 0.05 + i) * 6), b.y, sz + b.z)
      m.visible = stormAmt > 0.02
    })
    shaftMat.opacity = 0.5 * sstep(0.84, 0.97, p)
    shafts.forEach((m) => {
      const s = storm[(m.userData.i * 2) % storm.length]
      m.position.set(s.position.x, s.position.y - 6, s.position.z + 10)
      m.lookAt(camPos.x, m.position.y, camPos.z)
      m.visible = shaftMat.opacity > 0.01
    })

    poseFarmer(p, still ? 0 : time)

    // camera
    const f = cameraAt(p)
    if (!still) {
      const d = camPos.distanceTo(camLook)
      const amp = Math.min(d * 0.006, 0.35)
      camPos.x += Math.sin(time * 0.21) * amp
      camPos.y += Math.sin(time * 0.29) * amp * 0.6
    }
    camera.position.copy(camPos)
    camera.lookAt(camLook)
    const tfx = narrow ? 0.5 : f.fx
    const tfy = narrow ? f.fy : 0.5
    fx = tfx
    fy = tfy
    const FW = W * (1 + 2 * Math.abs(fx - 0.5))
    const FH = H * (1 + 2 * Math.abs(fy - 0.5))
    camera.aspect = FW / FH
    camera.setViewOffset(FW, FH, FW / 2 - fx * W, FH / 2 - fy * H, W, H)
    camera.updateProjectionMatrix()
    sky.position.copy(camPos)
    // the ribbon fades a little when we are down in the field
    ribbonMat.opacity = lerp(0.55, 0.95, clamp((camPos.y - 3) / 30))

    sun.target.position.set(0, 0, 0)
    sun.target.updateMatrixWorld()

    renderer.render(scene, camera)

    // pinned labels
    TAGS.forEach((tg, i) => {
      const s = tagScreen[i]
      let on = p > tg.a && p < tg.b
      if (on) {
        tmp.set(tg.pos[0], tg.pos[1], tg.pos[2]).project(camera)
        const x = (tmp.x * 0.5 + 0.5) * W
        const y = (-tmp.y * 0.5 + 0.5) * H
        on = tmp.z < 1 && x > 40 && x < W - 40 && y > 90 && y < H * (narrow ? 0.52 : 0.92)
        if (on && !narrow && x < W * 0.42 && y > H * 0.38) on = false
        if (on && narrow && tg.wideOnly) on = false
        s.x = x
        s.y = y
      }
      s.on = on
    })
    return tagScreen
  }

  return {
    renderer,
    resize,
    render,
    setQuality(tier: number) {
      if (tier >= 1 && dpr > 1) {
        dpr = 1
        renderer.setPixelRatio(dpr)
        renderer.setSize(W, H, false)
      }
      if (tier >= 2 && renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = false
        sun.castShadow = false
        scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined
          if (m) m.needsUpdate = true
        })
      }
    },
    dispose() {
      renderer.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose()
      })
    },
  }
}
