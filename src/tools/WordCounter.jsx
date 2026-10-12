import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, Check, ClipboardText, Copy, Trash } from '@phosphor-icons/react'
import { formatDuration, keywords, stats } from '../lib/text-stats.js'
import { nf, useAutosize, useCopy, useStoredState } from '../lib/text-hooks.js'
import './WordCounter.css'

const UNITS = {
  none: { label: 'No limit' },
  chars: { label: 'Characters', preset: 280 },
  words: { label: 'Words', preset: 500 },
}

export default function WordCounter() {
  const [text, setText] = useStoredState('handybits:words:text', '')
  const [limit, setLimit] = useStoredState('handybits:words:limit', { unit: 'none', value: 280 })
  const [phrases, setPhrases] = useStoredState('handybits:words:phrases', false)
  const [undo, setUndo] = useState(null)
  const [copied, copy] = useCopy()
  const [status, setStatus] = useState('')
  const area = useRef(null)
  useAutosize(area, text, 720)

  // Stats on long documents shouldn't make typing lag.
  const deferred = useDeferredValue(text)
  const s = useMemo(() => stats(deferred), [deferred])
  const top = useMemo(() => keywords(deferred, { phrases, limit: 8 }), [deferred, phrases])

  useEffect(() => {
    if (!undo) return
    const id = setTimeout(() => setUndo(null), 6000)
    return () => clearTimeout(id)
  }, [undo])

  async function paste() {
    try {
      const clip = await navigator.clipboard.readText()
      const el = area.current
      const start = el?.selectionStart ?? text.length
      const end = el?.selectionEnd ?? text.length
      setText(text.slice(0, start) + clip + text.slice(end))
      setStatus('Pasted from clipboard')
    } catch {
      area.current?.focus()
      setStatus('Clipboard access was blocked. Press Ctrl+V or ⌘V to paste.')
    }
  }

  async function doCopy() {
    const ok = await copy(text)
    setStatus(ok ? 'Copied to clipboard' : 'Copy was blocked by the browser')
  }

  function clear() {
    setUndo(text)
    setText('')
    setStatus('Text cleared')
    area.current?.focus()
  }

  function restore() {
    setText(undo)
    setUndo(null)
    setStatus('Text restored')
  }

  const used = limit.unit === 'chars' ? s.chars : s.words
  const max = Math.max(1, Number(limit.value) || 0)
  const over = limit.unit !== 'none' && used > max
  const pct = Math.min(100, (used / max) * 100)

  const STATS = [
    ['Words', nf.format(s.words)],
    ['Characters', nf.format(s.chars)],
    ['Without spaces', nf.format(s.noSpaces)],
    ['Sentences', nf.format(s.sentences)],
    ['Paragraphs', nf.format(s.paragraphs)],
    ['Words per sentence', s.sentences ? (s.words / s.sentences).toFixed(1) : '0'],
    ['Reading time', formatDuration(s.readingMin)],
    ['Speaking time', formatDuration(s.speakingMin)],
  ]

  return (
    <div className="tool wc">
      <header className="header">
        <h1 className="title">Word counter</h1>
        <p className="lede">Count words, characters and sentences as you type, and see how long it takes to read aloud.</p>
      </header>

      <div className="wc-editor panel">
        <label htmlFor="wc-text" className="sr-only">
          Your text
        </label>
        <textarea
          id="wc-text"
          ref={area}
          className="wc-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Start typing or paste your text here…"
          spellCheck="true"
          autoFocus
        />
        <div className="wc-bar">
          <span className="wc-live" aria-hidden="true">
            {nf.format(s.words)} {s.words === 1 ? 'word' : 'words'} · {nf.format(s.chars)} characters
          </span>
          <div className="wc-actions">
            {navigator.clipboard?.readText && (
              <button type="button" className="btn ghost small" onClick={paste}>
                <ClipboardText size={15} />
                Paste
              </button>
            )}
            <button type="button" className="btn ghost small" onClick={doCopy} disabled={!text}>
              {copied ? <Check size={15} weight="bold" /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {undo !== null && !text ? (
              <button type="button" className="btn ghost small" onClick={restore}>
                <ArrowCounterClockwise size={15} />
                Undo
              </button>
            ) : (
              <button type="button" className="btn ghost small danger" onClick={clear} disabled={!text}>
                <Trash size={15} />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      <dl className="wc-stats" aria-label="Text statistics">
        {STATS.map(([label, value]) => (
          <div key={label} className="wc-stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section className="section" aria-labelledby="wc-limit-h">
        <div className="section-head">
          <h2 id="wc-limit-h">Limit</h2>
        </div>
        <div className="wc-limit panel">
          <div className="wc-limit-row">
            <div className="segmented" role="radiogroup" aria-label="Limit by">
              {Object.entries(UNITS).map(([key, u]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={limit.unit === key}
                  className={limit.unit === key ? 'on' : ''}
                  onClick={() =>
                    setLimit((l) => ({ unit: key, value: key === l.unit || key === 'none' ? l.value : u.preset }))
                  }
                >
                  {u.label}
                </button>
              ))}
            </div>
            {limit.unit !== 'none' && (
              <label className="wc-target">
                <span className="field-label">Target</span>
                <input
                  className="wc-number"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={limit.value}
                  onChange={(e) => setLimit((l) => ({ ...l, value: e.target.value }))}
                />
              </label>
            )}
          </div>
          {limit.unit !== 'none' && (
            <div className="wc-progress-wrap">
              <div
                className={`wc-progress${over ? ' over' : ''}`}
                role="progressbar"
                aria-label={`${UNITS[limit.unit].label} used`}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={Math.min(used, max)}
              >
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className={`wc-progress-text${over ? ' over' : ''}`} aria-live="polite">
                <span>
                  {nf.format(used)} / {nf.format(max)}
                </span>
                <span>{over ? `${nf.format(used - max)} over` : `${nf.format(max - used)} left`}</span>
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="wc-kw-h">
        <div className="section-head">
          <h2 id="wc-kw-h">Top keywords</h2>
          <div className="segmented" role="radiogroup" aria-label="Keyword type">
            <button type="button" role="radio" aria-checked={!phrases} className={!phrases ? 'on' : ''} onClick={() => setPhrases(false)}>
              Words
            </button>
            <button type="button" role="radio" aria-checked={phrases} className={phrases ? 'on' : ''} onClick={() => setPhrases(true)}>
              2-word phrases
            </button>
          </div>
        </div>
        {top.length ? (
          <ol className="wc-keywords">
            {top.map((k) => (
              <li key={k.term}>
                <span className="wc-term">{k.term}</span>
                <span className="wc-kbar" aria-hidden="true">
                  <span style={{ width: `${(k.count / top[0].count) * 100}%` }} />
                </span>
                <span className="wc-kcount">{k.count}×</span>
                <span className="wc-kpct">{k.pct.toFixed(1)}%</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="wc-empty">
            {phrases
              ? 'Phrases that appear more than once will show up here.'
              : 'The words you use most will show up here. Common words like “the” and “and” are left out.'}
          </p>
        )}
      </section>

      <p className="footer">
        Your text stays in this browser and is saved on this device so it’s here when you come back. Reading time assumes 238 words a
        minute, speaking time 150.
      </p>
    </div>
  )
}
