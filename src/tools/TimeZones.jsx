import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ClockCounterClockwise, Copy, MagnifyingGlass, X } from '@phosphor-icons/react'
import {
  abbreviation,
  allZones,
  cityName,
  dayColumns,
  dayDiff,
  defaultZones,
  formatOffset,
  hourKind,
  isValidZone,
  offsetMinutes,
  regionName,
  searchZones,
  wallParts,
  zonedToUtc,
} from '../lib/tz-math.js'
import { useCopy, useStoredState } from '../lib/text-hooks.js'
import './TimeZones.css'

const fmtCache = new Map()
function fmt(tz, opts) {
  const k = tz + JSON.stringify(opts)
  let f = fmtCache.get(k)
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts })
    fmtCache.set(k, f)
  }
  return f
}

const timeOf = (ms, tz) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(ms)
const dateOf = (ms, tz) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(ms)
const weekdayOf = (ms, tz) => fmt(tz, { weekday: 'short' }).format(ms)

const pad = (n) => String(n).padStart(2, '0')

function relOffset(mins) {
  if (mins === 0) return 'Same time'
  const sign = mins > 0 ? '+' : '−'
  const a = Math.abs(mins)
  const h = Math.floor(a / 60)
  const m = a % 60
  return `${sign}${h}${m ? `:${pad(m)}` : ''} h`
}

