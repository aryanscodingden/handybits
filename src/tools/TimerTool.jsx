import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, CornersIn, CornersOut, Flag, Pause, Play, Plus, SkipForward, Stop } from '@phosphor-icons/react'
import { describeDuration, formatCountdown, formatStopwatch, lapRows, nextPhase, parseDuration } from '../lib/timer-core.js'
import { playChime, startAlarm, unlockAudio } from '../lib/timer-audio.js'
import { useStoredState } from '../lib/text-hooks.js'
import './TimerTool.css'

const MODES = [
  ['timer', 'Timer'],
  ['stopwatch', 'Stopwatch'],
  ['pomodoro', 'Pomodoro'],
]

const PRESETS = [1, 3, 5, 10, 15, 25, 30, 60]
const PHASES = { focus: 'Focus', short: 'Short break', long: 'Long break' }
const POMO_DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, auto: false }
const IDLE = { status: 'idle', duration: 5 * 60000, endsAt: 0, left: 0 }

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/* Hooks */

// Current time, refreshed every frame while visible and once a second while hidden.
function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    let raf = 0
    let iv = 0
    const loop = () => {
      setNow(Date.now())
      raf = requestAnimationFrame(loop)
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      clearInterval(iv)
      if (document.hidden) {
        setNow(Date.now())
        iv = setInterval(() => setNow(Date.now()), 1000)
      } else loop()
    }
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(iv)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [active])
  return now
}

function askNotifyPermission() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  try {
    Notification.requestPermission().catch(() => {})
  } catch {
    // Older Safari uses a callback form; not worth supporting.
  }
}

function notify(title, body) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (!document.hidden && document.hasFocus()) return
  try {
    const n = new Notification(title, { body, tag: 'handybits-timer' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Some platforms only allow notifications from a service worker.
  }
}

// A countdown whose state survives reloads: it stores the end timestamp, not a tick count.
function useCountdown(storeKey, onFinish) {
  const [run, setRun] = useStoredState(storeKey, IDLE, 0)
  const running = run.status === 'running'
  const now = useNow(running)
  const finishRef = useRef(onFinish)
  useEffect(() => {
    finishRef.current = onFinish
  })

  // One timeout aimed at the end time. A single timeout is not subject to the
  // heavy throttling browsers apply to repeating timers in background tabs.
  useEffect(() => {
    if (!running) return
    const endsAt = run.endsAt
    let id = 0
    const fire = () => {
      const left = endsAt - Date.now()
      if (left > 0) {
        id = setTimeout(fire, left)
        return
      }
      // Finished long ago (the page was closed): show it, but don't ring.
      // The callback may ask for the next countdown: { start: ms } or { reset: ms }.
      const next = finishRef.current?.({ late: -left > 5000, duration: run.duration })
      setRun((r) => {
        if (r.status !== 'running' || r.endsAt !== endsAt) return r
        if (next?.start) return { status: 'running', duration: next.start, endsAt: Date.now() + next.start, left: 0 }
        if (next?.reset) return { ...IDLE, duration: next.reset }
        return { ...r, status: 'done', left: 0 }
      })
    }
    fire()
    return () => clearTimeout(id)
  }, [running, run.endsAt, run.duration, setRun])

  const remaining = running ? Math.max(0, run.endsAt - now) : run.status === 'paused' ? run.left : run.status === 'done' ? 0 : run.duration

  const start = useCallback(
    (duration) =>
      setRun((r) => {
        const d = duration ?? r.duration
        return { status: 'running', duration: d, endsAt: Date.now() + d, left: 0 }
      }),
    [setRun],
  )
  const pause = useCallback(() => setRun((r) => (r.status === 'running' ? { ...r, status: 'paused', left: Math.max(0, r.endsAt - Date.now()) } : r)), [setRun])
  const resume = useCallback(() => setRun((r) => (r.status === 'paused' ? { ...r, status: 'running', endsAt: Date.now() + r.left } : r)), [setRun])
  const reset = useCallback((duration) => setRun((r) => ({ ...IDLE, duration: duration ?? r.duration })), [setRun])
  const add = useCallback(
    (ms) =>
      setRun((r) => {
        if (r.status === 'running') return { ...r, endsAt: r.endsAt + ms, duration: r.duration + ms }
        if (r.status === 'paused') return { ...r, left: r.left + ms, duration: r.duration + ms }
        return r
      }),
    [setRun],
  )
  return { run, remaining, start, pause, resume, reset, add }
}

function useAlarm() {
  const [ringing, setRinging] = useState(false)
  const stopRef = useRef(null)
  const stop = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    setRinging(false)
  }, [])
  const ring = useCallback(() => {
    stopRef.current?.()
    stopRef.current = startAlarm()
    setRinging(true)
  }, [])
  useEffect(() => () => stopRef.current?.(), [])
  return { ringing, ring, stop }
}

