import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { diffLines, diffWordsWithSpace } from 'diff'
import { ArrowsLeftRight, ArrowUp, Check, Copy, Trash } from '@phosphor-icons/react'
import * as T from '../lib/text-transform.js'
import { randomInt } from '../lib/password-gen.js'
import { nf, useCopy, useStoredState } from '../lib/text-hooks.js'
import './TextTools.css'

const GROUPS = [
  {
    title: 'Case',
    ops: [
      ['upper', 'UPPERCASE', (t) => t.toLocaleUpperCase()],
      ['lower', 'lowercase', (t) => t.toLocaleLowerCase()],
      ['title', 'Title Case', T.titleCase],
      ['sentence', 'Sentence case', T.sentenceCase],
      ['camel', 'camelCase', T.camelCase],
      ['snake', 'snake_case', T.snakeCase],
      ['kebab', 'kebab-case', T.kebabCase],
    ],
  },
  {
    title: 'Clean up',
    ops: [
      ['nobreaks', 'Remove line breaks', T.removeLineBreaks],
      ['spaces', 'Remove extra spaces', T.removeExtraSpaces],
      ['trim', 'Trim lines', T.trimLines],
      ['noempty', 'Remove empty lines', T.removeEmptyLines],
      ['dedupe', 'Remove duplicate lines', T.removeDuplicateLines],
      ['html', 'Strip HTML tags', T.stripHtml],
    ],
  },
  {
    title: 'Lines',
    ops: [
      ['az', 'Sort A → Z', T.sortAZ],
      ['za', 'Sort Z → A', T.sortZA],
      ['natural', 'Sort numbers naturally', T.sortNatural],
      ['reverse', 'Reverse order', T.reverseLines],
      ['shuffle', 'Shuffle', (t) => T.shuffleLines(t, randomInt)],
      ['number', 'Number lines', T.numberLines],
    ],
  },
]

const OPS = Object.fromEntries(GROUPS.flatMap((g) => g.ops.map(([id, label, fn]) => [id, { label, fn }])))

function lineCount(t) {
  return t ? t.split('\n').length : 0
}

