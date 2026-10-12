import { useEffect, useState } from 'react'
import { ArrowsClockwise, Check, Copy, Key, TextAa } from '@phosphor-icons/react'
import {
  CLASSES,
  crackTime,
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  passwordEntropy,
  strength,
} from '../lib/password-gen.js'
import { useCopy, useStoredState } from '../lib/text-hooks.js'
import './Passwords.css'

const MODES = {
  password: { label: 'Password', icon: Key },
  passphrase: { label: 'Passphrase', icon: TextAa },
}

const SEPARATORS = [
  ['-', 'Hyphen', '-'],
  [' ', 'Space', '␣'],
  ['.', 'Period', '.'],
  ['_', 'Underscore', '_'],
  ['', 'None', 'none'],
]

const DEFAULTS = {
  mode: 'password',
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidSimilar: false,
  words: 5,
  separator: '-',
  capitalise: true,
  number: false,
}

let wordsPromise = null
const loadWords = () => (wordsPromise ||= import('../lib/password-words.js').then((m) => m.default))

function Colored({ value, mode }) {
  if (mode === 'passphrase') return value
  return [...value].map((ch, i) => (
    <span key={i} className={/[0-9]/.test(ch) ? 'pw-d' : /[A-Za-z]/.test(ch) ? undefined : 'pw-s'}>
      {ch}
    </span>
  ))
}

function make(o, list) {
  if (o.mode === 'passphrase') return list ? generatePassphrase(o, list) : ''
  return generatePassword(o)
}

