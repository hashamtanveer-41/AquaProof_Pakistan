import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, CloudRain, Droplets, MapPin, MessageSquareText, Sparkles } from 'lucide-react'
import { ADVISORY_HARVEST, ADVISORY_PUMP, DEMO_URL, FARMER_REPLY, GROUNDWATER_SOURCE } from './config'
import { CHAPTERS, TAGS, chapterTarget, holdPoint, sstep, toFilm, type Source } from './timeline'
import type { World } from './world'

export const SOURCE_LABEL: Record<Source, string> = {
  officer: 'Field record',
  weather: 'Local forecast',
  estimate: 'Crop stage estimate',
}

/** The AquaProof product mark (drop and sprout), as used in the dashboard. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="11" fill="#174334" />
      <path d="M24 8c-3 6-12 12-12 20a12 12 0 0 0 24 0c0-8-9-14-12-20Z" fill="none" stroke="#81e7ae" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M24 33v-6m0 3c-4 0-6-2-6-5 4 0 6 2 6 5Zm0-3c0-4 2-6 6-6 0 4-2 6-6 6Z" fill="none" stroke="#81e7ae" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function DemoLink({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const external = Boolean(DEMO_URL)
  return (
    <a
      className={`btn ${tone === 'light' ? 'btn--light' : ''}`}
      href={DEMO_URL ?? '#about'}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {external ? 'Open the dashboard' : 'Explore AquaProof'}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  )
}

const row = (i: number) => ({ '--i': i }) as CSSProperties

/** A card in the style of the AquaProof officer dashboard. */
function Panel({ icon, module, status, children }: { icon: ReactNode; module: string; status?: string; children: ReactNode }) {
  return (
    <div className="panel">
      <header>
        <span className="panel-ico">{icon}</span>
        <span className="panel-mod">{module}</span>
        {status && <span className="panel-status">{status}</span>}
      </header>
      {children}
    </div>
  )
}

/** A WhatsApp advisory with selectable Urdu text. */
function Phone({ ur, en, meta }: { ur: string; en: string; meta: string }) {
  return (
    <figure className="phone row" style={row(0)}>
      <figcaption>
        <MessageSquareText size={14} aria-hidden="true" /> {meta}
      </figcaption>
      <p dir="rtl" lang="ur" className="urdu-msg">
        {ur}
      </p>
      <p lang="en" className="en-msg">
        {en}
      </p>
    </figure>
  )
}

function Place({ children }: { children: ReactNode }) {
  return <p className="place">{children}</p>
}

const OPTIONS = [
  { title: 'Wait and reassess after rain', note: 'Keep Thursday’s canal turn as a backup', best: true },
  { title: 'Run the tubewell today', note: 'Immediate water and pumping cost' },
  { title: 'Pump less and use the canal', note: 'Some pumping cost' },
]

