import { useEffect, useState } from 'react'
import { downloadBlob, formatBytes } from '../lib/format.js'

const REEL_URL = /^https?:\/\/(www\.)?instagram\.com\/(reels?|p|tv)\/[A-Za-z0-9_-]+/i

const MODES = {
  video: { label: 'Reel (video)', busy: 'Downloading reel…' },
  audio: { label: 'Audio only (MP3)', busy: 'Extracting audio…' },
}

function filenameFrom(res, fallback) {
  const header = res.headers.get('Content-Disposition') || ''
  const match = header.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i)
  return match ? decodeURIComponent(match[1] || match[2]) : fallback
}

export default function InstagramTool() {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState('video')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [serverUp, setServerUp] = useState(true)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setServerUp(r.ok))
      .catch(() => setServerUp(false))
  }, [])

  const trimmed = url.trim()
  const valid = REEL_URL.test(trimmed)

  async function download(e) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/instagram?${new URLSearchParams({ url: trimmed, type: mode })}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Download failed. Try again in a moment.')
      }
      const blob = await res.blob()
      const name = filenameFrom(res, mode === 'audio' ? 'reel-audio.mp3' : 'reel.mp4')
      downloadBlob(blob, name)
      setDone({ name, size: blob.size })
      setServerUp(true)
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Can’t reach the download server. Is it running?' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool">
      <header className="header">
        <h1 className="title">Instagram</h1>
        <p className="lede">Download a reel or just its audio. Paste the link and click download.</p>
      </header>

      <form className="ig-form" onSubmit={download}>
        <label className="sr-only" htmlFor="ig-url">
          Reel link
        </label>
        <input
          id="ig-url"
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://www.instagram.com/reel/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          autoComplete="off"
          spellCheck="false"
          autoFocus
        />
        <div className="ig-row">
          <label className="sr-only" htmlFor="ig-mode">
            What to download
          </label>
          <select id="ig-mode" className="select" value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy}>
            {Object.entries(MODES).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary" disabled={!valid || busy}>
            {busy ? MODES[mode].busy : 'Download'}
          </button>
        </div>
      </form>

      <div className="ig-status" aria-live="polite">
        {trimmed && !valid && <p className="error">That doesn’t look like an Instagram reel or post link.</p>}
        {error && <p className="error">{error}</p>}
        {done && (
          <p className="ok">
            Saved {done.name} · {formatBytes(done.size)}
          </p>
        )}
        {!serverUp && !error && (
          <p className="error">
            The download server isn’t running. Start it with <code>npm run dev</code>.
          </p>
        )}
      </div>

      <footer className="footer">
        Works with public reels. The link is sent to the Handybits server, which fetches the reel and sends it straight back; nothing is kept. Only download content you have the right to use.
      </footer>
    </div>
  )
}
