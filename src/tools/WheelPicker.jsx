import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowClockwise,
  ChartPieSlice,
  Check,
  Coin,
  Copy,
  DiceFive,
  FloppyDisk,
  Hash,
  Minus,
  Plus,
  Shuffle,
  SortAscending,
  SpeakerHigh,
  SpeakerSlash,
  Trash,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import { easeOutCubic, flipCoin, indexAtRotation, parseEntries, pickNumbers, planSpin, rollDice, shuffle, splitTeams } from '../lib/wheel-core.js'
import { landed, tick, unlockWheelAudio } from '../lib/wheel-audio.js'
import { useCopy, useStoredState } from '../lib/text-hooks.js'
import { parseNumber } from '../lib/units.js'
import './WheelPicker.css'

const MODES = [
  ['wheel', 'Wheel', ChartPieSlice],
  ['coin', 'Coin', Coin],
  ['dice', 'Dice', DiceFive],
  ['number', 'Number', Hash],
  ['teams', 'Teams', UsersThree],
]

const MAX_ENTRIES = 200
const DEFAULT_ENTRIES = 'Ada\nGrace\nLinus\nMargaret\nAlan\nKatherine'

// Warm, muted, alternating dark and light, taken from the design tokens.
const PALETTE = [
  ['#b5532f', '#fff'],
  ['#f1e8dc', '#3a3833'],
  ['#3a3833', '#f7f6f3'],
  ['#dfcdb8', '#3a3833'],
  ['#5f7a63', '#fff'],
  ['#f6efe6', '#3a3833'],
  ['#8b5a3c', '#fff'],
  ['#e6dccd', '#3a3833'],
]

function segmentColor(i, n) {
  // With an odd count the last segment would touch the first in the same colour.
  if (n > 1 && i === n - 1 && i % PALETTE.length === 0) return PALETTE[2]
  return PALETTE[i % PALETTE.length]
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid
    else hi = mid - 1
  }
  return lo ? text.slice(0, lo).trimEnd() + '…' : ''
}

/* Wheel */

