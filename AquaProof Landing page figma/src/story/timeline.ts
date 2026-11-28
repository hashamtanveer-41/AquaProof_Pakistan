import { SAMPLE } from './config'

/**
 * The story runs on one scroll progress value, p, from 0 to 1.
 * Each chapter's caption and product panel show between `a` and `b`. The 3D film
 * (world.ts) has its own timing; `film` is where each chapter sits in it.
 */
export type Chapter = { id: string; nav: string; a: number; b: number; film: [number, number] }

export const CHAPTERS: Chapter[] = [
  { id: 'start', nav: 'Start', a: 0, b: 0.055, film: [0, 0.06] },
  { id: 'pump', nav: 'The pump', a: 0.075, b: 0.145, film: [0.085, 0.165] },
  { id: 'map', nav: 'Map the field', a: 0.17, b: 0.25, film: [0.195, 0.27] },
  { id: 'decide', nav: 'Wait or pump', a: 0.265, b: 0.355, film: [0.275, 0.318] },
  { id: 'advise', nav: 'The advice', a: 0.37, b: 0.44, film: [0.322, 0.405] },
  { id: 'later', nav: 'Weeks later', a: 0.47, b: 0.56, film: [0.44, 0.55] },
  { id: 'forecast', nav: 'Rain ahead', a: 0.585, b: 0.66, film: [0.58, 0.67] },
  { id: 'check', nav: 'In the wheat', a: 0.69, b: 0.76, film: [0.7, 0.78] },
  { id: 'reply', nav: 'The reply', a: 0.79, b: 0.87, film: [0.81, 0.89] },
  { id: 'close', nav: 'AquaProof', a: 0.905, b: 1.01, film: [0.925, 1] },
]

/** Map story progress to film time: chapters onto their shots, gaps onto the camera moves. */
export const toFilm = (p: number) => {
  const pts: [number, number][] = []
  CHAPTERS.forEach((c) => {
    pts.push([c.a, c.film[0]], [Math.min(c.b, 1), c.film[1]])
  })
  if (p <= pts[0][0]) return pts[0][1]
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    if (p <= x1) return x1 === x0 ? y1 : y0 + ((p - x0) / (x1 - x0)) * (y1 - y0)
  }
  return pts[pts.length - 1][1]
}

/** Scroll position a chapter link jumps to. */
export const chapterTarget = (i: number) => {
  const c = CHAPTERS[i]
  if (i === 0) return 0
  if (i === CHAPTERS.length - 1) return 1
  return c.a + (c.b - c.a) * 0.55
}

/** Reduced motion: hold each chapter's shot instead of scrubbing between them. */
export const holdPoint = (p: number) => {
  let i = 0
  CHAPTERS.forEach((c, j) => {
    if (p >= c.a - 0.012) i = j
  })
  return chapterTarget(i)
}

export const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* The place, in world units (about one metre each). */
export const FIELD = { x0: -24, x1: 24, z0: -17, z1: 17 }
export const CANAL_Z = 23
export const PATH_X = -26
export const PUMP = { x: -31, z: 15 }

/*
 * Labels pinned to things in the 3D scene, each marked with where it comes from.
 * Windows are in film time.
 */
export type Source = 'officer' | 'weather' | 'estimate'
export type TagDef = { id: string; a: number; b: number; pos: [number, number, number]; source: Source; text: string; wideOnly?: boolean }
export const TAGS: TagDef[] = [
  { id: 'stage1', a: 0.222, b: 0.32, pos: [9, 1.4, 5], source: 'estimate', text: `Growth stage: ${SAMPLE.greenStage}` },
  { id: 'rain1', a: 0.232, b: 0.408, pos: [17, 9, -13], source: 'weather', text: SAMPLE.greenForecast },
  { id: 'canal', a: 0.242, b: 0.408, pos: [10, 0.6, CANAL_Z], source: 'officer', text: SAMPLE.canalTurn },
  { id: 'pump', a: 0.335, b: 0.408, pos: [PUMP.x, 3.9, PUMP.z], source: 'officer', text: 'Tubewell: off' },
  { id: 'stage2', a: 0.585, b: 0.672, pos: [6, 1.4, 2], source: 'estimate', text: `Growth stage: ${SAMPLE.goldenStage}` },
  { id: 'rain2', a: 0.595, b: 0.672, pos: [17, 9, -13], source: 'weather', text: SAMPLE.goldenForecast },
]
