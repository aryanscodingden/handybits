import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, ArrowsLeftRight, DownloadSimple, FileZip, ImageSquare, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { downloadBlob, formatBytes } from '../lib/format.js'
import { FORMATS, dedupeNames, fitWithin, isHeic, isImageFile, outputName, percentChange, sameFormat } from '../lib/image-core.js'
import './ImageTool.css'

const uid = () => crypto.randomUUID()

const RESIZE = [
  { value: 'none', label: 'Original size' },
  { value: '3840', label: '3840 px · 4K' },
  { value: '2560', label: '2560 px' },
  { value: '1920', label: '1920 px · Full HD' },
  { value: '1280', label: '1280 px' },
  { value: '1080', label: '1080 px · Social' },
  { value: 'custom', label: 'Custom…' },
]

const DEFAULTS = { format: 'same', quality: 80, resize: 'none', custom: '1600', keepAlpha: true }

// Which formats this browser can encode. JPG and PNG always work; WebP and
// AVIF depend on the browser, and toBlob silently falls back to PNG when a
// type isn't supported, so check the type of what comes back.
async function detectEncoders() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const test = (mime) => new Promise((resolve) => canvas.toBlob((b) => resolve(b?.type === mime), mime, 0.5))
  const [webp, avif] = await Promise.all([test('image/webp'), test('image/avif')])
  return { jpeg: true, png: true, webp, avif }
}

async function decode(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    // Some browsers reject the options object; others can only decode via <img>.
    try {
      return await createImageBitmap(blob)
    } catch {
      return loadImage(blob)
    }
  }
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode'))
    }
    img.src = url
  })
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function canvasToBlob(canvas, mime, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: mime, quality })
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

// Draw `source` at width × height. Large reductions are done in halving
// steps, which looks noticeably sharper than one big jump.
function drawScaled(source, srcW, srcH, width, height, fillWhite) {
  let cur = source
  let w = srcW
  let h = srcH
  while (w / 2 >= width && h / 2 >= height) {
    const nw = Math.round(w / 2)
    const nh = Math.round(h / 2)
    const step = makeCanvas(nw, nh)
    const sctx = step.getContext('2d')
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(cur, 0, 0, nw, nh)
    cur = step
    w = nw
    h = nh
  }
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (fillWhite) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, width, height)
  return canvas
}

// Turn the dropped file into something the browser can draw. HEIC only
// decodes natively in Safari, so other browsers convert it with heic2any.
async function prepare(file) {
  if (!isHeic(file)) return { blob: file }
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close?.()
    return { blob: file }
  } catch {
    // Not natively supported; fall through to heic2any.
  }
  try {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 })
    return { blob: Array.isArray(out) ? out[0] : out }
  } catch (err) {
    console.error(err)
    throw new ReadError('Couldn’t read this HEIC photo.')
  }
}

class ReadError extends Error {}

function resolveFormat(file, choice, encoders) {
  let key = choice === 'same' ? sameFormat(file) : choice
  if (!encoders[key]) key = encoders.webp && key === 'avif' ? 'webp' : 'jpeg'
  return key
}

function maxEdgeOf(opts) {
  if (opts.resize === 'none') return 0
  const n = parseInt(opts.resize === 'custom' ? opts.custom : opts.resize, 10)
  return Number.isFinite(n) && n >= 16 ? n : 0
}

async function compress(item, opts, encoders) {
  let prep = null
  let source = item.source
  if (!source) {
    const { blob } = await prepare(item.file)
    source = blob
    prep = { source: blob, srcUrl: URL.createObjectURL(blob) }
  }
  let bitmap
  try {
    bitmap = await decode(source)
  } catch {
    throw new ReadError(isHeic(item.file) ? 'Couldn’t read this HEIC photo.' : 'Couldn’t read this image.')
  }
  const srcW = bitmap.width
  const srcH = bitmap.height
  const format = resolveFormat(item.file, opts.format, encoders)
  const f = FORMATS[format]
  const { width, height } = fitWithin(srcW, srcH, maxEdgeOf(opts))
  const canvas = drawScaled(bitmap, srcW, srcH, width, height, !f.alpha || !opts.keepAlpha)
  bitmap.close?.()
  const blob = await canvasToBlob(canvas, f.mime, f.lossy ? opts.quality / 100 : undefined)
  if (!blob || blob.type !== f.mime) throw new Error(`This browser can’t save ${f.label} files.`)
  return { prep: { ...prep, srcW, srcH }, out: { blob, url: URL.createObjectURL(blob), width, height, format } }
}