function Wheel({ sound, setSound }) {
  const [text, setText] = useStoredState('handybits:wheel:text', DEFAULT_ENTRIES)
  const [lists, setLists] = useStoredState('handybits:wheel:lists', [])
  const [listName, setListName] = useState('')
  const entries = useMemo(() => parseEntries(text, MAX_ENTRIES), [text])
  const totalLines = useMemo(() => parseEntries(text, Infinity).length, [text])
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState(null)
  const [size, setSize] = useState(0)
  const canvasRef = useRef(null)
  const boxRef = useRef(null)
  const rotation = useRef(0)
  const raf = useRef(0)
  const labelsRef = useRef({ key: '', labels: [], fs: 0 })
  const n = entries.length

  // Track the drawn size so the canvas stays crisp.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !size) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr)
      canvas.height = Math.round(size * dpr)
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const c = size / 2
    const r = c - 3
    const hub = Math.max(18, r * 0.13)
    const rot = rotation.current
    canvas.dataset.rotation = String(rot)

    if (!n) {
      ctx.beginPath()
      ctx.arc(c, c, r - 1, 0, Math.PI * 2)
      ctx.fillStyle = '#efede8'
      ctx.fill()
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = '#d4d0c6'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#a19d94'
      ctx.font = '500 14px "Geist Variable", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Add some entries', c, c)
      return
    }

    const s = (Math.PI * 2) / n
    // Labels are measured once per entry list and size, not every frame.
    const chord = 2 * r * 0.68 * Math.sin(Math.min(s, Math.PI) / 2)
    const fs = Math.min(16, Math.max(9, size / 30), chord * 0.62)
    const showLabels = n === 1 || chord >= 9
    const maxW = r - hub - 26
    const key = `${size}|${fs}|${entries.join('\n')}`
    if (labelsRef.current.key !== key) {
      ctx.font = `550 ${fs}px "Geist Variable", system-ui, sans-serif`
      labelsRef.current = { key, labels: entries.map((e) => fitText(ctx, e, maxW)) }
    }
    const labels = labelsRef.current.labels

    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + rot + i * s
      const [bg, fg] = segmentColor(i, n)
      ctx.beginPath()
      ctx.moveTo(c, c)
      ctx.arc(c, c, r, a0, a0 + s)
      ctx.closePath()
      ctx.fillStyle = bg
      ctx.fill()
      if (n > 1 && n <= 120) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.lineWidth = 1.25
        ctx.stroke()
      }
      if (showLabels && labels[i]) {
        ctx.save()
        ctx.translate(c, c)
        ctx.rotate(n === 1 ? -Math.PI / 2 + rot : a0 + s / 2)
        ctx.fillStyle = fg
        ctx.font = `550 ${fs}px "Geist Variable", system-ui, sans-serif`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(labels[i], r - 16, 0.5)
        ctx.restore()
      }
    }
    // Rim and hub.
    ctx.beginPath()
    ctx.arc(c, c, r, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(60,45,20,0.12)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(c, c, hub, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(60,45,20,0.18)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 1
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = '#e6e3dc'
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(c, c, hub * 0.28, 0, Math.PI * 2)
    ctx.fillStyle = '#b5532f'
    ctx.fill()
  }, [size, n, entries])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const spin = useCallback(() => {
    if (spinning || !n) return
    if (sound) unlockWheelAudio()
    const plan = planSpin(rotation.current, n, { reduced: reducedMotion() })
    const snapshot = { text, entries }
    setResult(null)
    setSpinning(true)
    const t0 = performance.now()
    let lastIdx = indexAtRotation(rotation.current, n)
    const step = (now) => {
      const t = Math.min(1, (now - t0) / plan.duration)
      rotation.current = plan.from + (plan.to - plan.from) * easeOutCubic(t)
      draw()
      if (sound) {
        const idx = indexAtRotation(rotation.current, n)
        if (idx !== lastIdx) {
          lastIdx = idx
          tick()
        }
      }
      if (t < 1) {
        raf.current = requestAnimationFrame(step)
        return
      }
      // Keep the number small without changing where the wheel points.
      rotation.current = plan.to % (Math.PI * 2)
      draw()
      setSpinning(false)
      if (sound) landed()
      const landedIdx = indexAtRotation(rotation.current, n)
      setResult({ index: landedIdx, name: snapshot.entries[landedIdx], planned: plan.index, text: snapshot.text })
    }
    raf.current = requestAnimationFrame(step)
  }, [spinning, n, sound, text, entries, draw])

  // Ctrl or Cmd + Enter spins from anywhere in this mode.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        spin()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spin])

  const removeWinner = () => {
    if (!result) return
    const lines = text.split(/\r?\n/)
    let target = -1
    if (text === result.text) {
      let k = -1
      target = lines.findIndex((l) => l.trim() && ++k === result.index)
    } else target = lines.findIndex((l) => l.trim() === result.name)
    if (target >= 0) lines.splice(target, 1)
    setText(lines.join('\n'))
    setResult(null)
  }

  const reorder = (fn) => {
    setText(fn(entries).join('\n'))
    setResult(null)
  }

  const saveList = () => {
    const name = listName.trim() || `List ${lists.length + 1}`
    setLists([{ name, text: entries.join('\n') }, ...lists.filter((l) => l.name !== name)].slice(0, 30))
    setListName('')
  }

  return (
    <>
      <div className="wh-grid">
        <div className="wh-stage">
          <div className="wh-wheel" ref={boxRef}>
            <svg className="wh-pointer" viewBox="0 0 32 36" aria-hidden="true">
              <path d="M16 34 3.5 8.5C1.9 5.2 4.3 2 8 2h16c3.7 0 6.1 3.2 4.5 6.5Z" />
            </svg>
            <canvas
              ref={canvasRef}
              className={`wh-canvas${spinning ? ' spinning' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={n ? `Wheel with ${n} entries. Press Enter to spin.` : 'Wheel with no entries'}
              aria-disabled={spinning || !n}
              onClick={spin}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  spin()
                }
              }}
            />
          </div>
          <div className="wh-spin-row">
            <button type="button" className="btn primary wh-spin" onClick={spin} disabled={spinning || !n}>
              <ArrowClockwise size={17} weight="bold" />
              {spinning ? 'Spinning…' : 'Spin'}
            </button>
            <button
              type="button"
              className={`icon wh-sound${sound ? ' on' : ''}`}
              onClick={() => setSound(!sound)}
              aria-pressed={sound}
              aria-label={sound ? 'Sound on' : 'Sound off'}
              title={sound ? 'Sound on' : 'Sound off'}
            >
              {sound ? <SpeakerHigh size={18} /> : <SpeakerSlash size={18} />}
            </button>
          </div>
          <p className="wh-hint">
            Click the wheel or press <kbd>Ctrl</kbd> <kbd>Enter</kbd>
          </p>
        </div>

        <div className="wh-side">
          <div className="wh-entries-head">
            <label className="field-label" htmlFor="wh-entries">
              Entries
            </label>
            <span className="count">{n}</span>
          </div>
          <textarea
            id="wh-entries"
            className="wh-textarea"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setResult(null)
            }}
            disabled={spinning}
            spellCheck={false}
            placeholder="One entry per line"
            aria-describedby="wh-entries-note"
          />
          <p id="wh-entries-note" className="wh-small">
            One per line. Repeat a line to give it more chances.
            {totalLines > MAX_ENTRIES && ` Only the first ${MAX_ENTRIES} are used.`}
          </p>
          <div className="wh-tools">
            <button type="button" className="btn small" onClick={() => reorder((e) => shuffle(e))} disabled={spinning || n < 2}>
              <Shuffle size={15} />
              Shuffle
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => reorder((e) => e.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })))}
              disabled={spinning || n < 2}
            >
              <SortAscending size={15} />
              Sort
            </button>
            <button type="button" className="btn ghost small" onClick={() => setText('')} disabled={spinning || !text}>
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="wh-result-slot" aria-live="polite">
        {result && (
          <div className="wh-result panel">
            <div className="wh-result-text">
              <span className="wh-result-label">Winner</span>
              <strong className="wh-winner" data-index={result.index} data-planned={result.planned}>
                {result.name}
              </strong>
            </div>
            <div className="wh-result-actions">
              <button type="button" className="btn" onClick={removeWinner}>
                <X size={15} />
                Remove winner
              </button>
              <button type="button" className="btn primary" onClick={spin}>
                <ArrowClockwise size={15} weight="bold" />
                Spin again
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="section" aria-labelledby="wh-lists-h">
        <div className="section-head">
          <h2 id="wh-lists-h">
            Saved lists <span className="count">{lists.length}</span>
          </h2>
        </div>
        <form
          className="wh-save"
          onSubmit={(e) => {
            e.preventDefault()
            if (n) saveList()
          }}
        >
          <input className="wh-input" value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Name this list" aria-label="List name" maxLength={60} />
          <button type="submit" className="btn" disabled={!n}>
            <FloppyDisk size={16} />
            Save current
          </button>
        </form>
        {lists.length > 0 ? (
          <ul className="wh-lists">
            {lists.map((l) => {
              const count = parseEntries(l.text, MAX_ENTRIES).length
              return (
                <li key={l.name}>
                  <button
                    type="button"
                    className="wh-list-load"
                    onClick={() => {
                      setText(l.text)
                      setResult(null)
                    }}
                    disabled={spinning}
                  >
                    <span className="wh-list-name">{l.name}</span>
                    <span className="wh-list-meta">
                      {count} {count === 1 ? 'entry' : 'entries'}
                    </span>
                  </button>
                  <button type="button" className="icon danger" onClick={() => setLists(lists.filter((x) => x.name !== l.name))} aria-label={`Delete ${l.name}`}>
                    <Trash size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="wh-empty">Save a list to reuse it later. Lists stay on this device.</p>
        )}
      </section>
    </>
  )
}

/* Coin */

function CoinFlip() {
  const [tally, setTally] = useStoredState('handybits:wheel:coin', { heads: 0, tails: 0 })
  const [rot, setRot] = useState(0)
  const [shown, setShown] = useState(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const reduced = reducedMotion()
  const duration = reduced ? 150 : 1300

  const flip = () => {
    if (busy) return
    const side = flipCoin()
    const base = Math.ceil(rot / 360) * 360 + (reduced ? 360 : 360 * 5)
    setRot(base + (side === 'tails' ? 180 : 0))
    setBusy(true)
    setShown(null)
    timer.current = setTimeout(() => {
      setShown(side)
      setBusy(false)
      setTally((t) => ({ ...t, [side]: t[side] + 1 }))
    }, duration)
  }
  const total = tally.heads + tally.tails

  return (
    <div className="panel wh-coin-panel">
      <button type="button" className="wh-coin-btn" onClick={flip} disabled={busy} aria-label="Flip the coin">
        <div className={`wh-coin${busy ? ' busy' : ''}`} style={{ transform: `rotateY(${rot}deg)`, transitionDuration: `${duration}ms` }}>
          <div className="wh-face heads">
            <span>H</span>
          </div>
          <div className="wh-face tails">
            <span>T</span>
          </div>
        </div>
      </button>
      <p className="wh-big" aria-live="polite">
        {shown ? (shown === 'heads' ? 'Heads' : 'Tails') : busy ? 'Flipping…' : 'Ready'}
      </p>
      <button type="button" className="btn primary wh-spin" onClick={flip} disabled={busy}>
        <Coin size={17} />
        Flip
      </button>
      <dl className="wh-tally">
        <div>
          <dt>Heads</dt>
          <dd>{tally.heads}</dd>
        </div>
        <div>
          <dt>Tails</dt>
          <dd>{tally.tails}</dd>
        </div>
        <div>
          <dt>Heads share</dt>
          <dd>{total ? `${Math.round((tally.heads / total) * 100)}%` : '–'}</dd>
        </div>
      </dl>
      {total > 0 && (
        <button type="button" className="btn ghost small" onClick={() => setTally({ heads: 0, tails: 0 })}>
          Reset tally
        </button>
      )}
    </div>
  )
}

/* Dice */

const SIDES = [4, 6, 8, 10, 12, 20]
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }

function Die({ value, sides }) {
  if (sides === 6) {
    return (
      <div className="wh-die d6" role="img" aria-label={String(value)}>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={PIPS[value].includes(i) ? 'pip' : undefined} />
        ))}
      </div>
    )
  }
  return (
    <div className={`wh-die num d${sides}`} role="img" aria-label={String(value)}>
      {value}
    </div>
  )
}

function Stepper({ label, value, min, max, onChange }) {
  return (
    <div className="wh-stepper" role="group" aria-label={label}>
      <button type="button" className="icon" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer`}>
        <Minus size={16} />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" className="icon" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More`}>
        <Plus size={16} />
      </button>
    </div>
  )
}