function dayLabel(diff) {
  if (diff === 1) return 'Next day'
  if (diff === -1) return 'Previous day'
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} days`
}

export default function TimeZones() {
  const [stored, setZones] = useStoredState('handybits:timezones:zones', () => defaultZones())
  const zones = useMemo(() => {
    const valid = (Array.isArray(stored) ? stored : []).filter(isValidZone)
    return valid.length ? valid : defaultZones()
  }, [stored])
  const ref = zones[0]

  const [instant, setInstant] = useState(() => Date.now())
  const [live, setLive] = useState(true)
  const [copied, copy] = useCopy()
  const [status, setStatus] = useState('')

  // Follow the clock until the user picks a time.
  useEffect(() => {
    if (!live) return
    const tick = () => setInstant(Date.now())
    tick()
    const id = setInterval(tick, 15000)
    return () => clearInterval(id)
  }, [live])

  function pick(ms) {
    setLive(false)
    setInstant(ms)
  }

  const refWall = wallParts(instant, ref)
  const dateValue = `${refWall.year}-${pad(refWall.month)}-${pad(refWall.day)}`
  const timeValue = `${pad(refWall.hour)}:${pad(refWall.minute)}`

  function onDate(v) {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return
    pick(zonedToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: refWall.hour, minute: refWall.minute }, ref))
  }

  function onTime(v) {
    const m = v.match(/^(\d{2}):(\d{2})/)
    if (!m) return
    pick(zonedToUtc({ year: refWall.year, month: refWall.month, day: refWall.day, hour: +m[1], minute: +m[2] }, ref))
  }

  function move(i, dir) {
    const next = [...zones]
    const j = i + dir
    ;[next[i], next[j]] = [next[j], next[i]]
    setZones(next)
    setStatus(`${cityName(zones[i])} moved ${dir < 0 ? 'up' : 'down'}${j === 0 ? ', now the reference' : ''}`)
  }

  function remove(i) {
    setStatus(`${cityName(zones[i])} removed`)
    setZones(zones.filter((_, k) => k !== i))
  }

  function add(tz) {
    setZones([...zones, tz])
    setStatus(`${cityName(tz)} added`)
  }

  function summary() {
    return zones
      .map((tz, i) => {
        const w = wallParts(instant, tz)
        const showDay = i === 0 || dayDiff(w, refWall) !== 0
        return `${showDay ? weekdayOf(instant, tz) + ' ' : ''}${timeOf(instant, tz)} ${cityName(tz)}`
      })
      .join(' · ')
  }

  async function doCopy() {
    const ok = await copy(summary())
    setStatus(ok ? 'Summary copied' : 'Copy was blocked by the browser')
  }

  return (
    <div className="tool tz">
      <header className="header">
        <h1 className="title">Time zones</h1>
        <p className="lede">See one moment across the world, and find an hour that works for everyone.</p>
      </header>

      <div className="tz-when panel">
        <div className="tz-when-fields">
          <label className="tz-field">
            <span className="field-label">Date</span>
            <input type="date" className="tz-input" value={dateValue} onChange={(e) => onDate(e.target.value)} required />
          </label>
          <label className="tz-field">
            <span className="field-label">Time</span>
            <input type="time" className="tz-input" value={timeValue} onChange={(e) => onTime(e.target.value)} required />
          </label>
          <span className="tz-in">
            in <strong>{cityName(ref)}</strong>
          </span>
        </div>
        <div className="tz-when-actions">
          <button
            type="button"
            className={`btn small${live ? ' tz-live' : ''}`}
            onClick={() => {
              setLive(true)
              setStatus('Showing the current time')
            }}
            aria-pressed={live}
          >
            <ClockCounterClockwise size={15} />
            {live ? 'Now' : 'Back to now'}
          </button>
          <button type="button" className="btn small" onClick={doCopy}>
            {copied ? <Check size={15} weight="bold" /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      <ol className="tz-list" aria-label="Time zones">
        {zones.map((tz, i) => {
          const w = wallParts(instant, tz)
          const off = offsetMinutes(tz, instant)
          const diff = dayDiff(w, refWall)
          const abbr = abbreviation(tz, instant)
          const offText = formatOffset(off)
          return (
            <li key={tz} className={`tz-row${i === 0 ? ' ref' : ''}`}>
              <div className="tz-place">
                <span className="tz-city">
                  {cityName(tz)}
                  {i === 0 && <span className="tz-ref-tag">Reference</span>}
                </span>
                <span className="tz-sub">
                  {abbr && !/^(GMT|UTC)/.test(abbr) ? `${abbr} · ` : ''}
                  {offText}
                  {i > 0 && <> · {relOffset(off - offsetMinutes(ref, instant))}</>}
                </span>
              </div>
              <div className="tz-clock">
                <span className="tz-time">{timeOf(instant, tz)}</span>
                <span className={`tz-date${diff ? ' shifted' : ''}`}>
                  {dateOf(instant, tz)}
                  {diff !== 0 && <span className="tz-daytag">{dayLabel(diff)}</span>}
                </span>
              </div>
              <div className="tz-row-actions">
                <button type="button" className="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${cityName(tz)} up`}>
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  className="icon"
                  onClick={() => move(i, 1)}
                  disabled={i === zones.length - 1}
                  aria-label={`Move ${cityName(tz)} down`}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  className="icon danger"
                  onClick={() => remove(i)}
                  disabled={zones.length === 1}
                  aria-label={`Remove ${cityName(tz)}`}
                >
                  <X size={16} />
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      <ZoneSearch exclude={zones} onAdd={add} />

      <Planner zones={zones} instant={instant} onPick={pick} />

      <p className="footer">
        Uses your browser’s built-in time zone rules, so daylight saving and half-hour offsets are handled. Your list of zones is saved on
        this device.
      </p>
    </div>
  )
}

