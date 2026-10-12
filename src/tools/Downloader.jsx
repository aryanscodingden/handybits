import { useEffect, useState } from 'react'
import {
  CheckCircle,
  ClipboardText,
  DownloadSimple,
  FacebookLogo,
  FilmStrip,
  InstagramLogo,
  LinkSimple,
  MusicNotes,
  PinterestLogo,
  RedditLogo,
  TiktokLogo,
  WarningCircle,
  XLogo,
} from '@phosphor-icons/react'
import { downloadBlob, formatBytes } from '../lib/format.js'
import './Downloader.css'

// A loose mirror of the server's allowlist (server/sites.js), used to show the
// platform and enable the button. The server does the strict validation.
const PLATFORMS = [
  {
    id: 'instagram',
    label: 'Instagram',
    icon: InstagramLogo,
    host: /(^|\.)instagram\.com$/,
    video: () => /\/(reels?|p|tv)\/[\w-]{5,}/,
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    icon: TiktokLogo,
    host: /(^|\.)tiktok\.com$/,
    video: (h) => (/^v[mt]\./.test(h) ? /^\/\w{5,}/ : /\/@[\w.]+\/video\/\d+|^\/t\/\w{5,}/),
  },
  {
    id: 'x',
    label: 'X',
    icon: XLogo,
    host: /(^|\.)(x|twitter)\.com$/,
    video: () => /^\/\w+\/status\/\d+/,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    icon: RedditLogo,
    host: /(^|\.)reddit\.com$|^(v\.)?redd\.it$/,
    video: (h) => (/redd\.it$/.test(h) ? /^\/\w{4,}/ : /\/comments\/\w+|^\/r\/\w+\/s\/\w+/),
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    icon: PinterestLogo,
    host: /(^|\.)pinterest\.[a-z.]+$|^pin\.it$/,
    video: (h) => (h === 'pin.it' ? /^\/\w{5,}/ : /\/pin\/[\w-]*\d{5,}/),
  },
  {
    id: 'facebook',
    label: 'Facebook',
    icon: FacebookLogo,
    host: /(^|\.)facebook\.com$|(^|\.)fb\.watch$/,
    video: (h) => (/fb\.watch$/.test(h) ? /^\/[\w-]{5,}/ : /\/(reels?\/\d|videos\/|watch|share\/[vr]\/)/),
  },
]

const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/
const SITE_NAMES = 'Instagram, TikTok, X, Reddit, Pinterest or Facebook'

// Accept links pasted without a scheme ("instagram.com/reel/…").
function normalize(text) {
  if (!text || /^[a-z][a-z0-9+.-]*:/i.test(text)) return text
  return /^[\w-]+(\.[\w-]+)+\//.test(text) ? `https://${text}` : text
}

function detect(text) {
  let u
  try {
    u = new URL(text)
  } catch {
    return {}
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return {}
  const host = u.hostname.toLowerCase()
  if (YOUTUBE.test(host)) return { youtube: true }
  const platform = PLATFORMS.find((p) => p.host.test(host))
  if (!platform) return {}
  return { platform, valid: platform.video(host).test(u.pathname) }
}

const MODES = {
  video: { label: 'Video', detail: 'MP4', icon: FilmStrip, busy: 'Downloading video…' },
  audio: { label: 'Audio only', detail: 'MP3', icon: MusicNotes, busy: 'Extracting audio…' },
}

function filenameFrom(res, fallback) {
  const header = res.headers.get('Content-Disposition') || ''
  const match = header.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i)
  return match ? decodeURIComponent(match[1] || match[2]) : fallback
}