export default function ImageTool() {
  const [items, setItems] = useState([])
  const [options, setOptions] = useState(DEFAULTS)
  const [encoders, setEncoders] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [zipping, setZipping] = useState(false)
  const [rejected, setRejected] = useState(0)

  // The item list lives in a ref so the async worker always sees the latest
  // version; every change goes through commit(), which mirrors it into state.
  const itemsRef = useRef(items)
  const appliedRef = useRef(DEFAULTS)
  const encodersRef = useRef(null)
  const busy = useRef(false)

  const commit = useCallback((fn) => {
    itemsRef.current = fn(itemsRef.current)
    setItems(itemsRef.current)
  }, [])

  // Sequential worker: compress queued items one at a time. If the options
  // change mid-job, the result is thrown away and the item runs again.
  const pump = useCallback(async () => {
    if (busy.current || !encodersRef.current) return
    busy.current = true
    try {
      for (;;) {
        const next = itemsRef.current.find((x) => x.status === 'queued')
        if (!next) break
        const opts = appliedRef.current
        commit((list) => list.map((x) => (x.id === next.id ? { ...x, status: 'working' } : x)))
        try {
          const { prep, out } = await compress(next, opts, encodersRef.current)
          const target = itemsRef.current.find((x) => x.id === next.id)
          if (!target) {
            if (prep.srcUrl) URL.revokeObjectURL(prep.srcUrl)
            URL.revokeObjectURL(out.url)
            continue
          }
          const keep = opts === appliedRef.current && target.status === 'working'
          if (!keep) URL.revokeObjectURL(out.url)
          else if (target.out) URL.revokeObjectURL(target.out.url)
          commit((list) =>
            list.map((x) => {
              if (x.id !== next.id) return x
              const merged = { ...x, ...prep }
              return keep ? { ...merged, status: 'done', error: null, out } : merged
            }),
          )
        } catch (err) {
          console.error(err)
          const readError = err instanceof ReadError
          commit((list) =>
            list.map((x) =>
              x.id === next.id && x.status === 'working' ? { ...x, status: 'error', readError, error: err.message || 'Couldn’t compress this image.' } : x,
            ),
          )
        }
      }
    } finally {
      busy.current = false
    }
  }, [commit])

  useEffect(() => {
    const fallback = { jpeg: true, png: true, webp: false, avif: false }
    detectEncoders()
      .catch(() => fallback)
      .then((found) => {
        encodersRef.current = found
        setEncoders(found)
        pump()
      })
  }, [pump])

  // Free every object URL when leaving the tool.
  useEffect(
    () => () => {
      for (const x of itemsRef.current) {
        if (x.srcUrl) URL.revokeObjectURL(x.srcUrl)
        if (x.out) URL.revokeObjectURL(x.out.url)
      }
      // A job still in flight will find nothing to update and clean up after itself.
      itemsRef.current = []
    },
    [],
  )

  // Options settle for a moment before re-running, so dragging the quality
  // slider doesn't queue dozens of jobs.
  useEffect(() => {
    if (options === appliedRef.current) return
    const t = setTimeout(() => {
      appliedRef.current = options
      commit((list) => list.map((x) => (x.status === 'done' || x.status === 'working' || (x.status === 'error' && !x.readError) ? { ...x, status: 'queued' } : x)))
      pump()
    }, 350)
    return () => clearTimeout(t)
  }, [options, commit, pump])

  const addFiles = useCallback(
    (files) => {
      const images = files.filter(isImageFile)
      setRejected(files.length - images.length)
      if (!images.length) return
      commit((list) => [
        ...list,
        ...images.map((file) => ({ id: uid(), file, status: 'queued', source: null, srcUrl: null, out: null, keepOriginal: false })),
      ])
      pump()
    },
    [commit, pump],
  )

  function remove(id) {
    const item = items.find((x) => x.id === id)
    if (item?.srcUrl) URL.revokeObjectURL(item.srcUrl)
    if (item?.out) URL.revokeObjectURL(item.out.url)
    commit((list) => list.filter((x) => x.id !== id))
  }

  function clearAll() {
    for (const x of items) {
      if (x.srcUrl) URL.revokeObjectURL(x.srcUrl)
      if (x.out) URL.revokeObjectURL(x.out.url)
    }
    commit(() => [])
    setSelectedId(null)
    setRejected(0)
  }

  const setKeep = (id, keepOriginal) => commit((list) => list.map((x) => (x.id === id ? { ...x, keepOriginal } : x)))
  const set = (patch) => setOptions((o) => ({ ...o, ...patch }))

  // What each finished row hands out: the new file, or the original if the
  // user chose to keep it. Names are deduped across the whole batch.
  const results = useMemo(() => {
    const ready = items.filter((x) => x.out)
    const names = dedupeNames(ready.map((x) => (x.keepOriginal ? x.file.name : outputName(x.file.name, x.out.format))))
    const map = new Map()
    ready.forEach((x, i) => map.set(x.id, { name: names[i], blob: x.keepOriginal ? x.file : x.out.blob }))
    return map
  }, [items])

  const done = items.filter((x) => x.out)
  const pending = items.filter((x) => x.status === 'queued' || x.status === 'working').length
  const before = done.reduce((n, x) => n + x.file.size, 0)
  const after = done.reduce((n, x) => n + results.get(x.id).blob.size, 0)
  const selected = items.find((x) => x.id === selectedId && x.out) || done[0] || null

  async function downloadAll() {
    if (!done.length || zipping) return
    setZipping(true)
    try {
      const { zipSync } = await import('fflate')
      const entries = {}
      for (const x of done) {
        const r = results.get(x.id)
        entries[r.name] = [new Uint8Array(await r.blob.arrayBuffer()), { level: 0 }]
      }
      downloadBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), 'compressed-images.zip')
    } finally {
      setZipping(false)
    }
  }

  const fmt = options.format
  const qualityOff = fmt === 'png'
  const formatChoices = ['same', 'jpeg', 'png', 'webp', 'avif'].filter((k) => k === 'same' || !encoders || encoders[k])

  return (
    <div className="tool img-tool">
      <header className="header">
        <h1 className="title">Compress images</h1>
        <p className="lede">Shrink, resize and convert photos, including HEIC from iPhones. Everything runs in your browser, so nothing is uploaded.</p>
      </header>

      <DropZone
        onFiles={addFiles}
        accept="image/*,.heic,.heif"
        compact={items.length > 0}
        title={items.length ? 'Add more images' : 'Drop images here or click to browse'}
        sub="JPG, PNG, WebP, AVIF, GIF and HEIC. Add as many as you like."
        button="Choose images"
      />
      {rejected > 0 && (
        <p className="notice error img-notice" role="status">
          <WarningCircle size={16} weight="fill" />
          {rejected === 1 ? 'One file wasn’t an image and was skipped.' : `${rejected} files weren’t images and were skipped.`}
        </p>
      )}

      <section className="panel img-options" aria-label="Output options">
        <div className="img-field">
          <span className="field-label" id="img-format-label">
            Output format
          </span>
          <div className="segmented img-seg" role="radiogroup" aria-labelledby="img-format-label">
            {formatChoices.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={fmt === k} className={fmt === k ? 'on' : ''} onClick={() => set({ format: k })}>
                {k === 'same' ? 'Same as original' : FORMATS[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="img-grid">
          <div className={`img-field${qualityOff ? ' off' : ''}`}>
            <label className="field-label img-label-row" htmlFor="img-quality">
              Quality
              <output className="img-value" htmlFor="img-quality">
                {qualityOff ? 'Lossless' : options.quality}
              </output>
            </label>
            <input
              id="img-quality"
              className="img-range"
              type="range"
              min="10"
              max="100"
              step="1"
              value={options.quality}
              disabled={qualityOff}
              onChange={(e) => set({ quality: Number(e.target.value) })}
              style={{ '--fill': `${((options.quality - 10) / 90) * 100}%` }}
            />
            <span className="img-hint">{qualityOff ? 'PNG is lossless, so quality doesn’t apply.' : fmt === 'same' ? 'Applies to JPG, WebP and AVIF. 70–85 is a good balance.' : '70–85 is a good balance of size and detail.'}</span>
          </div>

          <div className="img-field">
            <label className="field-label" htmlFor="img-resize">
              Resize
            </label>
            <div className="img-resize">
              <select id="img-resize" className="img-select" value={options.resize} onChange={(e) => set({ resize: e.target.value })}>
                {RESIZE.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              {options.resize === 'custom' && (
                <span className="img-custom">
                  <input
                    className="img-number"
                    type="number"
                    min="16"
                    max="20000"
                    inputMode="numeric"
                    aria-label="Maximum width or height in pixels"
                    value={options.custom}
                    onChange={(e) => set({ custom: e.target.value })}
                  />
                  <span aria-hidden="true">px</span>
                </span>
              )}
            </div>
            <span className="img-hint">Longest side. Smaller images are never enlarged.</span>
          </div>
        </div>

        <label className={`check img-check${options.keepAlpha && fmt !== 'jpeg' ? ' on' : ''}`}>
          <input type="checkbox" checked={options.keepAlpha && fmt !== 'jpeg'} disabled={fmt === 'jpeg'} onChange={(e) => set({ keepAlpha: e.target.checked })} />
          Keep transparency
          <span className="img-check-note">{fmt === 'jpeg' ? 'JPG can’t store it, so transparent areas turn white' : 'Otherwise transparent areas turn white'}</span>
        </label>
      </section>

      {items.length > 0 && (
        <section className="section" aria-label="Images">
          <div className="section-head img-head">
            <h2>
              Images
              <span className="count">{items.length}</span>
            </h2>
            <div className="actions img-actions">
              <button type="button" className="btn ghost small" onClick={clearAll}>
                Clear
              </button>
              <button type="button" className={`btn small primary${zipping ? ' loading' : ''}`} onClick={downloadAll} disabled={!done.length || zipping || pending > 0}>
                {zipping ? <span className="spinner" aria-hidden="true" /> : <FileZip size={15} weight="bold" />}
                Download all
              </button>
            </div>
          </div>

          <p className="img-summary" aria-live="polite">
            {pending > 0 ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span>
                  Compressing {items.length - pending + 1} of {items.length}…
                </span>
              </>
            ) : done.length === 0 ? (
              'Nothing could be compressed.'
            ) : after === before ? (
              <span>
                {done.length === 1 ? 'Same size as the original' : 'Same total size as the originals'}
              </span>
            ) : after < before ? (
              <>
                <span>
                  Saved <strong>{formatBytes(before - after)}</strong> across {done.length} {done.length === 1 ? 'image' : 'images'}
                </span>
                <span className="img-summary-detail">
                  {formatBytes(before)} → {formatBytes(after)}
                </span>
              </>
            ) : (
              <>
                <span>The new files are {formatBytes(after - before)} larger in total</span>
                <span className="img-summary-detail">Try a lower quality or a different format</span>
              </>
            )}
          </p>

          {selected && <Compare item={selected} />}

          <ul className="rows img-rows">
            {items.map((item) => (
              <ImageRow
                key={item.id}
                item={item}
                result={results.get(item.id)}
                selected={selected?.id === item.id}
                onSelect={() => setSelectedId(item.id)}
                onRemove={() => remove(item.id)}
                onKeep={(v) => setKeep(item.id, v)}
              />
            ))}
          </ul>
        </section>
      )}

      <footer className="footer">Images are decoded and re-encoded by your browser. Nothing leaves this device, and files are gone when you close the tab.</footer>
    </div>
  )
}

function ImageRow({ item, result, selected, onSelect, onRemove, onKeep }) {
  const { file, out, status, error, keepOriginal } = item
  const change = out ? percentChange(file.size, out.blob.size) : 0
  const bigger = out && change >= 0
  const working = status === 'queued' || status === 'working'

  return (
    <li className={`row img-row${status === 'error' ? ' failed' : ''}${selected ? ' selected' : ''}`}>
      <button type="button" className="img-thumb" onClick={onSelect} disabled={!out} aria-label={`Compare ${file.name}`} aria-pressed={selected}>
        {item.srcUrl ? <img src={item.srcUrl} alt="" loading="lazy" decoding="async" /> : <ImageSquare size={20} weight="duotone" aria-hidden="true" />}
      </button>
      <div className="row-main">
        <span className="name" title={file.name}>
          {result?.name || file.name}
        </span>
        {status === 'error' ? (
          <span className="error">
            <WarningCircle size={14} weight="fill" />
            {error}
          </span>
        ) : out ? (
          <span className="meta">
            {formatBytes(file.size)} → {formatBytes(out.blob.size)}
            {!keepOriginal && (
              <>
                {' '}
                <span className={`img-badge${bigger ? ' worse' : ''}`}>{bigger ? `+${change}%` : `−${Math.abs(change)}%`}</span>
              </>
            )}
            {' · '}
            {out.width}×{out.height}
            {keepOriginal && <> · keeping original</>}
          </span>
        ) : (
          <span className="meta">
            {formatBytes(file.size)} · {isHeic(file) && !item.source ? 'Reading HEIC…' : 'Waiting…'}
          </span>
        )}
      </div>
      <div className="row-actions">
        {working && out && <span className="status converting">Updating…</span>}
        {working && !out && <span className="spinner img-row-spinner" aria-label="Working" />}
        {out && bigger && !keepOriginal && (
          <button type="button" className="btn ghost small" onClick={() => onKeep(true)}>
            Keep original
          </button>
        )}
        {out && keepOriginal && (
          <button type="button" className="btn ghost small" onClick={() => onKeep(false)}>
            <ArrowCounterClockwise size={15} />
            Use new
          </button>
        )}
        {out && (
          <button type="button" className="btn ghost small img-compare-btn" onClick={onSelect} aria-pressed={selected}>
            <ArrowsLeftRight size={15} />
            Compare
          </button>
        )}
        {out && result && (
          <button type="button" className="btn small" onClick={() => downloadBlob(result.blob, result.name)}>
            <DownloadSimple size={15} weight="bold" />
            Download
          </button>
        )}
        <button type="button" className="icon" aria-label={`Remove ${file.name}`} title="Remove" onClick={onRemove}>
          <X size={16} />
        </button>
      </div>
    </li>
  )
}

// Before/after slider. Original on the left of the divider, new file on the
// right. Drag anywhere, or focus the divider and use the arrow keys.
function Compare({ item }) {
  const [pos, setPos] = useState(50)
  const frame = useRef(null)
  const dragging = useRef(false)
  const { out } = item
  const w = item.srcW || out.width
  const h = item.srcH || out.height

  const moveTo = (clientX) => {
    const rect = frame.current.getBoundingClientRect()
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }

  const onKeyDown = (e) => {
    const step = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown' ? 10 : 2
    const keys = {
      ArrowLeft: pos - step,
      ArrowDown: pos - step,
      PageDown: pos - step,
      ArrowRight: pos + step,
      ArrowUp: pos + step,
      PageUp: pos + step,
      Home: 0,
      End: 100,
    }
    if (e.key in keys) {
      e.preventDefault()
      setPos(Math.min(100, Math.max(0, keys[e.key])))
    }
  }

  return (
    <figure className="img-compare">
      <div
        ref={frame}
        className="img-compare-frame"
        style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, ${Math.round((460 * w) / h)}px)`, '--pos': `${pos}%` }}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          moveTo(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <img className="img-compare-after" src={out.url} alt={`Compressed ${item.file.name}`} draggable="false" />
        {item.srcUrl && <img className="img-compare-before" src={item.srcUrl} alt={`Original ${item.file.name}`} draggable="false" />}
        <span className="img-compare-tag left">Original · {formatBytes(item.file.size)}</span>
        <span className="img-compare-tag right">
          {FORMATS[out.format].label} · {formatBytes(out.blob.size)}
        </span>
        <div
          className="img-compare-handle"
          role="slider"
          tabIndex={0}
          aria-label="Comparison divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(pos)}% original`}
          onKeyDown={onKeyDown}
        >
          <span className="img-compare-knob" aria-hidden="true">
            <ArrowsLeftRight size={14} weight="bold" />
          </span>
        </div>
      </div>
      <figcaption className="img-compare-caption">
        <span className="name">{item.file.name}</span>
        <span className="meta">
          {w}×{h} → {out.width}×{out.height}
        </span>
      </figcaption>
    </figure>
  )
}
