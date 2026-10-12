import { Component, Suspense, useEffect, useState } from 'react'
import { CaretDown, House, LockSimple, MagnifyingGlass } from '@phosphor-icons/react'
import { Analytics } from '@vercel/analytics/react'
import { GROUPS, TOOLS, findTool, markRecent, preload } from './tools/index.js'
import Home from './components/Home.jsx'
import CommandMenu from './components/CommandMenu.jsx'

const NAV_KEY = 'handybits:nav'

function readFolded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NAV_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

// `null` is the home screen.
function currentTool() {
  return findTool(window.location.hash.replace(/^#\/?/, ''))
}

function ToolSkeleton() {
  return (
    <div className="tool" aria-busy="true" aria-label="Loading tool">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-block" />
    </div>
  )
}

// A tool whose code fails to load (e.g. after a deploy, or offline) shouldn't
// take the whole app down with it.
class ToolBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="tool">
        <header className="header">
          <h1 className="title">This tool didn’t load</h1>
          <p className="lede">Check your connection and reload the page.</p>
        </header>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

export default function App() {
  const [tool, setTool] = useState(currentTool)
  const [menuOpen, setMenuOpen] = useState(false)
  const [folded, setFolded] = useState(readFolded)
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)

  useEffect(() => {
    const onHash = () => {
      setTool(currentTool())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setMenuOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = tool ? `${tool.label} · Handybits` : 'Handybits: small tools for everyday files'
    if (tool) markRecent(tool.id)
  }, [tool])

  const Tool = tool?.component

  function toggleGroup(g) {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      try {
        localStorage.setItem(NAV_KEY, JSON.stringify([...next]))
      } catch {
        // Fold state is a nicety; ignore unavailable storage.
      }
      return next
    })
  }

  return (
    <>
      <div className="shell">
        <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
          Skip to content
        </a>
        <aside className="sidebar">
        <a className="logo" href="#/">
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M7 4v16M17 4v16M7 12h10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="logo-text">Handybits</span>
        </a>

        <button type="button" className="search-btn" onClick={() => setMenuOpen(true)}>
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span>Find a tool</span>
          <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <nav className="nav" aria-label="Tools">
          <a href="#/" className={`nav-item nav-home${!tool ? ' active' : ''}`} aria-current={!tool ? 'page' : undefined}>
            <span className="nav-icon">
              <House size={18} weight={!tool ? 'fill' : 'regular'} />
            </span>
            <span className="nav-text">
              <span className="nav-title">All tools</span>
            </span>
          </a>
          {GROUPS.map((g) => {
            // The group holding the open tool always stays unfolded.
            const open = !folded.has(g) || tool?.group === g
            return (
              <div className={`nav-group${open ? '' : ' folded'}`} key={g}>
                <button
                  type="button"
                  className="nav-label"
                  aria-expanded={open}
                  aria-controls={`nav-${g}`}
                  onClick={() => toggleGroup(g)}
                >
                  {g}
                  <CaretDown className="nav-caret" size={11} weight="bold" aria-hidden="true" />
                </button>
                <div className="nav-group-items" id={`nav-${g}`} hidden={!open}>
                  {TOOLS.filter((t) => t.group === g).map((t) => {
                    const active = t.id === tool?.id
                    const Icon = t.icon
                    return (
                      <a
                        key={t.id}
                        href={`#/${t.id}`}
                        className={`nav-item${active ? ' active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onMouseEnter={() => preload(t)}
                        onFocus={() => preload(t)}
                      >
                        <span className="nav-icon">
                          <Icon size={18} weight={active ? 'fill' : 'regular'} />
                        </span>
                        <span className="nav-text">
                          <span className="nav-title">{t.label}</span>
                        </span>
                      </a>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        <p className="sidebar-note">
          <LockSimple size={14} weight="bold" />
          No accounts, no tracking.
        </p>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <ToolBoundary key={tool?.id || 'home'}>
          <Suspense fallback={<ToolSkeleton />}>{Tool ? <Tool /> : <Home />}</Suspense>
        </ToolBoundary>
      </main>
      {menuOpen && <CommandMenu onClose={() => setMenuOpen(false)} />}
      </div>
      <Analytics />
    </>
  )
}
