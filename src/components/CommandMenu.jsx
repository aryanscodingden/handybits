import { useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { TOOLS, preload } from '../tools/index.js'

function matches(t, q) {
  const hay = `${t.label} ${t.hint} ${t.group} ${t.keywords}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

// ⌘K / Ctrl+K: type to find a tool, arrows to move, Enter to open.
// Mounted only while open, so every opening starts with a fresh query.
export default function CommandMenu({ onClose }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef(null)
  const results = useMemo(() => TOOLS.filter((t) => matches(t, query)), [query])

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function go(t) {
    if (!t) return
    window.location.hash = `#/${t.id}`
    onClose()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[index])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="cmd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Find a tool">
        <div className="cmd-input-wrap">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <input
            className="cmd-input"
            autoFocus
            placeholder="Find a tool…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="cmd-list" id="cmd-list" role="listbox" ref={list}>
          {results.map((t, i) => {
            const Icon = t.icon
            return (
              <li
                key={t.id}
                id={`cmd-${t.id}`}
                role="option"
                aria-selected={i === index}
                className={i === index ? 'on' : ''}
                onMouseMove={() => i !== index && setIndex(i)}
                onMouseEnter={() => preload(t)}
                onClick={() => go(t)}
              >
                <span className="nav-icon">
                  <Icon size={17} />
                </span>
                <span className="cmd-text">
                  <span className="nav-title">{t.label}</span>
                  <span className="nav-hint">{t.hint}</span>
                </span>
                <span className="cmd-group">{t.group}</span>
              </li>
            )
          })}
          {!results.length && <li className="cmd-empty">No tools match “{query}”.</li>}
        </ul>
      </div>
    </div>
  )
}