const CONTENT: ReactNode[] = [
  <>
    <h1>Pump today or wait for rain?</h1>
    <p className="lede">AquaProof helps agricultural officers give farmers field-specific advice on when to irrigate, which water source to use, and when to harvest.</p>
    <DemoLink />
  </>,
  <>
    <Place>Why irrigation timing matters</Place>
    <h2>Pakistan’s farms rely on groundwater.</h2>
    <p>Groundwater supplies <strong>over half</strong> of Pakistan’s agricultural water. If rain can meet the crop’s needs, a farmer may avoid paying to pump.</p>
    <p className="source"><a href={GROUNDWATER_SOURCE} target="_blank" rel="noopener noreferrer">World Bank, 2021<span className="sr-only"> (opens in a new tab)</span></a></p>
  </>,
  <>
    <h2>Start with the farmer’s field.</h2>
    <Panel icon={<MapPin size={15} />} module="Farm Map" status="Boundary saved">
      <dl className="kv">
        <div className="row" style={row(0)}>
          <dt>Crop</dt>
          <dd>Wheat, sown in November</dd>
        </div>
        <div className="row" style={row(1)}>
          <dt>Water</dt>
          <dd>Canal turn and tubewell</dd>
        </div>
        <div className="row" style={row(2)}>
          <dt>Area</dt>
          <dd>Calculated from the boundary</dd>
        </div>
      </dl>
    </Panel>
  </>,
  <>
    <h2>Can this wheat wait?</h2>
    <p>AquaProof uses the crop stage and rain forecast to estimate how much water is in the soil. In this field, the wheat can wait.</p>
    <Panel icon={<Droplets size={15} />} module="Irrigation Intelligence" status="Field scenario">
      <ul className="options">
        {OPTIONS.map((o, i) => (
          <li key={o.title} className={`row ${o.best ? 'is-best' : ''}`} style={row(i)}>
            <span className="opt-mark" aria-hidden="true">
              {o.best ? <Check size={13} strokeWidth={3} /> : null}
            </span>
            <span className="opt-title">{o.title}</span>
            <span className="opt-note">{o.note}</span>
            {o.best && <span className="opt-best">Recommended</span>}
          </li>
        ))}
      </ul>
    </Panel>
  </>,
  <>
    <Place>AI Advisory Center</Place>
    <h2>The officer advises waiting.</h2>
    <Phone {...ADVISORY_PUMP} meta="WhatsApp advisory · Urdu" />
  </>,
  <>
    <Place>Same field</Place>
    <h2>Weeks later, the wheat is nearly ready.</h2>
  </>,
  <>
    <Place>
      <CloudRain size={14} aria-hidden="true" /> Weather and crop stage
    </Place>
    <h2>Rain could interrupt harvest.</h2>
    <Phone {...ADVISORY_HARVEST} meta="WhatsApp harvest alert · Urdu" />
  </>,
  <>
    <Place>In the wheat</Place>
    <h2>The farmer checks if the grain is ready.</h2>
    <p>On WhatsApp, he can ask, “Should I harvest before the rain?”</p>
  </>,
  <>
    <h2>He can report irrigation in the same chat.</h2>
    <figure className="reply row" style={row(0)}>
      <figcaption>
        <MessageSquareText size={14} aria-hidden="true" /> WhatsApp reply · Roman Urdu
      </figcaption>
      <p lang="ur-Latn">{FARMER_REPLY.text}</p>
      <p lang="en" className="en-msg">
        {FARMER_REPLY.en}
      </p>
    </figure>
    <Panel icon={<Sparkles size={15} />} module="AI Advisory Center" status="Parsed for review">
      <ul className="parsed">
        {FARMER_REPLY.parsed.map(([k, v], i) => (
          <li key={k} className="row" style={row(i + 1)}>
            <span>{k}</span>
            <strong>{v}</strong>
          </li>
        ))}
      </ul>
      <p className="approved row" style={row(4)}>
        <Check size={14} strokeWidth={3} aria-hidden="true" /> Officer approved · added to field history
      </p>
    </Panel>
  </>,
  <>
    <h2>AquaProof Pakistan</h2>
    <p>Keep the pump off when the crop can wait, and keep a field record for the next decision.</p>
    <DemoLink />
  </>,
]