export default function Passwords() {
  const [stored, setStored] = useStoredState('handybits:passwords:settings', DEFAULTS)
  const opts = { ...DEFAULTS, ...stored }
  const [initial] = useState(opts)
  const [list, setList] = useState(null)
  const [value, setValue] = useState(() => make(initial, null))
  const [history, setHistory] = useState([])
  const [copied, copy] = useCopy()
  const [status, setStatus] = useState('')

  const isPhrase = opts.mode === 'passphrase'

  // The wordlist is only fetched when a passphrase is first needed.
  useEffect(() => {
    if (initial.mode !== 'passphrase') return
    let alive = true
    loadWords().then((l) => {
      if (!alive) return
      setList(l)
      setValue(make(initial, l))
    })
    return () => {
      alive = false
    }
  }, [initial])

  // Changing a setting saves it and makes a fresh value.
  async function set(patch) {
    const next = { ...opts, ...patch }
    setStored(next)
    let l = list
    if (next.mode === 'passphrase' && !l) {
      l = await loadWords()
      setList(l)
    }
    setValue(make(next, l))
  }

  const remember = (v) => v && setHistory((h) => [v, ...h.filter((x) => x !== v)].slice(0, 5))

  function regenerate() {
    remember(value)
    setValue(make(opts, list))
    setStatus(`New ${isPhrase ? 'passphrase' : 'password'} generated`)
  }

  async function doCopy(v = value, id = 'main') {
    const ok = await copy(v, id)
    if (ok && v === value) remember(v)
    setStatus(ok ? 'Copied to clipboard' : 'Copy was blocked by the browser')
  }

  const bits = isPhrase ? (list ? passphraseEntropy(opts, list.length) : 0) : passwordEntropy(opts)
  const level = strength(bits)
  const classCount = Object.keys(CLASSES).filter((k) => opts[k]).length

  return (
    <div className="tool pw">
      <header className="header">
        <h1 className="title">Password generator</h1>
        <p className="lede">Strong random passwords and easy-to-type passphrases, generated on your device.</p>
      </header>

      <div className="choice pw-modes" role="radiogroup" aria-label="Type">
        {Object.entries(MODES).map(([key, m]) => {
          const Icon = m.icon
          const on = opts.mode === key
          return (
            <button key={key} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => set({ mode: key })}>
              <Icon size={17} weight={on ? 'fill' : 'regular'} />
              {m.label}
            </button>
          )
        })}
      </div>

      <div className="pw-result panel">
        <div
          className={`pw-value${isPhrase ? ' phrase' : ''}`}
          tabIndex={0}
          role="button"
          aria-label={`${isPhrase ? 'Passphrase' : 'Password'}: ${value}. Press Space or Enter for a new one.`}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              regenerate()
            }
          }}
        >
          {value ? <Colored value={value} mode={opts.mode} /> : <span className="pw-loading">Loading words…</span>}
        </div>
        <div className="pw-result-bar">
          <div className={`pw-meter l${level.level}`} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <p className="pw-strength">
            <strong>{level.label}</strong>
            <span className="pw-bits">{Math.round(bits)} bits</span>
          </p>
          <div className="pw-buttons">
            <button type="button" className="btn" onClick={regenerate} disabled={!value} aria-label="Generate a new one">
              <ArrowsClockwise size={16} />
              <span className="pw-btn-text">New</span>
            </button>
            <button type="button" className="btn primary" onClick={() => doCopy()} disabled={!value}>
              {copied === 'main' ? <Check size={16} weight="bold" /> : <Copy size={16} />}
              {copied === 'main' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <p className="pw-crack">
          Time to crack at ten billion guesses a second: <strong>{crackTime(bits).toLowerCase()}</strong>
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      <section className="section" aria-labelledby="pw-opt-h">
        <div className="section-head">
          <h2 id="pw-opt-h">Options</h2>
          <button type="button" className="btn ghost small" onClick={() => set({ ...DEFAULTS, mode: opts.mode })}>
            Reset
          </button>
        </div>
        <div className="pw-options panel">
          {!isPhrase ? (
            <>
              <Slider id="pw-length" label="Length" min={8} max={64} value={opts.length} onChange={(v) => set({ length: v })} unit="characters" />
              <fieldset className="pw-fieldset">
                <legend className="field-label">Include</legend>
                <div className="pw-checks">
                  {Object.entries(CLASSES).map(([key, c]) => {
                    const lastOne = opts[key] && classCount === 1
                    return (
                      <label key={key} className={`check${opts[key] ? ' on' : ''}`} title={lastOne ? 'Keep at least one' : undefined}>
                        <input type="checkbox" checked={opts[key]} disabled={lastOne} onChange={(e) => set({ [key]: e.target.checked })} />
                        {c.label}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              <label className={`check pw-wide${opts.avoidSimilar ? ' on' : ''}`}>
                <input type="checkbox" checked={opts.avoidSimilar} onChange={(e) => set({ avoidSimilar: e.target.checked })} />
                Avoid look-alikes
                <span className="pw-hint">
                  <code>I l 1 O 0 o</code>
                </span>
              </label>
              <p className="pw-note">Every password includes at least one character from each type you pick.</p>
            </>
          ) : (
            <>
              <Slider id="pw-words" label="Words" min={3} max={10} value={opts.words} onChange={(v) => set({ words: v })} unit="words" />
              <div className="pw-fieldset">
                <span className="field-label" id="pw-sep-label">
                  Separator
                </span>
                <div className="segmented pw-seps" role="radiogroup" aria-labelledby="pw-sep-label">
                  {SEPARATORS.map(([sep, name, shown]) => (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={opts.separator === sep}
                      aria-label={name}
                      title={name}
                      className={opts.separator === sep ? 'on' : ''}
                      onClick={() => set({ separator: sep })}
                    >
                      <span className={sep ? 'pw-sep-glyph' : undefined}>{shown}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="pw-checks">
                <label className={`check${opts.capitalise ? ' on' : ''}`}>
                  <input type="checkbox" checked={opts.capitalise} onChange={(e) => set({ capitalise: e.target.checked })} />
                  Capitalise words
                </label>
                <label className={`check${opts.number ? ' on' : ''}`}>
                  <input type="checkbox" checked={opts.number} onChange={(e) => set({ number: e.target.checked })} />
                  Add a number
                </label>
              </div>
              <p className="pw-note">
                Words are picked at random from a list of {list ? list.length.toLocaleString() : '2,000+'} common English words. Strength is
                worked out from the list size, so it holds even if someone knows the list.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="pw-hist-h">
        <div className="section-head">
          <h2 id="pw-hist-h">
            Recent <span className="count">{history.length}</span>
          </h2>
          {history.length > 0 && (
            <button type="button" className="btn ghost small" onClick={() => setHistory([])}>
              Forget
            </button>
          )}
        </div>
        {history.length ? (
          <ul className="pw-history">
            {history.map((h) => (
              <li key={h}>
                <code className="pw-hist-value">{h}</code>
                <button type="button" className="btn ghost small" onClick={() => doCopy(h, h)} aria-label={`Copy ${h}`}>
                  {copied === h ? <Check size={15} weight="bold" /> : <Copy size={15} />}
                  {copied === h ? 'Copied' : 'Copy'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pw-empty">The last five you copy or replace show up here.</p>
        )}
        <p className="pw-note pw-privacy">Kept in memory only. Never saved, and gone when you leave or reload this page.</p>
      </section>

      <p className="footer">
        Generated with your browser’s secure random number generator. Nothing is sent anywhere. Only your settings are saved on this device.
      </p>
    </div>
  )
}

function Slider({ id, label, min, max, value, onChange, unit }) {
  return (
    <div className="pw-slider">
      <div className="pw-slider-head">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <span className="pw-slider-value" aria-hidden="true">
          {value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value} ${unit}`}
        style={{ '--pct': `${((value - min) / (max - min)) * 100}%` }}
      />
      <div className="pw-slider-scale" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