function Dice() {
  const [opts, setOpts] = useStoredState('handybits:wheel:dice', { count: 2, sides: 6 })
  const [roll, setRoll] = useState(null)
  const [shake, setShake] = useState(0)
  const go = () => {
    setRoll({ values: rollDice(opts.count, opts.sides), sides: opts.sides })
    setShake((s) => s + 1)
  }
  return (
    <div className="panel wh-dice-panel">
      <div className="wh-row">
        <div className="wh-field">
          <span className="field-label">Dice</span>
          <Stepper label="Number of dice" value={opts.count} min={1} max={10} onChange={(count) => setOpts({ ...opts, count })} />
        </div>
        <div className="wh-field">
          <span className="field-label" id="wh-sides-l">
            Sides
          </span>
          <div className="segmented wh-sides" role="radiogroup" aria-labelledby="wh-sides-l">
            {SIDES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={opts.sides === s} className={opts.sides === s ? 'on' : ''} onClick={() => setOpts({ ...opts, sides: s })}>
                d{s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="wh-dice-out" aria-live="polite">
        {roll ? (
          <>
            <div key={shake} className="wh-dice">
              {roll.values.map((v, i) => (
                <Die key={i} value={v} sides={roll.sides} />
              ))}
            </div>
            <p className="wh-big">
              {roll.values.length > 1 ? (
                <>
                  <span className="wh-big-label">Total</span> {roll.values.reduce((a, b) => a + b, 0)}
                </>
              ) : (
                roll.values[0]
              )}
            </p>
            {roll.values.length > 1 && <p className="wh-small">{roll.values.join(' + ')}</p>}
          </>
        ) : (
          <p className="wh-small">
            Roll {opts.count} d{opts.sides}.
          </p>
        )}
      </div>
      <button type="button" className="btn primary wh-spin" onClick={go}>
        <DiceFive size={17} />
        Roll
      </button>
    </div>
  )
}

/* Number */

function NumberPick() {
  const [opts, setOpts] = useStoredState('handybits:wheel:number', { min: '1', max: '100', count: 1, unique: true })
  const [out, setOut] = useState(null)
  const [error, setError] = useState('')
  const [copied, copy] = useCopy()
  const go = () => {
    const min = parseNumber(opts.min)
    const max = parseNumber(opts.max)
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      setError('Enter whole numbers for both ends.')
      setOut(null)
      return
    }
    try {
      setOut(pickNumbers(min, max, opts.count, opts.unique))
      setError('')
    } catch (e) {
      setError(e.message)
      setOut(null)
    }
  }
  return (
    <div className="panel wh-num-panel">
      <div className="wh-row">
        <div className="wh-field">
          <label className="field-label" htmlFor="wh-min">
            From
          </label>
          <input id="wh-min" className="wh-input num" inputMode="numeric" value={opts.min} onChange={(e) => setOpts({ ...opts, min: e.target.value })} />
        </div>
        <div className="wh-field">
          <label className="field-label" htmlFor="wh-max">
            To
          </label>
          <input id="wh-max" className="wh-input num" inputMode="numeric" value={opts.max} onChange={(e) => setOpts({ ...opts, max: e.target.value })} />
        </div>
        <div className="wh-field">
          <span className="field-label">How many</span>
          <Stepper label="How many numbers" value={opts.count} min={1} max={100} onChange={(count) => setOpts({ ...opts, count })} />
        </div>
      </div>
      <label className={`check wh-check${opts.unique ? ' on' : ''}`}>
        <input type="checkbox" checked={opts.unique} onChange={(e) => setOpts({ ...opts, unique: e.target.checked })} disabled={opts.count === 1} />
        No repeats
      </label>
      <div className="wh-num-out" aria-live="polite">
        {error ? (
          <p className="wh-error">{error}</p>
        ) : out ? (
          out.length === 1 ? (
            <p className="wh-big wh-huge">{out[0].toLocaleString()}</p>
          ) : (
            <ul className="wh-chips">
              {out.map((v, i) => (
                <li key={i}>{v.toLocaleString()}</li>
              ))}
            </ul>
          )
        ) : (
          <p className="wh-small">Both ends are included.</p>
        )}
      </div>
      <div className="wh-actions">
        <button type="button" className="btn primary wh-spin" onClick={go}>
          <Hash size={17} />
          Pick
        </button>
        {out && out.length > 1 && (
          <button type="button" className="btn" onClick={() => copy(out.join(', '), 'n')}>
            {copied === 'n' ? <Check size={15} weight="bold" /> : <Copy size={15} />}
            {copied === 'n' ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  )
}

/* Teams */

function Teams() {
  const [opts, setOpts] = useStoredState('handybits:wheel:teams', { text: 'Ada\nGrace\nLinus\nMargaret\nAlan\nKatherine\nDennis\nBarbara', mode: 'teams', n: 2 })
  const [teams, setTeams] = useState(null)
  const [copied, copy] = useCopy()
  const names = parseEntries(opts.text, 500)
  const asText = (t) => t.map((m, i) => `Team ${i + 1}: ${m.join(', ')}`).join('\n')
  return (
    <div className="wh-teams">
      <div className="panel">
        <div className="wh-entries-head">
          <label className="field-label" htmlFor="wh-team-names">
            Names
          </label>
          <span className="count">{names.length}</span>
        </div>
        <textarea id="wh-team-names" className="wh-textarea short" value={opts.text} onChange={(e) => setOpts({ ...opts, text: e.target.value })} placeholder="One name per line" spellCheck={false} />
        <div className="wh-row wh-team-opts">
          <div className="segmented" role="radiogroup" aria-label="Split by">
            {[
              ['teams', 'Number of teams'],
              ['size', 'People per team'],
            ].map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={opts.mode === k} className={opts.mode === k ? 'on' : ''} onClick={() => setOpts({ ...opts, mode: k })}>
                {label}
              </button>
            ))}
          </div>
          <Stepper label={opts.mode === 'teams' ? 'Number of teams' : 'People per team'} value={opts.n} min={opts.mode === 'teams' ? 2 : 1} max={50} onChange={(v) => setOpts({ ...opts, n: v })} />
          <button type="button" className="btn primary" onClick={() => setTeams(splitTeams(names, opts.mode, opts.n))} disabled={names.length < 2}>
            <Shuffle size={16} />
            Make teams
          </button>
        </div>
      </div>
      {teams && (
        <section className="section" aria-labelledby="wh-teams-h">
          <div className="section-head">
            <h2 id="wh-teams-h">
              Teams <span className="count">{teams.length}</span>
            </h2>
            <button type="button" className="btn ghost small" onClick={() => copy(asText(teams), 't')}>
              {copied === 't' ? <Check size={15} weight="bold" /> : <Copy size={15} />}
              {copied === 't' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ol className="wh-team-grid" aria-live="polite">
            {teams.map((t, i) => (
              <li key={i} className="wh-team">
                <h3>
                  Team {i + 1} <span>{t.length}</span>
                </h3>
                <ul>
                  {t.map((m, j) => (
                    <li key={j}>{m}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

export default function WheelPicker() {
  const [mode, setMode] = useStoredState('handybits:wheel:mode', 'wheel')
  const [sound, setSound] = useStoredState('handybits:wheel:sound', false)
  const current = MODES.some(([k]) => k === mode) ? mode : 'wheel'
  return (
    <div className="tool wh">
      <header className="header">
        <h1 className="title">Wheel & random picker</h1>
        <p className="lede">Spin a wheel of names, flip a coin, roll dice, pick numbers or split a group into teams.</p>
      </header>

      <div className="segmented wh-modes" role="radiogroup" aria-label="Picker">
        {MODES.map(([k, label, Icon]) => (
          <button key={k} type="button" role="radio" aria-checked={current === k} className={current === k ? 'on' : ''} onClick={() => setMode(k)}>
            <Icon size={16} weight={current === k ? 'fill' : 'regular'} />
            {label}
          </button>
        ))}
      </div>

      {current === 'wheel' && <Wheel sound={sound} setSound={setSound} />}
      {current === 'coin' && <CoinFlip />}
      {current === 'dice' && <Dice />}
      {current === 'number' && <NumberPick />}
      {current === 'teams' && <Teams />}

      <p className="footer">
        Results use your browser’s secure random generator, with every outcome equally likely. The wheel picks its winner before it starts turning;
        the spin just shows it. Entries and saved lists stay on this device.
      </p>
    </div>
  )
}
