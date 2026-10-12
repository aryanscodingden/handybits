import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowCounterClockwise,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  DownloadSimple,
  Eraser,
  FilePdf,
  ImageSquare,
  PencilSimpleLine,
  Plus,
  Signature,
  TextAa,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { checkEditable, closePdf, openPdf, pdfErrorMessage, renderPage, stampPdf } from '../lib/pdf.js'
import { downloadBlob } from '../lib/format.js'
import './SignPdf.css'

const uid = () => crypto.randomUUID()
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const SAVED_KEY = 'handybits:signature'

const INKS = {
  black: { label: 'Black', color: '#1b1a17' },
  blue: { label: 'Blue', color: '#1f3f8f' },
}

const FONTS = {
  flowing: { label: 'Flowing', family: "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive" },
  brush: { label: 'Brush', family: "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', cursive" },
  formal: { label: 'Formal', family: "'Apple Chancery', 'Lucida Handwriting', 'Segoe Script', cursive" },
}

function readSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null')
    return v?.url?.startsWith('data:image/png') && v.aspect > 0 ? v : null
  } catch {
    return null
  }
}

function writeSaved(sig) {
  try {
    if (sig) localStorage.setItem(SAVED_KEY, JSON.stringify({ url: sig.url, aspect: sig.aspect }))
    else localStorage.removeItem(SAVED_KEY)
  } catch {
    // Storage may be full or disabled; remembering is optional.
  }
}

// Renders a line of text to a tightly cropped transparent PNG.
function textToPng(text, family, color, size = 120) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = `${size}px ${family}`
  ctx.font = font
  const m = ctx.measureText(text)
  const left = m.actualBoundingBoxLeft || 0
  const right = m.actualBoundingBoxRight || m.width
  const ascent = m.actualBoundingBoxAscent || size * 0.8
  const descent = m.actualBoundingBoxDescent || size * 0.25
  const pad = Math.round(size * 0.08)
  canvas.width = Math.max(1, Math.ceil(left + right + pad * 2))
  canvas.height = Math.max(1, Math.ceil(ascent + descent + pad * 2))
  ctx.font = font
  ctx.fillStyle = color
  ctx.fillText(text, pad + left, pad + ascent)
  return { url: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height }
}

// Encodes a canvas as a JPEG object URL (tracked in `list` for cleanup) and
// frees the canvas.
async function canvasUrl(canvas, list) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88))
  canvas.width = canvas.height = 0
  const url = URL.createObjectURL(blob)
  list.push(url)
  return url
}

function dataUrlBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export default function SignPdf() {
  const [doc, setDoc] = useState(null) // { name, bytes, sizes: [{ w, h }] }
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageNum, setPageNum] = useState(1)
  const [pageImgs, setPageImgs] = useState({})
  const [thumbs, setThumbs] = useState({})
  const [items, setItems] = useState([])
  const [saved, setSaved] = useState(readSaved)
  const [mode, setMode] = useState(() => (readSaved() ? 'saved' : 'draw'))
  const [outputs, setOutputs] = useState({})
  const [ink, setInk] = useState('black')
  const [stamp, setStamp] = useState('signature')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const pdfRef = useRef(null)
  const urlsRef = useRef([])
  const stageRef = useRef(null)
  const itemRefs = useRef(new Map())
  const focusRef = useRef(null)

  const handlers = useMemo(
    () => ({
      draw: (s) => setOutputs((o) => ({ ...o, draw: s })),
      type: (s) => setOutputs((o) => ({ ...o, type: s })),
      upload: (s) => setOutputs((o) => ({ ...o, upload: s })),
    }),
    [],
  )
  const sig = mode === 'saved' ? saved : outputs[mode]

  const release = useCallback(() => {
    closePdf(pdfRef.current)
    pdfRef.current = null
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    urlsRef.current = []
  }, [])

  useEffect(() => release, [release])

  useLayoutEffect(() => {
    if (!focusRef.current) return
    itemRefs.current.get(focusRef.current)?.focus()
    focusRef.current = null
  }, [items])

  async function loadFile([file]) {
    if (!file) return
    if (!isPdf(file)) return setLoadError(`${file.name} isn’t a PDF.`)
    setLoading(true)
    setLoadError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await checkEditable(bytes)
      let pdf
      try {
        pdf = await openPdf(bytes)
      } catch (err) {
        throw new Error(pdfErrorMessage(err), { cause: err })
      }
      const sizes = []
      for (let n = 1; n <= pdf.numPages; n++) {
        const vp = (await pdf.getPage(n)).getViewport({ scale: 1 })
        sizes.push({ w: vp.width, h: vp.height })
      }
      release()
      pdfRef.current = pdf
      setPageImgs({})
      setThumbs({})
      setItems([])
      setPageNum(1)
      setDoc({ name: file.name, bytes, sizes })
    } catch (err) {
      console.error(err)
      setLoadError(err.message || 'Couldn’t read this PDF.')
    }
    setLoading(false)
  }

  function reset() {
    release()
    setDoc(null)
    setItems([])
    setPageImgs({})
    setThumbs({})
  }

  // Render the current page at a size that stays sharp on high-DPI screens.
  useEffect(() => {
    const pdf = pdfRef.current
    if (!doc || !pdf || pageImgs[pageNum]) return
    let cancelled = false
    const width = Math.round(760 * Math.min(2, window.devicePixelRatio || 1))
    renderPage(pdf, pageNum, { width })
      .then((c) => canvasUrl(c, urlsRef.current))
      .then((url) => !cancelled && setPageImgs((m) => ({ ...m, [pageNum]: url })))
      .catch((err) => console.error(err))
    return () => {
      cancelled = true
    }
  }, [doc, pageNum, pageImgs])

  // Thumbnails for the page strip, one at a time.
  useEffect(() => {
    const pdf = pdfRef.current
    if (!doc || !pdf || doc.sizes.length < 2) return
    let cancelled = false
    ;(async () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      for (let n = 1; n <= doc.sizes.length && !cancelled; n++) {
        try {
          const url = await canvasUrl(await renderPage(pdf, n, { width: 56 * ratio }), urlsRef.current)
          if (!cancelled) setThumbs((t) => ({ ...t, [n]: url }))
        } catch {
          // A missing thumbnail is fine; the page number still shows.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  const size = doc?.sizes[pageNum - 1]
  const pageAspect = size ? size.w / size.h : 1

  function makeStamp() {
    if (stamp === 'date') {
      const text = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      const family = getComputedStyle(document.body).fontFamily
      return { kind: 'date', ...textToPng(text, family, INKS[ink].color, 64), label: text }
    }
    if (!sig) return null
    return { kind: 'signature', url: sig.url, aspect: sig.aspect, label: 'Signature' }
  }

  function place(cx, cy) {
    const s = makeStamp()
    if (!s) {
      setNotice('Create a signature first, then click the page to place it.')
      return
    }
    setNotice('')
    if (s.kind === 'signature') {
      writeSaved(sig)
      setSaved(readSaved() || sig)
    }
    // Signatures start about 160pt wide, dates about 13pt tall.
    let w = s.kind === 'date' ? (13 * s.aspect) / size.w : Math.min(0.4, 160 / size.w)
    let h = (w * pageAspect) / s.aspect
    if (h > 0.4) {
      h = 0.4
      w = (h * s.aspect) / pageAspect
    }
    const item = { id: uid(), page: pageNum, ...s, w, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) }
    focusRef.current = item.id
    setItems((list) => [...list, item])
  }

  function onStageClick(e) {
    if (e.target.closest('.sig-item')) return
    const r = stageRef.current.getBoundingClientRect()
    place((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  const updateItem = useCallback((id, patch) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x))), [])
  const removeItem = useCallback((id) => setItems((list) => list.filter((x) => x.id !== id)), [])

  function forget() {
    writeSaved(null)
    setSaved(null)
    setMode('draw')
  }

  async function download() {
    if (!doc || !items.length || busy) return
    setBusy(true)
    try {
      const cache = new Map()
      const stamps = items.map((it) => {
        if (!cache.has(it.url)) cache.set(it.url, dataUrlBytes(it.url))
        const s = doc.sizes[it.page - 1]
        return { page: it.page - 1, x: it.x, y: it.y, w: it.w, h: (it.w * (s.w / s.h)) / it.aspect, png: cache.get(it.url) }
      })
      const out = await stampPdf(doc.bytes, stamps)
      downloadBlob(new Blob([out.bytes], { type: 'application/pdf' }), `${doc.name.replace(/\.pdf$/i, '') || 'document'}-signed.pdf`)
    } catch (err) {
      console.error(err)
      setNotice('Couldn’t save the signed PDF. The file may be damaged.')
    }
    setBusy(false)
  }

  const pageCount = doc?.sizes.length || 0
  const onPage = items.filter((x) => x.page === pageNum)

  return (
    <div className="tool sig">
      <header className="header">
        <h1 className="title">Sign PDF</h1>
        <p className="lede">Draw, type or upload your signature and place it on any page. Everything happens in your browser — nothing is uploaded.</p>
      </header>

      {!doc ? (
        <>
          <DropZone onFiles={loadFile} accept="application/pdf,.pdf" multiple={false} title={loading ? 'Opening…' : 'Drop a PDF here or click to browse'} sub="Contracts, forms, letters — any PDF you need to sign." />
          {loadError && (
            <p className="notice error sig-top-notice" role="alert">
              <WarningCircle size={15} weight="fill" />
              {loadError}
            </p>
          )}
        </>
      ) : (
        <ul className="rows">
          <li className="row sig-file-row">
            <span className="file-icon pdf" aria-hidden="true">
              <FilePdf size={20} weight="duotone" />
            </span>
            <div className="row-main">
              <span className="name">{doc.name}</span>
              <span className="meta">
                {pageCount} {pageCount === 1 ? 'page' : 'pages'}
                {items.length > 0 && ` · ${items.length} ${items.length === 1 ? 'item' : 'items'} placed`}
              </span>
            </div>
            <div className="row-actions">
              <button type="button" className="btn small ghost" onClick={reset}>
                <X size={15} />
                Close
              </button>
            </div>
          </li>
        </ul>
      )}

      {doc && (
        <>
          <section className="section" aria-labelledby="sig-make">
            <div className="section-head">
              <h2 id="sig-make">Your signature</h2>
              {mode !== 'saved' && mode !== 'upload' && (
                <div className="sig-inks" role="radiogroup" aria-label="Ink colour">
                  {Object.entries(INKS).map(([key, v]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={ink === key}
                      aria-label={v.label}
                      title={v.label}
                      className={`sig-ink${ink === key ? ' on' : ''}`}
                      style={{ '--ink': v.color }}
                      onClick={() => setInk(key)}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="panel sig-panel">
              <div className="choice sig-modes" role="radiogroup" aria-label="How to create your signature">
                {saved && (
                  <button type="button" role="radio" aria-checked={mode === 'saved'} className={mode === 'saved' ? 'on' : ''} onClick={() => setMode('saved')}>
                    <Signature size={16} />
                    Saved
                  </button>
                )}
                <button type="button" role="radio" aria-checked={mode === 'draw'} className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}>
                  <PencilSimpleLine size={16} />
                  Draw
                </button>
                <button type="button" role="radio" aria-checked={mode === 'type'} className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>
                  <TextAa size={16} />
                  Type
                </button>
                <button type="button" role="radio" aria-checked={mode === 'upload'} className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}>
                  <ImageSquare size={16} />
                  Upload
                </button>
              </div>

              {saved && (
                <div className="sig-pane" hidden={mode !== 'saved'}>
                  <div className="sig-preview">
                    <img src={saved.url} alt="Your saved signature" />
                  </div>
                  <div className="sig-pane-foot">
                    <span className="sig-muted">Saved on this device from your last visit.</span>
                    <button type="button" className="btn ghost small danger" onClick={forget}>
                      <Trash size={15} />
                      Forget
                    </button>
                  </div>
                </div>
              )}
              <div className="sig-pane" hidden={mode !== 'draw'}>
                <DrawPad ink={INKS[ink].color} onChange={handlers.draw} />
              </div>
              <div className="sig-pane" hidden={mode !== 'type'}>
                <TypePad ink={INKS[ink].color} onChange={handlers.type} />
              </div>
              <div className="sig-pane" hidden={mode !== 'upload'}>
                <UploadPad onChange={handlers.upload} />
              </div>
            </div>
          </section>

          <section className="section" aria-labelledby="sig-place">
            <div className="section-head sig-place-head">
              <h2 id="sig-place">Place it</h2>
              <div className="sig-place-tools">
                <div className="segmented" role="radiogroup" aria-label="What to add">
                  <button type="button" role="radio" aria-checked={stamp === 'signature'} className={stamp === 'signature' ? 'on' : ''} onClick={() => setStamp('signature')}>
                    <Signature size={15} />
                    Signature
                  </button>
                  <button type="button" role="radio" aria-checked={stamp === 'date'} className={stamp === 'date' ? 'on' : ''} onClick={() => setStamp('date')}>
                    <CalendarBlank size={15} />
                    Date
                  </button>
                </div>
                <button type="button" className="btn small" onClick={() => place(0.5, 0.5)} disabled={stamp === 'signature' && !sig}>
                  <Plus size={14} weight="bold" />
                  Add to page
                </button>
              </div>
            </div>

            <p className={`sig-hint${notice ? ' warn' : ''}`} role="status">
              {notice ||
                (stamp === 'date'
                  ? 'Click the page to add today’s date.'
                  : sig
                    ? 'Click the page to place your signature. Drag to move it, and use the corner handle to resize.'
                    : 'Create a signature above, then click the page to place it.')}
            </p>

            {pageCount > 1 && (
              <div className="sig-pager">
                <button type="button" className="icon" aria-label="Previous page" onClick={() => setPageNum((n) => Math.max(1, n - 1))} disabled={pageNum === 1}>
                  <CaretLeft size={16} weight="bold" />
                </button>
                <ol className="sig-strip" aria-label="Pages">
                  {doc.sizes.map((s, i) => {
                    const n = i + 1
                    const count = items.filter((x) => x.page === n).length
                    return (
                      <li key={n}>
                        <button
                          type="button"
                          className={`sig-thumb${n === pageNum ? ' on' : ''}`}
                          aria-label={`Page ${n}${count ? `, ${count} placed` : ''}`}
                          aria-current={n === pageNum ? 'page' : undefined}
                          onClick={() => setPageNum(n)}
                        >
                          <span className="sig-thumb-img" style={{ aspectRatio: `${s.w} / ${s.h}` }}>
                            {thumbs[n] && <img src={thumbs[n]} alt="" />}
                          </span>
                          <span className="sig-thumb-num">{n}</span>
                          {count > 0 && <span className="sig-thumb-dot" aria-hidden="true" />}
                        </button>
                      </li>
                    )
                  })}
                </ol>
                <button type="button" className="icon" aria-label="Next page" onClick={() => setPageNum((n) => Math.min(pageCount, n + 1))} disabled={pageNum === pageCount}>
                  <CaretRight size={16} weight="bold" />
                </button>
              </div>
            )}

            <div className="sig-desk">
              {/* Clicking places a stamp; "Add to page" does the same from the keyboard. */}
              <div ref={stageRef} className="sig-stage" style={{ aspectRatio: `${size.w} / ${size.h}`, '--ar': pageAspect }} onClick={onStageClick}>
                {pageImgs[pageNum] ? <img className="sig-page" src={pageImgs[pageNum]} alt={`Page ${pageNum}`} draggable={false} /> : <span className="sig-page-loading skeleton" />}
                {onPage.map((it) => (
                  <PlacedItem
                    key={it.id}
                    item={it}
                    pageAspect={pageAspect}
                    stageRef={stageRef}
                    itemRef={(el) => (el ? itemRefs.current.set(it.id, el) : itemRefs.current.delete(it.id))}
                    onChange={updateItem}
                    onRemove={removeItem}
                  />
                ))}
              </div>
            </div>
            {pageCount > 1 && (
              <p className="sig-page-label">
                Page {pageNum} of {pageCount}
              </p>
            )}
          </section>

          <div className="controls sig-controls">
            <p className="sig-muted">
              {items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'} on ${new Set(items.map((x) => x.page)).size} ${new Set(items.map((x) => x.page)).size === 1 ? 'page' : 'pages'}` : 'Nothing placed yet'}
            </p>
            <div className="actions">
              {items.length > 0 && (
                <button type="button" className="btn ghost" onClick={() => setItems([])} disabled={busy}>
                  Remove all
                </button>
              )}
              <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={download} disabled={busy || !items.length}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <DownloadSimple size={16} weight="bold" />}
                Download signed PDF
              </button>
            </div>
          </div>
        </>
      )}

      <footer className="footer">Signatures are drawn into the page as images. The last one you placed is remembered only in this browser, and you can forget it at any time.</footer>
    </div>
  )
}

// A signature or date on the page. Drag to move, drag the corner to resize,
// or use arrow keys (Shift for bigger steps), + and − to resize, Delete to remove.
function PlacedItem({ item, pageAspect, stageRef, itemRef, onChange, onRemove }) {
  const drag = useRef(null)
  const h = (item.w * pageAspect) / item.aspect
  const maxW = (x, y) => Math.min(1 - x, ((1 - y) * item.aspect) / pageAspect)

  function start(e, kind) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.closest('.sig-item')?.focus()
    drag.current = { kind, px: e.clientX, py: e.clientY, x: item.x, y: item.y, w: item.w, rect: stageRef.current.getBoundingClientRect() }
  }

  function moveTo(e) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.px) / d.rect.width
    const dy = (e.clientY - d.py) / d.rect.height
    if (d.kind === 'move') onChange(item.id, { x: clamp(d.x + dx, 0, 1 - item.w), y: clamp(d.y + dy, 0, 1 - h) })
    else onChange(item.id, { w: clamp(d.w + dx, 0.03, maxW(d.x, d.y)) })
  }

  const end = () => (drag.current = null)

  function onKeyDown(e) {
    const step = e.shiftKey ? 0.02 : 0.005
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key]) {
      e.preventDefault()
      const [dx, dy] = moves[e.key]
      onChange(item.id, { x: clamp(item.x + dx, 0, 1 - item.w), y: clamp(item.y + dy, 0, 1 - h) })
    } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault()
      const grow = e.key === '+' || e.key === '=' ? 1.08 : 1 / 1.08
      onChange(item.id, { w: clamp(item.w * grow, 0.03, maxW(item.x, item.y)) })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onRemove(item.id)
    }
  }

  return (
    <div
      ref={itemRef}
      className={`sig-item ${item.kind}`}
      style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${h * 100}%` }}
      tabIndex={0}
      role="group"
      aria-label={`${item.label}. Arrow keys move, plus and minus resize, Delete removes.`}
      onPointerDown={(e) => start(e, 'move')}
      onPointerMove={moveTo}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    >
      <img src={item.url} alt="" draggable={false} />
      <button
        type="button"
        className="sig-item-x"
        aria-label={`Remove ${item.label.toLowerCase()}`}
        title="Remove"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(item.id)}
      >
        <X size={12} weight="bold" />
      </button>
      <span className="sig-item-handle" aria-hidden="true" onPointerDown={(e) => start(e, 'resize')} onPointerMove={moveTo} onPointerUp={end} onPointerCancel={end} />
    </div>
  )
}

// Freehand pad. Strokes are kept as points so they can be re-inked and
// exported crisply at a higher resolution than the screen.
function DrawPad({ ink, onChange }) {
  const canvasRef = useRef(null)
  const strokes = useRef([])
  const current = useRef(null)
  const [count, setCount] = useState(0)

  const redraw = useCallback(() => {
    const c = canvasRef.current
    if (!c || !c.clientWidth) return
    const ratio = Math.min(3, window.devicePixelRatio || 1)
    const w = Math.round(c.clientWidth * ratio)
    const h = Math.round(c.clientHeight * ratio)
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    paintStrokes(ctx, strokes.current, ink)
  }, [ink])

  useEffect(() => {
    redraw()
    const ro = new ResizeObserver(redraw)
    ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [redraw])

  useEffect(() => {
    onChange(count ? exportStrokes(strokes.current, ink) : null)
  }, [count, ink, onChange])

  function point(e, prev) {
    const r = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const t = e.timeStamp
    let w
    if (e.pointerType === 'pen' && e.pressure > 0) w = 1 + e.pressure * 3.2
    else if (!prev) w = 2.6
    else {
      const v = Math.hypot(x - prev.x, y - prev.y) / Math.max(1, t - prev.t)
      w = prev.w * 0.65 + clamp(3.6 - v * 1.4, 1.3, 3.6) * 0.35
    }
    return { x, y, t, w }
  }

  return (
    <div className="sig-draw">
      <div className="sig-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="sig-canvas"
          aria-label="Signature drawing area. Draw with a mouse, finger or pen."
          role="img"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            current.current = [point(e)]
            strokes.current.push(current.current)
            redraw()
          }}
          onPointerMove={(e) => {
            const s = current.current
            if (!s) return
            const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]
            for (const ev of events) {
              const p = point(ev, s[s.length - 1])
              if (Math.hypot(p.x - s[s.length - 1].x, p.y - s[s.length - 1].y) > 0.8) s.push(p)
            }
            redraw()
          }}
          onPointerUp={() => {
            if (!current.current) return
            current.current = null
            setCount(strokes.current.length)
          }}
          onPointerCancel={() => {
            current.current = null
            setCount(strokes.current.length)
          }}
        />
        <span className="sig-baseline" aria-hidden="true" />
        {!count && <span className="sig-placeholder">Sign here</span>}
      </div>
      <div className="sig-pane-foot">
        <span className="sig-muted">Use a mouse, trackpad, finger or pen.</span>
        <div className="sig-pad-actions">
          <button
            type="button"
            className="btn ghost small"
            disabled={!count}
            onClick={() => {
              strokes.current.pop()
              redraw()
              setCount(strokes.current.length)
            }}
          >
            <ArrowCounterClockwise size={15} />
            Undo
          </button>
          <button
            type="button"
            className="btn ghost small"
            disabled={!count}
            onClick={() => {
              strokes.current = []
              redraw()
              setCount(0)
            }}
          >
            <Eraser size={15} />
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

// Draws each stroke as a chain of quadratic curves through segment midpoints,
// so lines stay smooth and the width can vary along the stroke.
function paintStrokes(ctx, strokes, color) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath()
      ctx.arc(s[0].x, s[0].y, s[0].w / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    for (let i = 0; i < s.length - 1; i++) {
      const from = i === 0 ? s[0] : mid(s[i - 1], s[i])
      const to = i === s.length - 2 ? s[i + 1] : mid(s[i], s[i + 1])
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(s[i].x, s[i].y, to.x, to.y)
      ctx.lineWidth = i === 0 ? s[0].w : (s[i].w + s[i + 1].w) / 2
      ctx.stroke()
    }
  }
}

function exportStrokes(strokes, color, scale = 3) {
  const pts = strokes.flat()
  const pad = 4 + Math.max(...pts.map((p) => p.w))
  const minX = Math.min(...pts.map((p) => p.x)) - pad
  const minY = Math.min(...pts.map((p) => p.y)) - pad
  const w = Math.max(...pts.map((p) => p.x)) + pad - minX
  const h = Math.max(...pts.map((p) => p.y)) + pad - minY
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * scale)
  canvas.height = Math.ceil(h * scale)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale)
  paintStrokes(ctx, strokes, color)
  return { url: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height }
}

function TypePad({ ink, onChange }) {
  const [text, setText] = useState('')
  const [font, setFont] = useState('flowing')
  const name = text.trim()

  useEffect(() => {
    onChange(name ? textToPng(name, FONTS[font].family, ink) : null)
  }, [name, font, ink, onChange])

  return (
    <div className="sig-type">
      <label className="field-label" htmlFor="sig-name">
        Your name
      </label>
      <input id="sig-name" className="input sig-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your name" autoComplete="name" maxLength={60} />
      <div className="sig-fonts" role="radiogroup" aria-label="Signature style">
        {Object.entries(FONTS).map(([key, f]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={font === key}
            className={`sig-font${font === key ? ' on' : ''}`}
            onClick={() => setFont(key)}
          >
            <span className="sig-font-sample" style={{ fontFamily: f.family, color: ink }}>
              {name || 'Your name'}
            </span>
            <span className="sig-font-label">{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Turns near-white pixels transparent, with a soft edge so ink stays smooth,
// then crops to what's left.
function processImage(img, clean) {
  const scale = Math.min(1, 1400 / img.naturalWidth, 1400 / img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  if (!clean) return { url: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height }

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  let minX = canvas.width
  let minY = canvas.height
  let maxX = -1
  let maxY = -1
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    if (lum > 232) px[i + 3] = 0
    else if (lum > 180) px[i + 3] = Math.round(px[i + 3] * ((232 - lum) / 52))
    if (px[i + 3] > 16) {
      const p = i / 4
      const x = p % canvas.width
      const y = (p - x) / canvas.width
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  ctx.putImageData(data, 0, 0)
  if (maxX < 0) return null
  const pad = 6
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(canvas.width - 1, maxX + pad)
  maxY = Math.min(canvas.height - 1, maxY + pad)
  const out = document.createElement('canvas')
  out.width = maxX - minX + 1
  out.height = maxY - minY + 1
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height)
  return { url: out.toDataURL('image/png'), aspect: out.width / out.height }
}

function UploadPad({ onChange }) {
  const [img, setImg] = useState(null)
  const [clean, setClean] = useState(true)
  const [error, setError] = useState('')
  const result = useMemo(() => (img ? processImage(img, clean) : null), [img, clean])

  useEffect(() => {
    onChange(result)
  }, [result, onChange])

  function load([file]) {
    if (!file) return
    setError('')
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => {
      URL.revokeObjectURL(url)
      setImg(im)
    }
    im.onerror = () => {
      URL.revokeObjectURL(url)
      setError('Couldn’t read this image. Try a PNG or JPEG.')
    }
    im.src = url
  }

  return (
    <div className="sig-upload">
      {img ? (
        <div className="sig-preview checker">{result ? <img src={result.url} alt="Uploaded signature" /> : <span className="sig-muted">Nothing left after removing the background.</span>}</div>
      ) : (
        <DropZone onFiles={load} accept="image/png,image/jpeg,image/webp,image/gif" multiple={false} compact title="Drop a photo or scan of your signature" />
      )}
      {error && (
        <p className="notice error" role="alert">
          <WarningCircle size={15} weight="fill" />
          {error}
        </p>
      )}
      <div className="sig-pane-foot">
        <label className={`check${clean ? ' on' : ''}`}>
          <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} />
          Remove white background
        </label>
        {img && (
          <button type="button" className="btn ghost small" onClick={() => setImg(null)}>
            <X size={15} />
            Use another image
          </button>
        )}
      </div>
    </div>
  )
}
