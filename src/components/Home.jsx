import { ArrowRight } from '@phosphor-icons/react'
import { GROUPS, TOOLS, preload, readRecent } from '../tools/index.js'

function Card({ t }) {
  const Icon = t.icon
  return (
    <a className="tool-card" href={`#/${t.id}`} onMouseEnter={() => preload(t)} onFocus={() => preload(t)}>
      <span className="nav-icon">
        <Icon size={19} />
      </span>
      <span className="tool-card-text">
        <span className="tool-card-title">{t.label}</span>
        <span className="tool-card-hint">{t.hint}</span>
      </span>
      <ArrowRight className="tool-card-arrow" size={16} aria-hidden="true" />
    </a>
  )
}

export default function Home() {
  const recent = readRecent()
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <div className="tool home">
      <header className="header">
        <h1 className="title">Small tools for everyday files</h1>
        <p className="lede">
          PDFs, images, video, text and more. Most tools run entirely in your browser, so your files never leave this device. Press{' '}
          <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd> to jump to any tool.
        </p>
      </header>

      {recent.length > 0 && (
        <section className="home-group">
          <h2 className="home-group-title">Recently used</h2>
          <div className="tool-grid">
            {recent.map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
        </section>
      )}

      {GROUPS.map((g) => (
        <section className="home-group" key={g}>
          <h2 className="home-group-title">{g}</h2>
          <div className="tool-grid">
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