function useTitle(text) {
  const original = useRef(null)
  useEffect(() => {
    if (original.current === null) original.current = document.title
    const base = original.current
    return () => {
      document.title = base
    }
  }, [])
  useEffect(() => {
    if (original.current === null) return
    document.title = text || original.current
  }, [text])
}

// Space, R, L and F, ignored while typing in a field.
function useShortcuts(map) {
  const ref = useRef(map)
  useEffect(() => {
    ref.current = map
  })
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const t = e.target
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
      // Let a focused button handle Space itself.
      if (key === 'space' && t.closest?.('button, a, [role="button"], [role="radio"]')) return
      const fn = ref.current[key]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useFullscreen(ref) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === ref.current && !!ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])
  const toggle = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else ref.current?.requestFullscreen?.().catch(() => {})
  }, [ref])
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled
  return { on, toggle, supported }
}

/* Pieces */

function Ring({ progress, children, done }) {
  const r = 108
  const c = 2 * Math.PI * r
  return (
    <div className={`tm-ring${done ? ' done' : ''}`}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <circle className="tm-ring-track" cx="120" cy="120" r={r} />
        <circle
          className="tm-ring-fill"
          cx="120"
          cy="120"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          transform="rotate(-90 120 120)"
        />
      </svg>
      <div className="tm-ring-inner">{children}</div>
    </div>
  )
}

function Clock({ text, done, sub }) {
  const long = text.length > 5
  return (
    <>
      <div className={`tm-time${long ? ' long' : ''}${done ? ' pulse' : ''}`}>{text}</div>
      {sub && <div className="tm-sub">{sub}</div>}
    </>
  )
}

function AlarmBar({ label, onStop }) {
  return (
    <div className="tm-alarm" role="alert">
      <span className="tm-alarm-dot" aria-hidden="true" />
      <span className="tm-alarm-text">{label}</span>
      <button type="button" className="btn primary small" onClick={onStop} autoFocus>
        <Stop size={14} weight="fill" />
        Stop
      </button>
    </div>
  )
}

function FullscreenButton({ fs }) {
  if (!fs.supported) return null
  return (
    <button type="button" className="icon tm-fs" onClick={fs.toggle} aria-label={fs.on ? 'Exit full screen' : 'Full screen'} title={fs.on ? 'Exit full screen (F)' : 'Full screen (F)'}>
      {fs.on ? <CornersIn size={18} /> : <CornersOut size={18} />}
    </button>
  )
}

/* Timer */

