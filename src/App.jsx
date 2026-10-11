import { useEffect, useState } from 'react'
import PdfTool from './tools/PdfTool.jsx'
import InstagramTool from './tools/InstagramTool.jsx'

const TOOLS = [
  { id: 'pdf', label: 'PDF Converter', component: PdfTool },
  { id: 'instagram', label: 'Instagram', component: InstagramTool },
]

function currentTool() {
  const id = window.location.hash.replace(/^#\/?/, '')
  return TOOLS.find((t) => t.id === id) || TOOLS[0]
}

export default function App() {
  const [tool, setTool] = useState(currentTool)

  useEffect(() => {
    const onHash = () => setTool(currentTool())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = `${tool.label} · Handybits`
  }, [tool])

  const Tool = tool.component

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="logo" href="#/pdf">
          Handybits
        </a>
        <nav className="nav" aria-label="Tools">
          {TOOLS.map((t) => (
            <a key={t.id} href={`#/${t.id}`} className={t.id === tool.id ? 'active' : ''} aria-current={t.id === tool.id ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Tool />
      </main>
    </div>
  )
}
