import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, ArrowsClockwise, Trophy } from '@phosphor-icons/react'
import { WORDS } from '../lib/typing-words.js'
import { QUOTES } from '../lib/typing-quotes.js'
import * as E from '../lib/typing-engine.js'
import { useStoredState } from '../lib/text-hooks.js'
import './TypingTest.css'

const AMOUNTS = { time: [15, 30, 60, 120], words: [10, 25, 50, 100] }
const DEFAULTS = { mode: 'time', time: 30, words: 25, punctuation: false, numbers: false }
const PB_KEY = 'handybits:typing:pb'

function readPbs() {
  try {
    return JSON.parse(localStorage.getItem(PB_KEY)) || {}
  } catch {
    return {}
  }
}

function makeWords(cfg) {
  if (cfg.mode === 'quote') return E.quoteWords(QUOTES[Math.floor(Math.random() * QUOTES.length)])
  const count = cfg.mode === 'words' ? cfg.words : 120
  return E.generateWords(WORDS, count, cfg)
}

const round = (v) => Math.round(v)

export default function TypingTest() {
  const [cfg, setCfg] = useStoredState('handybits:typing:settings', DEFAULTS)
  const [state, setState] = useState(() => E.initialState(makeWords(cfg)))
  const [phase, setPhase] = useState('idle') // idle | running | done
  const [elapsed, setElapsed] = useState(0)
  const [focused, setFocused] = useState(false)
  const [result, setResult] = useState(null)
  const [announce, setAnnounce] = useState('')

  const inputRef = useRef(null)
  const restartRef = useRef(null)
  const stateRef = useRef(state)
  const phaseRef = useRef(phase)
  const startRef = useRef(0)
  const samples = useRef([]) // per-second { raw, net, errors }
  const lastSample = useRef({ chars: 0, errors: 0 })
  const composing = useRef(false)
  useLayoutEffect(() => {
    stateRef.current = state
    phaseRef.current = phase
  }, [state, phase])

  const amount = cfg.mode === 'quote' ? null : cfg[cfg.mode]
  const timeLimit = cfg.mode === 'time' ? cfg.time : null

  const reset = useCallback(
    (sameWords = false, nextCfg = cfg) => {
      const words = sameWords ? stateRef.current.words.slice(0, nextCfg.mode === 'time' ? undefined : stateRef.current.words.length) : makeWords(nextCfg)
      const s = E.initialState(words)
      stateRef.current = s
      setState(s)
      phaseRef.current = 'idle'
      setPhase('idle')
      setElapsed(0)
      setResult(null)
      samples.current = []
      lastSample.current = { chars: 0, errors: 0 }
      if (inputRef.current) inputRef.current.value = ''
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [cfg],
  )

  function changeCfg(patch) {
    const next = { ...cfg, ...patch }
    setCfg(next)
    reset(false, next)
  }

  // Sample once per second while running; finish timed tests.
  const finish = useCallback(
    (endState, seconds) => {
      phaseRef.current = 'done'
      setPhase('done')
      const chars = E.countChars(endState, { final: endState.done })
      const secs = Math.max(seconds, 0.5)
      const raws = samples.current.map((s) => s.raw)
      const res = {
        wpm: E.wpm(chars, secs),
        raw: E.rawWpm(chars, secs),
        acc: E.accuracy(endState.keys),
        consistency: E.consistency(raws),
        chars,
        seconds: secs,
        samples: samples.current.slice(),
      }
      const key = E.pbKey({ mode: cfg.mode, amount, punctuation: cfg.punctuation, numbers: cfg.numbers })
      const pbs = readPbs()
      const prev = pbs[key]
      // Only count tests with something real typed.
      const valid = chars.correct > 0 && res.acc >= 50
      res.prevBest = prev?.wpm ?? null
      res.newBest = valid && (!prev || res.wpm > prev.wpm)
      if (res.newBest) {
        pbs[key] = { wpm: res.wpm, acc: res.acc, at: Date.now() }
        try {
          localStorage.setItem(PB_KEY, JSON.stringify(pbs))
        } catch {
          // ignore
        }
      }
      setResult(res)
      setAnnounce(`Test complete. ${round(res.wpm)} words per minute, ${round(res.acc)} percent accuracy.${res.newBest ? ' New personal best.' : ''}`)
      requestAnimationFrame(() => document.querySelector(".ty-results")?.focus())
    },
    [cfg, amount],
  )

  useEffect(() => {
    if (phase !== 'running') return
    const tick = () => {
      const now = performance.now()
      const secs = (now - startRef.current) / 1000
      const s = stateRef.current
      // Record a sample for each whole second that has passed.
      while (samples.current.length < Math.floor(secs)) {
        const t = samples.current.length + 1
        const chars = E.countChars(s)
        const typedChars = chars.correct + chars.incorrect + chars.extra + chars.typedSpaces
        const delta = Math.max(0, typedChars - lastSample.current.chars)
        const errs = s.keys.errors - lastSample.current.errors
        samples.current.push({ t, raw: (delta / 5) * 60, net: E.wpm(chars, t), errors: errs })
        lastSample.current = { chars: typedChars, errors: s.keys.errors }
      }
      if (timeLimit && secs >= timeLimit) {
        finish(s, timeLimit)
        return
      }
      setElapsed(secs)
    }
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [phase, timeLimit, finish])

  const apply = useCallback(
    (fn) => {
      if (phaseRef.current === 'done') return
      const prev = stateRef.current
      let next = fn(prev)
      if (next === prev) return
      if (phaseRef.current === 'idle') {
        startRef.current = performance.now()
        phaseRef.current = 'running'
        setPhase('running')
      }
      // Time mode: keep plenty of words ahead.
      if (cfg.mode === 'time' && next.words.length - next.typed.length < 40) {
        next = { ...next, words: next.words.concat(E.generateWords(WORDS, 60, { ...cfg, startOfSentence: /[.?!]$/.test(next.words.at(-1)) })) }
      }
      stateRef.current = next
      setState(next)
      if (next.done) finish(next, (performance.now() - startRef.current) / 1000)
    },
    [cfg, finish],
  )

  // Native input events: handles hardware keyboards, mobile keyboards and IME.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onBeforeInput = (e) => {
      if (composing.current || e.isComposing) return
      const t = e.inputType
      if (t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'insertFromYank') {
        e.preventDefault()
        return
      }
      if (t === 'insertText' || t === 'insertReplacementText') {
        e.preventDefault()
        if (e.data) apply((s) => E.typeText(s, e.data))
      } else if (t === 'deleteContentBackward') {
        e.preventDefault()
        apply(E.backspace)
      } else if (t === 'deleteWordBackward' || t === 'deleteSoftLineBackward' || t === 'deleteHardLineBackward') {
        e.preventDefault()
        apply(E.deleteWord)
      } else if (t === 'insertLineBreak' || t === 'insertParagraph') {
        e.preventDefault()
      }
    }
    // Fallback for browsers that don't let us cancel beforeinput.
    const onInput = () => {
      if (composing.current) return
      if (el.value) {
        const v = el.value
        el.value = ''
        apply((s) => E.typeText(s, v))
      }
    }
    const onCompStart = () => {
      composing.current = true
    }
    const onCompEnd = (e) => {
      composing.current = false
      const v = e.data || el.value
      el.value = ''
      if (v) apply((s) => E.typeText(s, v))
    }
    const block = (e) => e.preventDefault()
    el.addEventListener('beforeinput', onBeforeInput)
    el.addEventListener('input', onInput)
    el.addEventListener('compositionstart', onCompStart)
    el.addEventListener('compositionend', onCompEnd)
    el.addEventListener('paste', block)
    el.addEventListener('drop', block)
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput)
      el.removeEventListener('input', onInput)
      el.removeEventListener('compositionstart', onCompStart)
      el.removeEventListener('compositionend', onCompEnd)
      el.removeEventListener('paste', block)
      el.removeEventListener('drop', block)
    }
  }, [apply])

  function onInputKeyDown(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      restartRef.current?.focus()
    }
  }

  // Esc resets from anywhere in the tool; printable keys refocus the test.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (document.querySelector('.cmd-backdrop')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        reset(true)
        return
      }
      const active = document.activeElement
      if (active === inputRef.current) return
      const tag = active?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return
      if (tag === 'BUTTON' || tag === 'A' || active?.getAttribute('role') === 'radio') {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'Tab' || e.key.startsWith('Arrow')) return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && phaseRef.current !== 'done') {
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reset])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Live stats
  const live = useMemo(() => {
    if (phase !== 'running' || elapsed < 1) return { wpm: 0, acc: E.accuracy(state.keys) }
    return { wpm: E.wpm(E.countChars(state), elapsed), acc: E.accuracy(state.keys) }
  }, [state, elapsed, phase])

  const progress =
    cfg.mode === 'time' ? `${Math.max(0, Math.ceil(timeLimit - elapsed))}` : `${Math.min(state.typed.length - (state.typed.at(-1) === '' ? 1 : 0), state.words.length)}/${state.words.length}`

  return (
    <div className="tool ty">
      <header className="header">
        <h1 className="title">Typing test</h1>
        <p className="lede">Check your speed and accuracy. The timer starts when you type the first letter.</p>
      </header>

      <div className="ty-config" aria-label="Test settings">
        <div className="segmented" role="radiogroup" aria-label="Mode">
          {[
            ['time', 'Time'],
            ['words', 'Words'],
            ['quote', 'Quote'],
          ].map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={cfg.mode === key} className={cfg.mode === key ? 'on' : ''} onClick={() => changeCfg({ mode: key })}>
              {label}
            </button>
          ))}
        </div>
        {cfg.mode !== 'quote' && (
          <>
            <div className="segmented" role="radiogroup" aria-label={cfg.mode === 'time' ? 'Seconds' : 'Number of words'}>
              {AMOUNTS[cfg.mode].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={amount === n} className={amount === n ? 'on' : ''} onClick={() => changeCfg({ [cfg.mode]: n })}>
                  {n}
                  {cfg.mode === 'time' && <span className="ty-unit">s</span>}
                </button>
              ))}
            </div>
            <div className="ty-toggles">
              <label className={`check${cfg.punctuation ? ' on' : ''}`}>
                <input type="checkbox" checked={cfg.punctuation} onChange={(e) => changeCfg({ punctuation: e.target.checked })} />
                Punctuation
              </label>
              <label className={`check${cfg.numbers ? ' on' : ''}`}>
                <input type="checkbox" checked={cfg.numbers} onChange={(e) => changeCfg({ numbers: e.target.checked })} />
                Numbers
              </label>
            </div>
          </>
        )}
      </div>

      {phase !== 'done' ? (
        <div className={`ty-stage panel${phase === 'running' ? ' running' : ''}`}>
          <div className="ty-live" aria-hidden="true">
            <span className="ty-live-main">{progress}</span>
            <span>
              {round(live.wpm)} <span className="ty-live-unit">wpm</span>
            </span>
            <span>
              {round(live.acc)}% <span className="ty-live-unit">acc</span>
            </span>
          </div>
          <TextArea state={state} focused={focused} typing={phase === 'running'} onFocusRequest={() => inputRef.current?.focus()} />
          <input
            ref={inputRef}
            className="ty-input"
            type="text"
            aria-label="Type the text shown here"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
            inputMode="text"
            enterKeyHint="next"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onInputKeyDown}
          />
          <p className="sr-only">
            Text to type: {state.words.slice(0, cfg.mode === 'time' ? 60 : undefined).join(' ')}
          </p>
        </div>
      ) : (
        result && <Results result={result} cfg={cfg} amount={amount} />
      )}

      <div className="ty-bar">
        <button ref={restartRef} type="button" className="btn small" onClick={() => reset(false)}>
          <ArrowsClockwise size={15} />
          {phase === 'done' ? 'Next test' : 'New text'}
        </button>
        <button type="button" className="btn ghost small" onClick={() => reset(true)}>
          <ArrowCounterClockwise size={15} />
          Retry this text
        </button>
        <p className="ty-keys">
          <kbd>Tab</kbd> then <kbd>Enter</kbd> for a new text · <kbd>Esc</kbd> to reset
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <p className="footer">Personal bests are saved on this device only. Words per minute counts five characters as one word, and only correct characters count.</p>
    </div>
  )
}