function TimerMode({ setTitle }) {
  const alarm = useAlarm()
  const [note, setNote] = useState('')
  const cd = useCountdown('handybits:timer:run', ({ late, duration }) => {
    if (late) {
      setNote('Finished while this page was closed.')
      return
    }
    alarm.ring()
    notify('Time’s up', `Your ${describeDuration(duration)} timer has finished.`)
  })
  const [input, setInput] = useState('')
  const stage = useRef(null)
  const fs = useFullscreen(stage)
  const { run, remaining } = cd
  const parsed = parseDuration(input)

  const startOrPause = () => {
    unlockAudio()
    askNotifyPermission()
    alarm.stop()
    setNote('')
    if (run.status === 'running') cd.pause()
    else if (run.status === 'paused') cd.resume()
    else cd.start(run.duration)
  }
  const reset = () => {
    alarm.stop()
    setNote('')
    cd.reset()
  }
  const choose = (ms) => {
    alarm.stop()
    setNote('')
    unlockAudio()
    askNotifyPermission()
    cd.start(ms)
  }

  useShortcuts({ space: startOrPause, r: reset, f: fs.toggle })

  const done = run.status === 'done'
  const text = formatCountdown(remaining)
  const title = run.status === 'running' || run.status === 'paused' ? `${text} · Timer` : done ? 'Time’s up · Timer' : ''
  useEffect(() => setTitle(title), [title, setTitle])

  const sub = done
    ? 'Time’s up'
    : run.status === 'running'
      ? `Ends at ${clockFmt.format(run.endsAt)}`
      : run.status === 'paused'
        ? 'Paused'
        : describeDuration(run.duration)

  return (
    <>
      <div className={`tm-stage panel${fs.on ? ' is-fs' : ''}`} ref={stage}>
        <FullscreenButton fs={fs} />
        <Ring progress={run.duration ? remaining / run.duration : 0} done={done}>
          <Clock text={text} done={done} sub={sub} />
        </Ring>
        {alarm.ringing && <AlarmBar label="Time’s up" onStop={alarm.stop} />}
        <div className="tm-controls">
          <button type="button" className="btn tm-side" onClick={reset} disabled={run.status === 'idle'}>
            <ArrowCounterClockwise size={16} />
            Reset
          </button>
          <button type="button" className="btn primary tm-main" onClick={startOrPause}>
            {run.status === 'running' ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
            {run.status === 'running' ? 'Pause' : run.status === 'paused' ? 'Resume' : done ? 'Restart' : 'Start'}
          </button>
          <button type="button" className="btn tm-side" onClick={() => cd.add(60000)} disabled={run.status !== 'running' && run.status !== 'paused'}>
            <Plus size={16} />1 min
          </button>
        </div>
        {note && <p className="tm-note">{note}</p>}
      </div>

      <section className="section tm-setup" aria-labelledby="tm-presets-h">
        <div className="section-head">
          <h2 id="tm-presets-h">Set a time</h2>
        </div>
        <div className="tm-presets" role="group" aria-label="Presets">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={`tm-preset${run.duration === m * 60000 ? ' on' : ''}`}
              onClick={() => choose(m * 60000)}
              aria-label={`Start ${m} minute${m === 1 ? '' : 's'}`}
            >
              {m}
              <span>min</span>
            </button>
          ))}
        </div>
        <form
          className="tm-custom"
          onSubmit={(e) => {
            e.preventDefault()
            if (parsed) {
              choose(parsed)
              setInput('')
            }
          }}
        >
          <label className="field-label" htmlFor="tm-input">
            Custom
          </label>
          <div className="tm-custom-row">
            <input
              id="tm-input"
              className="tm-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="90, 1:30, 5m30s or 1h 20m"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="tm-parse"
            />
            <button type="submit" className="btn" disabled={!parsed}>
              <Play size={15} weight="fill" />
              Start
            </button>
          </div>
          <p id="tm-parse" className={`tm-parse${input && !parsed ? ' bad' : ''}`} aria-live="polite">
            {!input ? 'A plain number means minutes.' : parsed ? formatCountdown(parsed) + ' · ' + describeDuration(parsed) : 'Try 90, 1:30, 5m30s or 1h 20m'}
          </p>
        </form>
      </section>
    </>
  )
}

/* Stopwatch */

const SW_IDLE = { running: false, startedAt: 0, acc: 0, laps: [] }