export default function TextTools() {
  const [mode, setMode] = useStoredState('handybits:text:mode', 'transform')

  return (
    <div className="tool tt">
      <header className="header">
        <h1 className="title">Text tools</h1>
        <p className="lede">Change case, tidy up messy text, sort lines, or compare two versions side by side.</p>
      </header>

      <div className="segmented tt-mode" role="radiogroup" aria-label="Mode">
        {[
          ['transform', 'Transform'],
          ['compare', 'Compare'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={mode === key}
            className={mode === key ? 'on' : ''}
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'compare' ? <Compare /> : <Transform />}

      <p className="footer">Everything happens in your browser. Your text is saved on this device only, so it’s here when you come back.</p>
    </div>
  )
}

function Transform() {
  const [input, setInput] = useStoredState('handybits:text:input', '')
  const [result, setResult] = useState(null) // { op, text }
  const [copied, copy] = useCopy()
  const [status, setStatus] = useState('')
  const inputRef = useRef(null)

  function apply(id) {
    const out = OPS[id].fn(input)
    setResult({ op: id, text: out })
    setStatus(`${OPS[id].label} applied`)
  }

  function useAsInput() {
    setInput(result.text)
    setResult(null)
    setStatus('Output moved to input')
    inputRef.current?.focus()
  }

  async function doCopy() {
    const ok = await copy(result.text)
    setStatus(ok ? 'Output copied' : 'Copy was blocked by the browser')
  }

  return (
    <>
      <div className="tt-field">
        <div className="tt-field-head">
          <label className="field-label" htmlFor="tt-input">
            Input
          </label>
          <span className="tt-meta">
            {nf.format(input.length)} characters · {nf.format(lineCount(input))} lines
          </span>
          <button
            type="button"
            className="btn ghost small danger"
            onClick={() => {
              setInput('')
              setResult(null)
              setStatus('Input cleared')
            }}
            disabled={!input}
          >
            <Trash size={15} />
            Clear
          </button>
        </div>
        <textarea
          id="tt-input"
          ref={inputRef}
          className="tt-area"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste or type your text…"
          spellCheck="false"
        />
      </div>

      <div className="tt-groups">
        {GROUPS.map((g) => (
          <div key={g.title} className="tt-group" role="group" aria-labelledby={`tt-g-${g.title}`}>
            <h2 className="tt-group-title" id={`tt-g-${g.title}`}>
              {g.title}
            </h2>
            <div className="tt-ops">
              {g.ops.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn small tt-op${result?.op === id ? ' on' : ''}`}
                  onClick={() => apply(id)}
                  disabled={!input}
                  aria-pressed={result?.op === id}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="tt-field">
        <div className="tt-field-head">
          <label className="field-label" htmlFor="tt-output">
            Output
            {result && <span className="tt-applied"> · {OPS[result.op].label}</span>}
          </label>
          <span className="tt-meta">{result && `${nf.format(result.text.length)} characters · ${nf.format(lineCount(result.text))} lines`}</span>
          <div className="tt-out-actions">
            <button type="button" className="btn ghost small" onClick={useAsInput} disabled={!result}>
              <ArrowUp size={15} />
              Use as input
            </button>
            <button type="button" className="btn small" onClick={doCopy} disabled={!result}>
              {copied ? <Check size={15} weight="bold" /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <textarea
          id="tt-output"
          className="tt-area tt-output"
          value={result?.text ?? ''}
          readOnly
          placeholder="Pick an operation above to see the result here."
          spellCheck="false"
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </>
  )
}

function Compare() {
  const [a, setA] = useStoredState('handybits:text:a', '')
  const [b, setB] = useStoredState('handybits:text:b', '')
  const [by, setBy] = useStoredState('handybits:text:by', 'words')
  const da = useDeferredValue(a)
  const db = useDeferredValue(b)

  const { parts, added, removed } = useMemo(() => {
    if (!da && !db) return { parts: [], added: 0, removed: 0 }
    const nl = (t) => (t && !t.endsWith('\n') ? t + '\n' : t)
    const parts = by === 'lines' ? diffLines(nl(da), nl(db)) : diffWordsWithSpace(da, db)
    let added = 0
    let removed = 0
    for (const p of parts) {
      const n = by === 'lines' ? p.count : (p.value.match(/\S+/g) || []).length
      if (p.added) added += n
      if (p.removed) removed += n
    }
    return { parts, added, removed }
  }, [da, db, by])

  const unit = by === 'lines' ? 'line' : 'word'
  const plural = (n) => `${nf.format(n)} ${unit}${n === 1 ? '' : 's'}`
  const identical = (a || b) && a === b

  return (
    <>
      <div className="tt-compare">
        <div className="tt-field">
          <div className="tt-field-head">
            <label className="field-label" htmlFor="tt-a">
              Original
            </label>
          </div>
          <textarea id="tt-a" className="tt-area" value={a} onChange={(e) => setA(e.target.value)} placeholder="Paste the original text…" spellCheck="false" />
        </div>
        <div className="tt-field">
          <div className="tt-field-head">
            <label className="field-label" htmlFor="tt-b">
              Changed
            </label>
          </div>
          <textarea id="tt-b" className="tt-area" value={b} onChange={(e) => setB(e.target.value)} placeholder="Paste the changed text…" spellCheck="false" />
        </div>
      </div>

      <div className="tt-compare-bar">
        <div className="segmented" role="radiogroup" aria-label="Compare by">
          {[
            ['words', 'Words'],
            ['lines', 'Lines'],
          ].map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={by === key} className={by === key ? 'on' : ''} onClick={() => setBy(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="tt-compare-tools">
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setA(b)
              setB(a)
            }}
            disabled={!a && !b}
          >
            <ArrowsLeftRight size={15} />
            Swap
          </button>
          <button
            type="button"
            className="btn ghost small danger"
            onClick={() => {
              setA('')
              setB('')
            }}
            disabled={!a && !b}
          >
            <Trash size={15} />
            Clear
          </button>
        </div>
      </div>

      <section className="section tt-diff-section" aria-labelledby="tt-diff-h">
        <div className="section-head">
          <h2 id="tt-diff-h">Differences</h2>
          <p className="tt-counts" aria-live="polite">
            {parts.length > 0 && !identical && (
              <>
                <span className="tt-count-add">+{plural(added)}</span>
                <span className="tt-count-del">−{plural(removed)}</span>
              </>
            )}
            {identical && <span>No differences</span>}
          </p>
        </div>
        {!parts.length ? (
          <p className="tt-empty">Paste text into both boxes to see what changed. Additions are green, removals are struck through.</p>
        ) : by === 'lines' ? (
          <div className="tt-diff tt-diff-lines" role="table" aria-label="Line differences">
            {parts.flatMap((p, i) =>
              p.value
                .replace(/\n$/, '')
                .split('\n')
                .map((line, j) => (
                  <div key={`${i}-${j}`} role="row" className={`tt-line${p.added ? ' add' : p.removed ? ' del' : ''}`}>
                    <span role="cell" className="tt-gutter" aria-label={p.added ? 'added' : p.removed ? 'removed' : 'unchanged'}>
                      {p.added ? '+' : p.removed ? '−' : ''}
                    </span>
                    <span role="cell" className="tt-line-text">
                      {line || ' '}
                    </span>
                  </div>
                )),
            )}
          </div>
        ) : (
          <div className="tt-diff tt-diff-words">
            {parts.map((p, i) =>
              p.added ? (
                <ins key={i}>{p.value}</ins>
              ) : p.removed ? (
                <del key={i}>{p.value}</del>
              ) : (
                <span key={i}>{p.value}</span>
              ),
            )}
          </div>
        )}
      </section>
    </>
  )
}