export function Journey() {
  const trackRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chapterRefs = useRef<(HTMLElement | null)[]>([])
  const tagRefs = useRef<(HTMLDivElement | null)[]>([])
  const fillRef = useRef<HTMLSpanElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const playingRef = useRef(false)
  const reduced = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  const scrollMax = () => Math.max(1, (trackRef.current?.offsetHeight ?? 1) - window.innerHeight)

  const go = (i: number) => {
    stopPlay()
    window.scrollTo({ top: chapterTarget(i) * scrollMax(), behavior: reduced.current ? 'auto' : 'smooth' })
  }
  const stopPlay = () => {
    playingRef.current = false
    setPlaying(false)
  }

  useEffect(() => {
    if (failed) return
    const canvas = canvasRef.current!
    const stage = stageRef.current!
    let world: World
    let disposed = false
    let raf = 0
    const low = Math.min(window.innerWidth, window.innerHeight) < 620 || (navigator.hardwareConcurrency || 8) <= 4

    let cancelled = false
    import('./world')
      .then(({ createWorld }) => {
        if (cancelled) return
        try {
          world = createWorld(canvas, { low })
        } catch (e) {
          console.warn('3D scene unavailable', e)
          setFailed(true)
          return
        }
        start()
      })
      .catch(() => setFailed(true))

    function start() {
      const rm = reduced.current
      const resize = () => world.resize(stage.clientWidth || window.innerWidth, stage.clientHeight || window.innerHeight)
      window.addEventListener('resize', resize)
      resize()

      const scrollP = () => Math.min(1, Math.max(0, window.scrollY / scrollMax()))
      let p = scrollP()
      let last = performance.now()
      let time = 0
      let lastActive = -1
      let acc = 0
      let n = 0
      let tier = 0
      let playY = window.scrollY
      let wasPlaying = false
      // Introductory settle on first load (skipped for reduced motion or deep links).
      let intro = rm || p > 0.02 ? 0 : 1

      const stop = (e: Event) => {
        if (e.type === 'keydown') {
          const k = (e as KeyboardEvent).key
          if (k === 'Tab' || k === 'Shift' || k === 'Enter' || k === ' ') return
        }
        if (playingRef.current) stopPlay()
      }
      const evs = ['wheel', 'touchstart', 'keydown'] as const
      evs.forEach((ev) => window.addEventListener(ev, stop, { passive: true }))

      const ui = (pp: number) => {
        let act = 0
        chapterRefs.current.forEach((el, i) => {
          if (!el) return
          const c = CHAPTERS[i]
          const f = 0.014
          const o = Math.min(i === 0 ? 1 : sstep(c.a, c.a + f, pp), i === CHAPTERS.length - 1 ? 1 : 1 - sstep(c.b - f, c.b, pp))
          if (o > 0.5) act = i
          const key = o.toFixed(3)
          if (el.dataset.o !== key) {
            el.dataset.o = key
            const y = rm ? 0 : (1 - o) * (pp < (c.a + c.b) / 2 ? 24 : -24)
            el.style.opacity = rm ? (o > 0.5 ? '1' : '0') : key
            el.style.visibility = o > 0.001 ? 'visible' : 'hidden'
            el.style.setProperty('--y', `${y.toFixed(1)}px`)
            if (o > 0.5) el.removeAttribute('inert')
            else el.setAttribute('inert', '')
            el.classList.toggle('is-active', o > 0.5)
          }
        })
        if (act !== lastActive) {
          lastActive = act
          setActive(act)
          stage.classList.toggle('is-finale', act === CHAPTERS.length - 1)
        }
        if (fillRef.current) fillRef.current.style.setProperty('--p', pp.toFixed(4))
        hintRef.current?.classList.toggle('is-off', pp > 0.012 || playingRef.current)
      }

      const draw = (pp: number, still: boolean) => {
        const tags = world.render(toFilm(rm ? holdPoint(pp) : pp), time, { still })
        tags.forEach((t, i) => {
          const el = tagRefs.current[i]
          if (!el) return
          if (t.on) {
            el.style.transform = `translate3d(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px, 0)`
            // keep the label inside the screen; its stem stays on the anchor
            const label = el.querySelector<HTMLElement>('.tag-text')
            const half = Math.max(label?.offsetWidth ?? 0, (el.querySelector<HTMLElement>('.tag-src')?.offsetWidth ?? 0)) / 2
            const vw = stage.clientWidth
            const dx = Math.min(Math.max(t.x, half + 10), vw - half - 10) - t.x
            el.style.setProperty('--dx', `${dx.toFixed(1)}px`)
          }
          if (el.classList.contains('is-on') !== t.on) el.classList.toggle('is-on', t.on)
        })
      }

      // Test and debugging hook: render a given progress synchronously.
      ;(window as unknown as { __aqua?: unknown }).__aqua = {
        render(v: number) {
          draw(v, true)
          ui(v)
        },
      }

      const frame = (now: number) => {
        if (disposed) return
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        time += dt
        if (playingRef.current) {
          if (!wasPlaying) playY = window.scrollY
          playY += (scrollMax() / 95) * dt
          if (playY >= scrollMax()) {
            playY = scrollMax()
            stopPlay()
          }
          window.scrollTo(0, playY)
        }
        wasPlaying = playingRef.current
        const fixed = (window as unknown as { __aquaFixed?: number }).__aquaFixed
        const target = typeof fixed === 'number' ? fixed : scrollP()
        p = rm || typeof fixed === 'number' ? target : p + (target - p) * (1 - Math.exp(-dt * 4.5))
        if (Math.abs(target - p) < 0.00002) p = target
        // Once the project section covers the stage, rest the GPU.
        if (window.scrollY > scrollMax() + window.innerHeight) {
          raf = requestAnimationFrame(frame)
          return
        }
        if (intro > 0) intro = Math.max(0, intro - dt / 2.6)
        draw(p - intro * intro * 0.05, rm)
        ui(p)
        if (!stage.classList.contains('is-ready')) stage.classList.add('is-ready')
        // keep it smooth on modest phones: drop resolution, then shadows
        acc += dt
        n++
        if (n >= 60) {
          const ms = (acc / n) * 1000
          acc = 0
          n = 0
          if (ms > 28 && tier < 2) world.setQuality(++tier)
        }
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)

      cleanup = () => {
        window.removeEventListener('resize', resize)
        evs.forEach((ev) => window.removeEventListener(ev, stop))
      }
    }
    let cleanup = () => {}
    return () => {
      cancelled = true
      disposed = true
      cancelAnimationFrame(raf)
      cleanup()
      world?.dispose()
      // hand the chapters back to normal document flow (plain reading mode)
      chapterRefs.current.forEach((el) => {
        if (!el) return
        el.removeAttribute('inert')
        el.style.opacity = ''
        el.style.visibility = ''
        el.style.removeProperty('--y')
        delete el.dataset.o
      })
    }
  }, [failed])

  return (
    <>
      {!failed && <div className="track" ref={trackRef} aria-hidden="true" />}
      <div className={`stage ${failed ? 'is-plain' : ''}`} ref={stageRef}>
        {!failed && (
          <>
            <canvas ref={canvasRef} className="scene" aria-hidden="true" />
            <div className="fx veil-side" />
            <div className="fx veil-mid" />
            <div className="fx veil-top" />
            <div className="fx vignette" />
            <div className="tags" aria-hidden="true">
              {TAGS.map((t, i) => (
                <div
                  key={t.id}
                  className="tag"
                  data-src={t.source}
                  ref={(el) => {
                    tagRefs.current[i] = el
                  }}
                >
                  <span className="tag-src">{SOURCE_LABEL[t.source]}</span>
                  <span className="tag-text">{t.text}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <header className="bar">
          <a
            className="brand"
            href="#top"
            onClick={(e) => {
              if (failed) return
              e.preventDefault()
              go(0)
            }}
          >
            <Logo size={30} />
            <span>AquaProof Pakistan</span>
          </a>
          {!failed && (
            <button
              type="button"
              className="play"
              aria-pressed={playing}
              onClick={() => {
                if (playingRef.current) return stopPlay()
                if (window.scrollY >= scrollMax() - 2) window.scrollTo(0, 0)
                playingRef.current = true
                setPlaying(true)
              }}
            >
              {playing ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3" y="2" width="3.6" height="12" fill="currentColor" />
                  <rect x="9.4" y="2" width="3.6" height="12" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 2v12l10-6z" fill="currentColor" />
                </svg>
              )}
              <span>{playing ? 'Pause' : 'Play the story'}</span>
            </button>
          )}
        </header>

        <main className="chapters" id="top">
          {CHAPTERS.map((c, i) => (
            <section
              key={c.id}
              id={`chapter-${c.id}`}
              aria-label={c.nav}
              className={`chapter ${i === 0 ? 'chapter--hero' : ''} ${i === CHAPTERS.length - 1 ? 'chapter--finale' : ''}`}
              ref={(el) => {
                chapterRefs.current[i] = el
              }}
            >
              {CONTENT[i]}
              {i === CHAPTERS.length - 1 && !failed && (
                <p className="finale-links">
                  <button type="button" className="text-btn" onClick={() => go(0)}>
                    Play from the start
                  </button>
                </p>
              )}
            </section>
          ))}
        </main>

        {!failed && (
          <>
            <nav className="route" aria-label="Story chapters">
              <span className="route-line">
                <span className="route-fill" ref={fillRef} />
              </span>
              <ol>
                {CHAPTERS.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => go(i)}
                      aria-current={i === active ? 'step' : undefined}
                      className={`${i === active ? 'is-on' : ''} ${i < active ? 'is-past' : ''}`}
                    >
                      <span className="num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="name">{c.nav}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="hint" ref={hintRef} aria-hidden="true">
              Scroll to follow the field
              <i />
            </div>
          </>
        )}
      </div>
    </>
  )
}