export default function Downloader() {
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

  const link = normalize(url.trim())
  const { platform, valid, youtube } = detect(link)
  const PlatformIcon = platform?.icon || LinkSimple

  async function paste() {
    try {
      setUrl((await navigator.clipboard.readText()).trim())
    } catch {
      document.getElementById('dl-url')?.focus()
    }
  }

  async function download(e) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/download?${new URLSearchParams({ url: link, type: mode })}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Download failed. Try again in a moment.')
      }
      const blob = await res.blob()
      const name = filenameFrom(res, `${platform.id}-${mode === 'audio' ? 'audio.mp3' : 'video.mp4'}`)
      downloadBlob(blob, name)
      setDone({ name, size: blob.size })
      setServerUp(true)
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Can’t reach the download server. Is it running?' : err.message)
    } finally {
      setBusy(false)
    }
  }

  let hint = null
  if (link && youtube) hint = `YouTube isn’t supported. Try a link from ${SITE_NAMES}.`
  else if (link && platform && !valid) hint = `That ${platform.label} link doesn’t point to a video post.`
  else if (link && !platform) hint = `That doesn’t look like a link from ${SITE_NAMES}.`

  return (
    <div className="tool">
      <header className="header">
        <h1 className="title">Video downloader</h1>
        <p className="lede">Save a video, or just its audio, from {SITE_NAMES}. Paste the link and click download.</p>
      </header>

      <form className="ig-form panel" onSubmit={download}>
        <label className="field-label" htmlFor="dl-url">
          Video link
        </label>
        <div className={`input-wrap dl-input${platform ? ' detected' : ''}`}>
          <PlatformIcon
            key={platform?.id || 'link'}
            className="input-icon"
            size={18}
            weight={platform ? 'fill' : 'regular'}
            aria-hidden="true"
          />
          <input
            id="dl-url"
            className="input"
            type="url"
            inputMode="url"
            placeholder="Paste a link to a reel, TikTok, post or pin"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck="false"
            autoFocus
          />
          {!url && navigator.clipboard?.readText && (
            <button type="button" className="btn ghost small input-action" onClick={paste} disabled={busy}>
              <ClipboardText size={15} />
              Paste
            </button>
          )}
          {url && platform && (
            <span className="dl-badge input-action" aria-label={`Detected ${platform.label}`}>
              {platform.label}
            </span>
          )}
        </div>

        <div className="ig-row">
          <div className="choice" role="radiogroup" aria-label="What to download">
            {Object.entries(MODES).map(([key, m]) => {
              const Icon = m.icon
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={mode === key}
                  className={mode === key ? 'on' : ''}
                  onClick={() => setMode(key)}
                  disabled={busy}
                >
                  <Icon size={17} weight={mode === key ? 'fill' : 'regular'} />
                  {m.label}
                  <span className="choice-detail">{m.detail}</span>
                </button>
              )
            })}
          </div>
          <button type="submit" className={`btn primary${busy ? ' loading' : ''}`} disabled={!valid || busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <DownloadSimple size={17} weight="bold" />}
            {busy ? MODES[mode].busy : 'Download'}
          </button>
        </div>
      </form>

      <ul className="dl-sites" aria-label="Supported sites">
        {PLATFORMS.map((p) => {
          const Icon = p.icon
          const on = platform?.id === p.id
          return (
            <li key={p.id} className={on ? 'on' : ''}>
              <Icon size={14} weight={on ? 'fill' : 'regular'} aria-hidden="true" />
              {p.label}
            </li>
          )
        })}
      </ul>

      <div className="ig-status" aria-live="polite">
        {hint && (
          <p className="notice error">
            <WarningCircle size={16} weight="fill" />
            {hint}
          </p>
        )}
        {error && (
          <p className="notice error">
            <WarningCircle size={16} weight="fill" />
            {error}
          </p>
        )}
        {done && (
          <p className="notice ok">
            <CheckCircle size={16} weight="fill" />
            Saved {done.name} · {formatBytes(done.size)}
          </p>
        )}
        {!serverUp && !error && (
          <p className="notice error">
            <WarningCircle size={16} weight="fill" />
            <span>
              The download server isn’t running. Start it with <code>npm run dev</code>.
            </span>
          </p>
        )}
      </div>

      <footer className="footer">
        Works with public videos only. The link is sent to the Handybits server, which fetches the video and sends it straight back; nothing is stored. Only download content you have the right to use.
      </footer>
    </div>
  )
}