function ZoneSearch({ exclude, onAdd }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const listId = useId()
  const zonesAll = useMemo(() => allZones(), [])
  const matches = useMemo(() => searchZones(q, zonesAll), [q, zonesAll])
  const results = useMemo(() => matches.filter((z) => !exclude.includes(z)).slice(0, 8), [matches, exclude])
  const already = matches.find((z) => exclude.includes(z))
  const [now, setNow] = useState(() => Date.now())
  const show = open && q.trim() !== ''

  function choose(tz) {
    onAdd(tz)
    setQ('')
    setActive(0)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (results[active]) {
        e.preventDefault()
        choose(results[active])
      }
    } else if (e.key === 'Escape') {
      if (q) setQ('')
      setOpen(false)
    }
  }

  return (
    <div className="tz-search">
      <label className="sr-only" htmlFor="tz-add">
        Add a city or time zone
      </label>
      <div className="input-wrap">
        <MagnifyingGlass className="input-icon" size={18} aria-hidden="true" />
        <input
          id="tz-add"
          className="input tz-search-input"
          type="text"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && results[active] ? `${listId}-${active}` : undefined}
          placeholder="Add a city or time zone…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            setNow(Date.now())
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck="false"
        />
      </div>
      {show && (
        <ul className="tz-suggest" id={listId} role="listbox" aria-label="Matching time zones">
          {results.length ? (
            results.map((tz, i) => (
              <li
                key={tz}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(tz)}
              >
                <span className="tz-sug-main">
                  <span className="tz-sug-city">{cityName(tz)}</span>
                  <span className="tz-sug-region">{regionName(tz) || tz}</span>
                </span>
                <span className="tz-sug-meta">
                  <span className="tz-sug-time">{timeOf(now, tz)}</span>
                  <span className="tz-sug-off">{formatOffset(offsetMinutes(tz, now))}</span>
                </span>
              </li>
            ))
          ) : (
            <li className="tz-sug-empty" role="option" aria-selected="false" aria-disabled="true">
              {already ? `${cityName(already)} is already in your list` : `No time zone matches “${q.trim()}”`}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function Planner({ zones, instant, onPick }) {
  const ref = zones[0]
  const cols = useMemo(() => dayColumns(ref, instant), [ref, instant])
  const idx = Math.floor((instant - cols[0]) / 3600000)
  const sel = idx >= 0 && idx < 24 ? idx : -1
  const scroller = useRef(null)

  // On narrow screens the strip scrolls; keep the chosen hour in view.
  useEffect(() => {
    const box = scroller.current
    const hl = box?.querySelector('.tz-col-hl')
    if (!box || !hl || box.scrollWidth <= box.clientWidth) return
    const label = box.querySelector('.tz-strip-label')?.offsetWidth || 0
    const target = hl.offsetLeft - label - (box.clientWidth - label) / 2 + hl.offsetWidth / 2
    box.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [sel, zones.length])

  function onKeyDown(e) {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    const next = Math.max(0, Math.min(23, (sel < 0 ? 0 : sel) + step))
    onPick(cols[next])
  }

  const selText =
    sel >= 0 ? zones.map((tz) => `${timeOf(cols[sel], tz)} ${cityName(tz)}`).join(', ') : 'No hour selected'

  return (
    <section className="section" aria-labelledby="tz-plan-h">
      <div className="section-head">
        <h2 id="tz-plan-h">Meeting planner</h2>
        <ul className="tz-legend" aria-label="Legend">
          <li>
            <span className="tz-swatch work" /> Working hours
          </li>
          <li>
            <span className="tz-swatch edge" /> Early or evening
          </li>
          <li>
            <span className="tz-swatch night" /> Night
          </li>
        </ul>
      </div>
      <div className="tz-plan" ref={scroller}>
        <div
          className="tz-grid"
          style={{ '--rows': zones.length }}
          role="slider"
          tabIndex={0}
          aria-label={`Hour on ${dateOf(instant, ref)} in ${cityName(ref)}`}
          aria-valuemin={0}
          aria-valuemax={23}
          aria-valuenow={sel < 0 ? 0 : sel}
          aria-valuetext={selText}
          onKeyDown={onKeyDown}
        >
          {zones.map((tz, r) => (
            <div key={tz} className="tz-strip" style={{ gridRow: r + 1 }}>
              <span className="tz-strip-label" title={tz}>
                {cityName(tz)}
                {/* Half-hour zones: say so once per row instead of in every cell. */}
                {wallParts(cols[0], tz).minute ? <span className="tz-strip-min">:{pad(wallParts(cols[0], tz).minute)}</span> : null}
              </span>
              {cols.map((ms, c) => {
                const w = wallParts(ms, tz)
                return (
                  <span
                    key={c}
                    className={`tz-cell ${hourKind(w.hour, w.minute)}${c === sel ? ' sel' : ''}${w.hour === 0 ? ' day-start' : ''}`}
                    onClick={() => onPick(ms)}
                    aria-hidden="true"
                  >
                    {w.hour === 0 ? (
                      <span className="tz-cell-day">{weekdayOf(ms, tz)}</span>
                    ) : (
                      w.hour
                    )}
                  </span>
                )
              })}
            </div>
          ))}
          {sel >= 0 && <span className="tz-col-hl" style={{ gridColumn: sel + 2 }} aria-hidden="true" />}
        </div>
      </div>
      <p className="tz-plan-hint">Click an hour, or focus the planner and use the arrow keys, to set the time for every zone.</p>
    </section>
  )
}