function StopwatchMode({ setTitle }) {
  const [sw, setSw] = useStoredState('handybits:timer:stopwatch', SW_IDLE, 0)
  const now = useNow(sw.running)
  const stage = useRef(null)
  const fs = useFullscreen(stage)
  const elapsed = sw.acc + (sw.running ? Math.max(0, now - sw.startedAt) : 0)
  const fmt = formatStopwatch(elapsed)

  const toggle = () =>
    setSw((s) => (s.running ? { ...s, running: false, acc: s.acc + (Date.now() - s.startedAt) } : { ...s, running: true, startedAt: Date.now() }))
  const lap = () =>
    setSw((s) => {
      if (!s.running) return s
      return { ...s, laps: [...s.laps, s.acc + (Date.now() - s.startedAt)] }
    })
  const reset = () => setSw(SW_IDLE)

  useShortcuts({ space: toggle, l: lap, r: reset, f: fs.toggle })

  // Whole seconds are enough for the tab title.
  const title = sw.running || elapsed ? `${fmt.main} · Stopwatch` : ''
  useEffect(() => setTitle(title), [title, setTitle])

  const rows = lapRows(sw.laps)
  const currentLap = elapsed - (sw.laps.at(-1) ?? 0)

  return (
    <>
      <div className={`tm-stage panel tm-sw${fs.on ? ' is-fs' : ''}`} ref={stage}>
        <FullscreenButton fs={fs} />
        <div className="tm-sw-face">
          <div className="tm-time tm-sw-time" aria-hidden="true">
            {fmt.main}
            <span className="tm-cs">.{fmt.cs}</span>
          </div>
          <div className="tm-sub">{sw.laps.length ? `Lap ${sw.laps.length + 1} · ${formatStopwatch(currentLap).text}` : sw.running ? 'Running' : elapsed ? 'Paused' : 'Ready'}</div>
          <span className="sr-only">{`Elapsed ${fmt.main}`}</span>
        </div>
        <div className="tm-controls">
          <button type="button" className="btn tm-side" onClick={reset} disabled={!elapsed}>
            <ArrowCounterClockwise size={16} />
            Reset
          </button>
          <button type="button" className="btn primary tm-main" onClick={toggle}>
            {sw.running ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
            {sw.running ? 'Pause' : elapsed ? 'Resume' : 'Start'}
          </button>
          <button type="button" className="btn tm-side" onClick={lap} disabled={!sw.running}>
            <Flag size={16} />
            Lap
          </button>
        </div>
      </div>

      <section className="section" aria-labelledby="tm-laps-h">
        <div className="section-head">
          <h2 id="tm-laps-h">
            Laps <span className="count">{rows.length}</span>
          </h2>
        </div>
        {rows.length ? (
          <div className="tm-laps-wrap">
            <table className="tm-laps">
              <thead>
                <tr>
                  <th scope="col">Lap</th>
                  <th scope="col">Lap time</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .reverse()
                  .map((r) => (
                    <tr key={r.n} className={r.fastest ? 'fast' : r.slowest ? 'slow' : undefined}>
                      <td>
                        {r.n}
                        {r.fastest && <span className="tm-tag">Fastest</span>}
                        {r.slowest && <span className="tm-tag">Slowest</span>}
                      </td>
                      <td>{formatStopwatch(r.lap).text}</td>
                      <td>{formatStopwatch(r.total).text}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tm-empty">
            Press <kbd>L</kbd> or Lap while running to record a split.
          </p>
        )}
      </section>
    </>
  )
}

/* Pomodoro */

function NumberField({ id, label, value, onChange, min, max, unit }) {
  return (
    <div className="tm-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="tm-num">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value))
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
          }}
        />
        <span>{unit}</span>
      </div>
    </div>
  )
}

function PomodoroMode({ setTitle }) {
  const [stored, setSettings] = useStoredState('handybits:timer:pomodoro', POMO_DEFAULTS)
  const settings = { ...POMO_DEFAULTS, ...stored }
  const [state, setState] = useStoredState('handybits:timer:pomo-state', { phase: 'focus', completed: 0 }, 0)
  const alarm = useAlarm()
  const lengthOf = (phase, s = settings) => s[phase] * 60000
  const stage = useRef(null)
  const fs = useFullscreen(stage)

  // Moves to the following phase and returns it.
  const advance = (fromPhase) => {
    const completed = fromPhase === 'focus' ? state.completed + 1 : state.completed
    const phase = nextPhase(fromPhase, completed, settings.every)
    setState({ phase, completed })
    return phase
  }

  const cd = useCountdown('handybits:timer:pomo-run', ({ late }) => {
    const next = advance(state.phase)
    const auto = settings.auto && !late
    if (late) return { reset: lengthOf(next) }
    const msg = state.phase === 'focus' ? `Focus done. Next: ${PHASES[next].toLowerCase()}.` : 'Break over. Time to focus.'
    if (settings.auto) playChime()
    else alarm.ring()
    notify(state.phase === 'focus' ? 'Focus session complete' : 'Break finished', msg)
    return auto ? { start: lengthOf(next) } : { reset: lengthOf(next) }
  })
  const { run, remaining } = cd

  // Keep the idle timer in step with edited lengths.
  const idleLength = lengthOf(state.phase)
  useEffect(() => {
    if (run.status === 'idle' && run.duration !== idleLength) cd.reset(idleLength)
  }, [run.status, run.duration, idleLength, cd])

  const startOrPause = () => {
    unlockAudio()
    askNotifyPermission()
    alarm.stop()
    if (run.status === 'running') cd.pause()
    else if (run.status === 'paused') cd.resume()
    else cd.start(lengthOf(state.phase))
  }
  const reset = () => {
    alarm.stop()
    cd.reset(lengthOf(state.phase))
  }
  const skip = () => {
    alarm.stop()
    cd.reset(lengthOf(advance(state.phase)))
  }
  const pick = (phase) => {
    alarm.stop()
    setState((s) => ({ ...s, phase }))
    cd.reset(lengthOf(phase))
  }

  useShortcuts({ space: startOrPause, r: reset, f: fs.toggle })

  const text = formatCountdown(remaining)
  const active = run.status === 'running' || run.status === 'paused'
  const title = active ? `${text} · ${PHASES[state.phase]}` : ''
  useEffect(() => setTitle(title), [title, setTitle])

  const inCycle = state.completed % settings.every
  const filled = state.completed > 0 && inCycle === 0 && state.phase === 'long' ? settings.every : inCycle

  return (
    <>
      <div className={`tm-stage panel${fs.on ? ' is-fs' : ''}`} ref={stage} data-phase={state.phase}>
        <FullscreenButton fs={fs} />
        <div className="segmented tm-phases" role="radiogroup" aria-label="Phase">
          {Object.entries(PHASES).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={state.phase === k} className={state.phase === k ? 'on' : ''} onClick={() => pick(k)} disabled={active && state.phase !== k}>
              {label}
            </button>
          ))}
        </div>
        <Ring progress={run.duration ? remaining / run.duration : 0}>
          <Clock text={text} sub={run.status === 'paused' ? 'Paused' : PHASES[state.phase]} />
        </Ring>
        <div className="tm-dots" role="img" aria-label={`${filled} of ${settings.every} focus sessions in this round`}>
          {Array.from({ length: settings.every }, (_, i) => (
            <span key={i} className={i < filled ? 'on' : i === filled && state.phase === 'focus' ? 'now' : undefined} />
          ))}
        </div>
        {alarm.ringing && <AlarmBar label={state.phase === 'focus' ? 'Break over' : 'Focus session complete'} onStop={alarm.stop} />}
        <div className="tm-controls">
          <button type="button" className="btn tm-side" onClick={reset} disabled={run.status === 'idle'}>
            <ArrowCounterClockwise size={16} />
            Reset
          </button>
          <button type="button" className="btn primary tm-main" onClick={startOrPause}>
            {run.status === 'running' ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
            {run.status === 'running' ? 'Pause' : run.status === 'paused' ? 'Resume' : 'Start'}
          </button>
          <button type="button" className="btn tm-side" onClick={skip}>
            <SkipForward size={16} />
            Skip
          </button>
        </div>
        <p className="tm-note">
          {state.completed} focus session{state.completed === 1 ? '' : 's'} done
          {state.completed > 0 && (
            <button type="button" className="tm-link" onClick={() => setState((s) => ({ ...s, completed: 0 }))}>
              Clear
            </button>
          )}
        </p>
      </div>

      <section className="section" aria-labelledby="tm-pomo-h">
        <div className="section-head">
          <h2 id="tm-pomo-h">Lengths</h2>
          <button type="button" className="btn ghost small" onClick={() => setSettings(POMO_DEFAULTS)}>
            Reset
          </button>
        </div>
        <div className="panel tm-pomo-settings">
          <NumberField id="tm-focus" label="Focus" value={settings.focus} min={1} max={180} unit="min" onChange={(v) => setSettings({ ...settings, focus: v })} />
          <NumberField id="tm-short" label="Short break" value={settings.short} min={1} max={60} unit="min" onChange={(v) => setSettings({ ...settings, short: v })} />
          <NumberField id="tm-long" label="Long break" value={settings.long} min={1} max={120} unit="min" onChange={(v) => setSettings({ ...settings, long: v })} />
          <NumberField id="tm-every" label="Long break every" value={settings.every} min={2} max={12} unit="sessions" onChange={(v) => setSettings({ ...settings, every: v })} />
          <label className={`check tm-auto${settings.auto ? ' on' : ''}`}>
            <input type="checkbox" checked={settings.auto} onChange={(e) => setSettings({ ...settings, auto: e.target.checked })} />
            Start the next phase automatically
          </label>
        </div>
      </section>
    </>
  )
}

