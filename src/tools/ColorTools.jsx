import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsDownUp, Check, CheckCircle, Copy, DownloadSimple, Eyedropper, MagicWand, Trash, XCircle } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import * as C from '../lib/color.js'
import { extractPalette, fitWithin } from '../lib/color-palette.js'
import { useCopy, useStoredState } from '../lib/text-hooks.js'
import './ColorTools.css'

const TABS = [
  ['picker', 'Picker'],
  ['palette', 'Palette from image'],
  ['contrast', 'Contrast checker'],
]

const K = (k) => `handybits:color:${k}`
const hexOf = (rgb) => C.toHex(C.roundRgb(rgb))

export default function ColorTools() {
  const [tab, setTab] = useStoredState(K('tab'), 'picker')
  const [status, setStatus] = useState('')
  const tabRefs = useRef({})

  function onTabKey(e) {
    const i = TABS.findIndex(([k]) => k === tab)
    let next = null
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length][0]
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length][0]
    if (next) {
      e.preventDefault()
      setTab(next)
      tabRefs.current[next]?.focus()
    }
  }

  return (
    <div className="tool col">
      <header className="header">
        <h1 className="title">Color tools</h1>
        <p className="lede">Pick and convert colours, pull a palette out of a photo, and check that text is readable on its background.</p>
      </header>

      <div className="col-tabs-wrap">
        <div className="segmented col-tabs" role="tablist" aria-label="Tool" onKeyDown={onTabKey}>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              ref={(el) => (tabRefs.current[key] = el)}
              type="button"
              role="tab"
              id={`col-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="col-panel"
              tabIndex={tab === key ? 0 : -1}
              className={tab === key ? 'on' : ''}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div id="col-panel" role="tabpanel" aria-labelledby={`col-tab-${tab}`} className="col-panel" key={tab}>
        {tab === 'picker' && <Picker announce={setStatus} />}
        {tab === 'palette' && <PaletteTab announce={setStatus} />}
        {tab === 'contrast' && <Contrast announce={setStatus} />}
      </div>

      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      <p className="footer">Everything runs in your browser. Images never leave your device. Contrast uses the WCAG 2.x formula; scales and harmonies are built in OKLCH so steps look evenly spaced.</p>
    </div>
  )
}

// ---------- Shared ----------

function useAnnouncedCopy(announce) {
  const [copied, copy] = useCopy()
  const doCopy = useCallback(
    async (text, id = text) => {
      const ok = await copy(text, id)
      announce(ok ? `Copied ${text.length > 40 ? '' : text}` : 'Copy was blocked by the browser')
      return ok
    },
    [copy, announce],
  )
  return [copied, doCopy]
}

function Swatch({ rgb, label, sub, onClick, copied, big = false }) {
  const hex = hexOf(rgb)
  return (
    <button type="button" className={`col-swatch${big ? ' big' : ''}`} style={{ '--sw': hex, color: C.textOn(rgb) }} onClick={onClick} aria-label={`Copy ${hex}${label ? `, ${label}` : ''}`}>
      {label && <span className="col-sw-label">{label}</span>}
      <span className="col-sw-hex">{copied ? 'Copied' : hex}</span>
      {sub && <span className="col-sw-sub">{sub}</span>}
    </button>
  )
}

// ---------- Picker ----------

const FORMATS = [
  ['hex', 'HEX', (rgb) => C.toHex(C.roundRgb(rgb))],
  ['rgb', 'RGB', C.formatRgb],
  ['hsl', 'HSL', C.formatHsl],
  ['oklch', 'OKLCH', C.formatOklch],
]

function Picker({ announce }) {
  const [hex, setHex] = useStoredState(K('current'), '#b5532f')
  const rgb = useMemo(() => C.parseHex(hex) || { r: 181, g: 83, b: 47, a: 1 }, [hex])
  const [editing, setEditing] = useState(null) // { key, text, valid }
  const [copied, copy] = useAnnouncedCopy(announce)
  const [pickErr, setPickErr] = useState('')
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window

  const setRgb = (c) => setHex(C.toHex(C.roundRgb(c)))

  async function eyedrop() {
    setPickErr('')
    try {
      const res = await new window.EyeDropper().open()
      setHex(res.sRGBHex.length === 7 ? res.sRGBHex : C.toHex(C.parseColor(res.sRGBHex)))
      announce(`Picked ${res.sRGBHex}`)
    } catch (e) {
      if (e?.name !== 'AbortError') setPickErr('The screen picker isn’t available right now.')
    }
  }

  const scale = useMemo(() => C.tintsAndShades(rgb), [rgb])
  const harmonies = useMemo(() => C.harmonies(C.roundRgb({ ...rgb, a: 1 })), [rgb])
  const oklch = C.rgbToOklch(rgb)

  return (
    <>
      <div className="col-picker panel">
        <label className="col-big" style={{ '--sw': hexOf(rgb) }}>
          <input type="color" value={C.toHex({ ...C.roundRgb(rgb), a: 1 }, false)} onChange={(e) => setHex(e.target.value)} aria-label="Choose a colour" />
          <span className="col-big-hint" style={{ color: C.textOn(rgb) }}>
            Click to choose
          </span>
        </label>
        <div className="col-fields">
          {FORMATS.map(([key, label, fmt]) => {
            const isEditing = editing?.key === key
            const value = isEditing ? editing.text : fmt(rgb)
            const invalid = isEditing && !editing.valid
            return (
              <div key={key} className="col-field">
                <label className="col-field-label" htmlFor={`col-f-${key}`}>
                  {label}
                </label>
                <input
                  id={`col-f-${key}`}
                  className={`input col-input${invalid ? ' invalid' : ''}`}
                  value={value}
                  aria-invalid={invalid || undefined}
                  spellCheck="false"
                  autoComplete="off"
                  onChange={(e) => {
                    const text = e.target.value
                    let parsed = C.parseColor(key === 'hex' && !text.trim().startsWith('#') ? `#${text.trim()}` : text)
                    if (!parsed && key !== 'hex') parsed = C.parseColor(`${key}(${text.replace(/^\w+\(|\)$/g, '')})`)
                    setEditing({ key, text, valid: !!parsed })
                    if (parsed) setRgb(parsed)
                  }}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                />
                <button type="button" className="icon col-copy" onClick={() => copy(fmt(rgb), key)} aria-label={`Copy ${label} value`}>
                  {copied === key ? <Check size={16} weight="bold" /> : <Copy size={16} />}
                </button>
              </div>
            )
          })}
          <div className="col-picker-foot">
            {hasEyeDropper && (
              <button type="button" className="btn small" onClick={eyedrop}>
                <Eyedropper size={15} />
                Pick from screen
              </button>
            )}
            <span className="col-meta">
                Lightness {Math.round(oklch.L * 100)}% · chroma {oklch.C.toFixed(3)} · hue {Math.round(oklch.H)}°
              </span>
          </div>
          {pickErr && <p className="col-err">{pickErr}</p>}
        </div>
      </div>

      <section className="section" aria-labelledby="col-scale-h">
        <div className="section-head">
          <h2 id="col-scale-h">Tints and shades</h2>
          <button type="button" className="btn ghost small" onClick={() => copy(scale.map((s) => `--color-${s.step}: ${hexOf(s.rgb)};`).join('\n'), 'scale')}>
            {copied === 'scale' ? <Check size={15} weight="bold" /> : <Copy size={15} />}
            {copied === 'scale' ? 'Copied' : 'Copy as CSS'}
          </button>
        </div>
        <div className="col-scale">
          {scale.map((s) => (
            <Swatch key={s.step} rgb={s.rgb} label={String(s.step)} onClick={() => copy(hexOf(s.rgb), `s${s.step}`)} copied={copied === `s${s.step}`} />
          ))}
        </div>
        <p className="col-hint">Click a swatch to copy its hex code.</p>
      </section>

      <section className="section" aria-labelledby="col-harm-h">
        <div className="section-head">
          <h2 id="col-harm-h">Harmonies</h2>
        </div>
        <div className="col-harmonies">
          {harmonies.map((h) => (
            <div key={h.name} className="col-harmony">
              <h3>{h.name}</h3>
              <div className="col-harmony-row">
                {h.colors.map((c, i) => (
                  <Swatch key={i} rgb={c} onClick={() => copy(hexOf(c), `${h.name}${i}`)} copied={copied === `${h.name}${i}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

// ---------- Palette from image ----------

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file)
    } catch {
      // fall through (e.g. SVG)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function PaletteTab({ announce }) {
  const [count, setCount] = useStoredState(K('palette-count'), 6)
  const [image, setImage] = useState(null) // { url, name, data: ImageData }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, copy] = useAnnouncedCopy(announce)

  const palette = useMemo(() => (image ? extractPalette(image.data.data, count) : []), [image, count])

  const onFiles = useCallback(
    async (files) => {
      const f = files.find((x) => x.type.startsWith('image/'))
      setErr('')
      if (!f) {
        setErr('That isn’t an image. Try a JPG, PNG, WebP or GIF.')
        return
      }
      setBusy(true)
      try {
        const img = await loadImage(f)
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        const { width, height } = fitWithin(w, h, 200)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, width, height)
        const data = ctx.getImageData(0, 0, width, height)
        img.close?.()
        setImage((prev) => {
          if (prev) URL.revokeObjectURL(prev.url)
          return { url: URL.createObjectURL(f), name: f.name || 'Pasted image', data }
        })
        announce('Palette ready')
      } catch {
        setErr('Couldn’t read that image.')
      } finally {
        setBusy(false)
      }
    },
    [announce],
  )

  // Paste an image from the clipboard.
  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        onFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onFiles])

  useEffect(() => () => image && URL.revokeObjectURL(image.url), [image])

  const css = `:root {\n${palette.map((p, i) => `  --palette-${i + 1}: ${hexOf(p.rgb)};`).join('\n')}\n}`
  const json = JSON.stringify(
    palette.map((p) => ({ hex: hexOf(p.rgb), rgb: [p.rgb.r, p.rgb.g, p.rgb.b], share: Math.round(p.share * 1000) / 10 })),
    null,
    2,
  )

  function downloadPng() {
    const w = 1200
    const h = 360
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    const bw = w / palette.length
    palette.forEach((p, i) => {
      ctx.fillStyle = hexOf(p.rgb)
      ctx.fillRect(Math.round(i * bw), 0, Math.ceil(bw), 280)
      ctx.fillStyle = '#1b1a17'
      ctx.font = '600 22px ui-monospace, Menlo, monospace'
      ctx.fillText(hexOf(p.rgb).toUpperCase(), i * bw + 20, 322)
      ctx.fillStyle = '#75726a'
      ctx.font = '18px system-ui, sans-serif'
      ctx.fillText(`${(p.share * 100).toFixed(1)}%`, i * bw + 20, 348)
    })
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'palette.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }

  return (
    <>
      <DropZone
        multiple={false}
        accept="image/*"
        compact={!!image}
        onFiles={onFiles}
        title={busy ? 'Reading image…' : image ? 'Drop another image, paste, or click to browse' : 'Drop an image here, paste one, or click to browse'}
        sub="The image is shrunk to 200 pixels and analysed on your device."
        button="Choose an image"
      />
      {err && (
        <p className="notice error col-note" role="alert">
          <XCircle size={16} weight="bold" />
          {err}
        </p>
      )}

      {image && palette.length > 0 && (
        <div className="col-pal">
          <div className="col-pal-top">
            <img src={image.url} alt={`Source: ${image.name}`} className="col-pal-img" />
            <div className="col-pal-main">
              <div className="col-pal-head">
                <div className="segmented" role="radiogroup" aria-label="Number of colours">
                  {[5, 6, 7, 8].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={count === n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
                      {n}
                    </button>
                  ))}
                </div>
                <span className="col-meta">{palette.length < count ? `Only ${palette.length} distinct colours found` : 'colours, by how much of the image they cover'}</span>
                <button
                  type="button"
                  className="btn ghost small danger col-pal-clear"
                  onClick={() => {
                    setImage(null)
                  }}
                >
                  <Trash size={15} />
                  Clear
                </button>
              </div>
              <div className="col-pal-strip" aria-hidden="true">
                {palette.map((p, i) => (
                  <span key={i} style={{ background: hexOf(p.rgb), flexGrow: Math.max(p.share, 0.04) }} />
                ))}
              </div>
            </div>
          </div>

          <ul className="col-pal-list">
            {palette.map((p, i) => {
              const hex = hexOf(p.rgb)
              return (
                <li key={i}>
                  <button type="button" className="col-pal-item" onClick={() => copy(hex, `p${i}`)} aria-label={`Copy ${hex}, ${(p.share * 100).toFixed(1)} percent`}>
                    <span className="col-pal-chip" style={{ background: hex }} />
                    <span className="col-pal-hex">{copied === `p${i}` ? 'Copied' : hex}</span>
                    <span className="col-pal-pct">{(p.share * 100).toFixed(1)}%</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="col-export">
            <span className="field-label">Export</span>
            <button type="button" className="btn small" onClick={() => copy(css, 'css')}>
              {copied === 'css' ? <Check size={15} weight="bold" /> : <Copy size={15} />}
              {copied === 'css' ? 'Copied' : 'CSS variables'}
            </button>
            <button type="button" className="btn small" onClick={() => copy(json, 'json')}>
              {copied === 'json' ? <Check size={15} weight="bold" /> : <Copy size={15} />}
              {copied === 'json' ? 'Copied' : 'JSON'}
            </button>
            <button type="button" className="btn small" onClick={downloadPng}>
              <DownloadSimple size={15} />
              PNG strip
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ---------- Contrast ----------

function ColorInput({ id, label, value, onChange }) {
  const [draft, setDraft] = useState(null)
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    // An outside change (swap, suggestion) replaces whatever was being typed.
    const d = draft === null ? null : C.parseColor(draft) || C.parseColor(`#${draft.trim()}`)
    const v = C.parseColor(value)
    if (draft !== null && (!d || !v || C.toHex(d) !== C.toHex(v))) setDraft(null)
  }
  const rgb = C.parseColor(value) || { r: 0, g: 0, b: 0, a: 1 }
  const invalid = draft !== null && !C.parseColor(draft)
  return (
    <div className="col-cin">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="col-cin-row">
        <label className="col-cin-sw" style={{ '--sw': hexOf(rgb) }}>
          <input type="color" value={C.toHex({ ...C.roundRgb(rgb), a: 1 }, false)} onChange={(e) => onChange(e.target.value)} aria-label={`${label} colour picker`} />
        </label>
        <input
          id={id}
          className={`input col-input${invalid ? ' invalid' : ''}`}
          value={draft ?? value}
          aria-invalid={invalid || undefined}
          spellCheck="false"
          autoComplete="off"
          onChange={(e) => {
            const t = e.target.value
            setDraft(t)
            const p = C.parseColor(t) || C.parseColor(`#${t.trim()}`)
            if (p) onChange(t.trim().match(/^[0-9a-f]{3,8}$/i) ? `#${t.trim()}` : t.trim())
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
    </div>
  )
}

const CHECKS = [
  ['Normal text', 'AA', 4.5],
  ['Normal text', 'AAA', 7],
  ['Large text', 'AA', 3],
  ['Large text', 'AAA', 4.5],
  ['UI components', 'AA', 3],
]

function Contrast({ announce }) {
  const [fg, setFg] = useStoredState(K('fg'), '#75726a')
  const [bg, setBg] = useStoredState(K('bg'), '#ffffff')
  const [copied, copy] = useAnnouncedCopy(announce)

  const bgRgb = { ...(C.parseColor(bg) || { r: 255, g: 255, b: 255 }), a: 1 }
  const fgRaw = C.parseColor(fg) || { r: 0, g: 0, b: 0, a: 1 }
  const fgRgb = C.over(fgRaw, bgRgb)
  const ratio = C.contrast(fgRgb, bgRgb)
  const shown = Math.floor(ratio * 100) / 100 // never round up into a pass

  const suggestions = useMemo(() => {
    if (ratio >= 7) return []
    const out = []
    const aa = ratio < 4.5 ? C.suggestPassing(fgRgb, bgRgb, 4.5) : null
    const aaa = C.suggestPassing(fgRgb, bgRgb, 7)
    if (aa) out.push({ label: 'AA', rgb: aa })
    if (aaa) out.push({ label: 'AAA', rgb: aaa })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fg, bg])

  const [showSuggest, setShowSuggest] = useState(false)

  return (
    <>
      <div className="col-contrast-inputs panel">
        <ColorInput id="col-fg" label="Text" value={fg} onChange={setFg} />
        <button
          type="button"
          className="icon col-swap"
          onClick={() => {
            setFg(bg)
            setBg(fg)
            announce('Colours swapped')
          }}
          aria-label="Swap text and background"
          title="Swap"
        >
          <ArrowsDownUp size={18} />
        </button>
        <ColorInput id="col-bg" label="Background" value={bg} onChange={setBg} />
      </div>

      <div className="col-result">
        <div className="col-ratio">
          <span className="col-ratio-label">Contrast ratio</span>
          <span className="col-ratio-value" aria-live="polite">
            {shown.toFixed(2)}
            <span className="col-ratio-unit">:1</span>
          </span>
          {fgRaw.a < 1 && <span className="col-meta">Text alpha is blended over the background first.</span>}
        </div>
        <ul className="col-checks">
          {CHECKS.map(([what, level, min]) => {
            const pass = ratio >= min
            return (
              <li key={what + level} className={pass ? 'pass' : 'fail'}>
                {pass ? <CheckCircle size={16} weight="fill" /> : <XCircle size={16} weight="fill" />}
                <span className="col-check-what">{what}</span>
                <span className="col-check-level">{level}</span>
                <span className="col-check-min">{min}:1</span>
                <span className="sr-only">{pass ? 'passes' : 'fails'}</span>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="col-sample" style={{ background: hexOf(bgRgb), color: fg }}>
        <p className="col-sample-large">Large text, 24 pixels</p>
        <p className="col-sample-body">Body text at 16 pixels. The quick brown fox jumps over the lazy dog, and readers with low vision can still follow along.</p>
        <p className="col-sample-small">Small print at 13 pixels is where low contrast hurts most.</p>
        <span className="col-sample-ui" style={{ borderColor: fg }}>
          Button outline
        </span>
      </div>

      {ratio < 7 && (
        <section className="section col-suggest" aria-labelledby="col-sug-h">
          <div className="section-head">
            <h2 id="col-sug-h">Suggest a passing colour</h2>
            {!showSuggest && (
              <button type="button" className="btn small" onClick={() => setShowSuggest(true)}>
                <MagicWand size={15} />
                Suggest
              </button>
            )}
          </div>
          {showSuggest &&
            (suggestions.length ? (
              <ul className="col-sug-list">
                {suggestions.map((s) => {
                  const hex = hexOf(s.rgb)
                  const r = C.contrast(s.rgb, bgRgb)
                  return (
                    <li key={s.label}>
                      <span className="col-sug-chip" style={{ background: hexOf(bgRgb) }}>
                        <span style={{ color: hex }}>Aa</span>
                      </span>
                      <span className="col-sug-text">
                        <strong>{hex}</strong>
                        <span className="col-meta">
                          {(Math.floor(r * 100) / 100).toFixed(2)}:1 · passes {s.label} for normal text
                        </span>
                      </span>
                      <button type="button" className="icon" onClick={() => copy(hex, `sug${s.label}`)} aria-label={`Copy ${hex}`}>
                        {copied === `sug${s.label}` ? <Check size={16} weight="bold" /> : <Copy size={16} />}
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setFg(hex)
                          announce(`Text colour set to ${hex}`)
                        }}
                      >
                        Use
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="col-hint">No lighter or darker version of this hue reaches AA on this background. Try changing the background.</p>
            ))}
          {showSuggest && <p className="col-hint">Keeps the hue and chroma, and changes only OKLCH lightness as little as possible.</p>}
        </section>
      )}
    </>
  )
}