// ---------- Text area ----------

const Word = memo(function Word({ word, typed, current, submitted }) {
  const letters = []
  const len = Math.max(word.length, typed.length)
  for (let j = 0; j < len; j++) {
    const t = typed[j]
    const w = word[j]
    let cls = ''
    if (j >= word.length) cls = 'extra'
    else if (t === undefined) cls = submitted ? 'missed' : ''
    else cls = t === w ? 'ok' : 'bad'
    letters.push(
      <span key={j} className={cls || undefined}>
        {j >= word.length ? t : w}
      </span>,
    )
  }
  const wrong = submitted && typed !== word
  return (
    <span className={`ty-word${current ? ' current' : ''}${wrong ? ' wrong' : ''}`} data-current={current || undefined}>
      {letters}
    </span>
  )
})

function TextArea({ state, focused, typing, onFocusRequest }) {
  const boxRef = useRef(null)
  const innerRef = useRef(null)
  const caretRef = useRef(null)
  const [shift, setShift] = useState(0)
  const cur = state.typed.length - 1
  const typedCur = state.typed[cur]

  // Only render a window of words around the current one.
  const start = 0
  const end = Math.min(state.words.length, cur + 80)

  useLayoutEffect(() => {
    const inner = innerRef.current
    const caret = caretRef.current
    if (!inner || !caret) return
    const word = inner.querySelector('[data-current]')
    if (!word) return
    const letters = word.children
    let x
    let y
    let h
    const i = typedCur.length
    if (i < letters.length) {
      const l = letters[i]
      x = l.offsetLeft
      y = l.offsetTop
      h = l.offsetHeight
    } else {
      const l = letters[letters.length - 1]
      x = l ? l.offsetLeft + l.offsetWidth : word.offsetLeft
      y = l ? l.offsetTop : word.offsetTop
      h = l ? l.offsetHeight : word.offsetHeight
    }
    caret.style.transform = `translate(${x - 1}px, ${y + h * 0.12}px)`
    caret.style.height = `${h * 0.76}px`
    // Keep the current line as the second visible line.
    const lineH = word.offsetHeight
    const next = Math.max(0, word.offsetTop - lineH)
    setShift((s) => (Math.abs(s - next) > 1 ? next : s))
  }, [typedCur, cur, state.words])

  return (
    <div
      ref={boxRef}
      className={`ty-text${focused ? ' focused' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault()
        onFocusRequest()
      }}
      aria-hidden="true"
    >
      <div ref={innerRef} className="ty-words" style={{ transform: `translateY(${-shift}px)` }}>
        {state.words.slice(start, end).map((w, k) => {
          const i = start + k
          return <Word key={i} word={w} typed={state.typed[i] ?? ''} current={i === cur} submitted={i < cur || (state.done && i === cur)} />
        })}
        <span ref={caretRef} className={`ty-caret${typing ? '' : ' idle'}${focused ? '' : ' hidden'}`} />
      </div>
      {!focused && (
        <div className="ty-blur">
          <span>Click or press any key to focus</span>
        </div>
      )}
    </div>
  )
}

// ---------- Results ----------

function Results({ result, cfg, amount }) {
  const r = result
  const label = cfg.mode === 'quote' ? 'Quote' : cfg.mode === 'time' ? `${amount} seconds` : `${amount} words`
  const extras = [cfg.punctuation && cfg.mode !== 'quote' && 'punctuation', cfg.numbers && cfg.mode !== 'quote' && 'numbers'].filter(Boolean)
  return (
    <section className="ty-results panel" aria-labelledby="ty-res-h" tabIndex={-1}>
      <h2 id="ty-res-h" className="sr-only">
        Results
      </h2>
      <div className="ty-hero">
        <div className="ty-big">
          <span className="ty-big-label">wpm</span>
          <span className="ty-big-value">{round(r.wpm)}</span>
        </div>
        <div className="ty-big">
          <span className="ty-big-label">accuracy</span>
          <span className="ty-big-value">
            {round(r.acc)}
            <span className="ty-pct">%</span>
          </span>
        </div>
        <div className="ty-best">
          {r.newBest ? (
            <span className="ty-pb">
              <Trophy size={15} weight="fill" />
              New personal best
            </span>
          ) : (
            r.prevBest != null && <span className="ty-pb-old">Personal best {round(r.prevBest)} wpm</span>
          )}
          <span className="ty-test-label">
            {label}
            {extras.length ? ` · ${extras.join(', ')}` : ''}
          </span>
        </div>
      </div>

      <Chart samples={r.samples} />

      <dl className="ty-stats">
        <div>
          <dt>Raw</dt>
          <dd>{round(r.raw)}</dd>
        </div>
        <div>
          <dt>Consistency</dt>
          <dd>{round(r.consistency)}%</dd>
        </div>
        <div>
          <dt title="correct / incorrect / extra / missed">Characters</dt>
          <dd>
            <span className="ty-c-ok">{r.chars.correct + r.chars.spaces}</span>
            <span className="ty-slash">/</span>
            <span className="ty-c-bad">{r.chars.incorrect}</span>
            <span className="ty-slash">/</span>
            {r.chars.extra}
            <span className="ty-slash">/</span>
            {r.chars.missed}
          </dd>
          <dd className="ty-dd-hint">correct / incorrect / extra / missed</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{r.seconds < 10 ? r.seconds.toFixed(1) : round(r.seconds)}s</dd>
        </div>
      </dl>
    </section>
  )
}

function Chart({ samples }) {
  const ref = useRef(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (samples.length < 2) return <div ref={ref} className="ty-chart ty-chart-empty" />

  const H = 150
  const pad = { l: 30, r: 8, t: 10, b: 22 }
  const max = Math.max(10, ...samples.map((s) => Math.max(s.raw, s.net)))
  const top = Math.ceil(max / 20) * 20
  const n = samples.length
  const x = (i) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r)
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const line = (key) => samples.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join('')
  const ticks = [0, top / 2, top]
  const step = Math.max(1, Math.ceil(n / Math.floor((w - 40) / 40)))

  return (
    <figure className="ty-chart" ref={ref}>
      <svg width={w} height={H} role="img" aria-label={`Words per minute over ${n} seconds`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="ty-grid" />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" className="ty-axis">
              {t}
            </text>
          </g>
        ))}
        {samples.map((s, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="ty-axis">
              {s.t}
            </text>
          ) : null,
        )}
        <path d={line('raw')} className="ty-line-raw" />
        <path d={line('net')} className="ty-line-net" />
        {samples.map((s, i) => (s.errors > 0 ? <circle key={i} cx={x(i)} cy={y(s.raw)} r={2.6} className="ty-err" /> : null))}
      </svg>
      <figcaption className="ty-legend">
        <span>
          <i className="ty-key-net" /> wpm
        </span>
        <span>
          <i className="ty-key-raw" /> raw
        </span>
        <span>
          <i className="ty-key-err" /> errors
        </span>
      </figcaption>
    </figure>
  )
}