export default function TimerTool() {
  const [mode, setMode] = useStoredState('handybits:timer:mode', 'timer')
  const [title, setTitle] = useState('')
  useTitle(title)
  const current = MODES.some(([k]) => k === mode) ? mode : 'timer'

  return (
    <div className="tool tm">
      <header className="header">
        <h1 className="title">Timer & stopwatch</h1>
        <p className="lede">A countdown, a stopwatch with laps, and a Pomodoro cycle. Keeps accurate time even in a background tab.</p>
      </header>

      <div className="segmented tm-modes" role="radiogroup" aria-label="Mode">
        {MODES.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={current === k} className={current === k ? 'on' : ''} onClick={() => setMode(k)}>
            {label}
          </button>
        ))}
      </div>

      {current === 'timer' && <TimerMode setTitle={setTitle} />}
      {current === 'stopwatch' && <StopwatchMode setTitle={setTitle} />}
      {current === 'pomodoro' && <PomodoroMode setTitle={setTitle} />}

      <p className="tm-keys">
        <span>
          <kbd>Space</kbd> start or pause
        </span>
        <span>
          <kbd>R</kbd> reset
        </span>
        {current === 'stopwatch' && (
          <span>
            <kbd>L</kbd> lap
          </span>
        )}
        <span>
          <kbd>F</kbd> full screen
        </span>
      </p>

      <p className="footer">
        Times are worked out from the clock, not counted tick by tick, so they stay right when the tab is in the background. A running timer is
        remembered if you reload. You’ll get a notification when time is up if you allow it.
      </p>
    </div>
  )
}
