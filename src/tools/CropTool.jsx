import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsClockwise,
  CornersOut,
  DownloadSimple,
  FlipHorizontal,
  FlipVertical,
  Info,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  WarningCircle,
} from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { downloadBlob, formatBytes } from '../lib/format.js'
import { baseOf, isHeic } from '../lib/image-core.js'
import { PRESETS, clamp, fitAspect, flipRectH, flipRectV, moveRect, outputSize, reshape, resizeRect, rotateRect } from '../lib/crop-core.js'
import { exportCrop, renderPreview, workingSize } from '../lib/crop-render.js'
import './CropTool.css'

const PAD = 14
const MAX_ZOOM = 8
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const FORMATS = {
  jpeg: { label: 'JPG', mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
  png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false, alpha: true },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
}
const NO_TRANSFORM = { rot: 0, flipH: false, flipV: false, angle: 0 }

const isImage = (f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name || '')

function canEncodeWebp() {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    return c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

// A tiny rectangle showing a preset's shape.
function AspectIcon({ preset }) {
  let w = 16
  let h = 16
  if (preset.w) {
    const a = preset.w / preset.h
    if (a >= 1) h = Math.max(4, 16 / a)
    else w = Math.max(4, 16 * a)
  }
  const cls = `crop-shape${preset.circle ? ' circle' : ''}${preset.id === 'free' ? ' free' : ''}${preset.id === 'custom' ? ' custom' : ''}`
  return (
    <span className="crop-shape-box" aria-hidden="true">
      <span className={cls} style={{ width: w, height: h }} />
    </span>
  )
}

export default function CropTool() {
  const [src, setSrc] = useState(null) // { file, name, bitmap, sw, sh, gif }
  const [error, setError] = useState(null)
  const [t, setT] = useState(NO_TRANSFORM)
  const [presetId, setPresetId] = useState('free')
  const [custom, setCustom] = useState({ w: 1200, h: 800 })
  const [crop, setCrop] = useState(null)
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 })
  const [box, setBox] = useState({ w: 0, vh: 800 })
  const [dragging, setDragging] = useState(false)
  const [format, setFormat] = useState('jpeg')
  const [quality, setQuality] = useState(90)
  const [circle, setCircle] = useState(true)
  const [noUpscale, setNoUpscale] = useState(false)
  const [estimate, setEstimate] = useState(null) // { key, blob }
  const [exporting, setExporting] = useState(false)

  const wrapRef = useRef(null)
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const pointers = useRef(new Map())
  const live = useRef({})
  const kbTimer = useRef(0)
  const webp = useMemo(() => canEncodeWebp(), [])

  const preset = PRESETS.find((p) => p.id === presetId)
  const target = preset.id === 'custom' ? custom : preset.w ? { w: preset.w, h: preset.h } : null
  const aspect = target && target.w > 0 && target.h > 0 ? target.w / target.h : 0
  const circleOn = !!preset.circle && circle

  // Image loading.
  const addFiles = useCallback((files) => {
    const file = files.find(isImage)
    setError(null)
    if (!file) {
      setError('Use a JPG, PNG, WebP or GIF image.')
      return
    }
    if (isHeic(file)) {
      setError('heic')
      return
    }
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((bitmap) => {
        setSrc((old) => {
          old?.bitmap.close?.()
          return { file, name: file.name || 'image', bitmap, sw: bitmap.width, sh: bitmap.height, gif: /gif$/i.test(file.type) || /\.gif$/i.test(file.name) }
        })
        setT(NO_TRANSFORM)
        setView({ zoom: 1, panX: 0, panY: 0 })
        setCrop(null)
        setEstimate(null)
        if (/png|webp|gif/i.test(file.type)) setFormat((f) => (f === 'jpeg' ? 'png' : f))
      })
      .catch(() => setError('This image couldn’t be opened. It may be damaged or in a format the browser can’t read.'))
  }, [])

  useEffect(() => () => live.current.src?.bitmap.close?.(), [])

  // Paste an image.
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter(isImage)
      if (!files.length || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return
      e.preventDefault()
      addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  const size = src ? workingSize(src.sw, src.sh, t.rot) : null
  const W = size?.W || 1
  const H = size?.H || 1

  // Stage size follows the container width and the image's shape.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, vh: window.innerHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [src])

  const stageW = box.w
  const stageH = Math.round(clamp(stageW * (H / W) + PAD * 2, 260, Math.max(300, Math.min(600, box.vh * 0.62))))
  const fit = stageW ? Math.min((stageW - PAD * 2) / W, (stageH - PAD * 2) / H) : 1
  const scale = fit * view.zoom
  const imgLeft = (stageW - W * scale) / 2 + view.panX
  const imgTop = (stageH - H * scale) / 2 + view.panY

  // Initial crop and preset changes.
  useEffect(() => {
    if (src && !crop) setCrop(fitAspect(W, H, aspect, aspect ? 1 : 0.9))
  }, [src, crop, W, H, aspect])

  useEffect(() => {
    if (src) renderToStage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, t])

  function renderToStage() {
    const c = canvasRef.current
    if (!c) return
    const preview = renderPreview(src.bitmap, t)
    c.width = preview.width
    c.height = preview.height
    c.getContext('2d').drawImage(preview, 0, 0)
    preview.width = preview.height = 0
  }

  function choosePreset(p) {
    setPresetId(p.id)
    setNoUpscale(false)
    if (!src || !crop) return
    if (p.id === 'custom') {
      setCustom({ w: Math.max(1, Math.round(crop.w)), h: Math.max(1, Math.round(crop.h)) })
      return
    }
    if (p.w) setCrop(fitAspect(W, H, p.w / p.h, 1))
  }

  function setCustomSize(key, value) {
    const v = clamp(Math.round(Number(value) || 0), 0, 10000)
    const next = { ...custom, [key]: v }
    setCustom(next)
    if (next.w > 0 && next.h > 0 && crop) setCrop(reshape(crop, next.w / next.h, W, H))
  }

  // Transforms.
  function rotate(dir) {
    if (!crop) return
    const mirrored = t.flipH !== t.flipV
    setT((o) => ({ ...o, rot: (o.rot + (mirrored ? -dir : dir) * 90 + 360) % 360 }))
    const turned = rotateRect(crop, dir, W, H)
    setCrop(aspect ? reshape(turned, aspect, H, W) : turned)
    setView({ zoom: 1, panX: 0, panY: 0 })
  }
  function flip(axis) {
    if (!crop) return
    setT((o) => (axis === 'h' ? { ...o, flipH: !o.flipH, angle: -o.angle } : { ...o, flipV: !o.flipV, angle: -o.angle }))
    setCrop(axis === 'h' ? flipRectH(crop, W) : flipRectV(crop, H))
  }

  // Zoom around a stage point.
  function zoomTo(z, sx = stageW / 2, sy = stageH / 2) {
    const zoom = clamp(z, 1, MAX_ZOOM)
    const s2 = fit * zoom
    const px = (sx - imgLeft) / scale
    const py = (sy - imgTop) / scale
    setView(clampView({ zoom, panX: sx - px * s2 - (stageW - W * s2) / 2, panY: sy - py * s2 - (stageH - H * s2) / 2 }))
  }
  function clampView(v) {
    const s = fit * v.zoom
    const mx = Math.max(0, (W * s - (stageW - PAD * 2)) / 2)
    const my = Math.max(0, (H * s - (stageH - PAD * 2)) / 2)
    return { zoom: v.zoom, panX: clamp(v.panX, -mx, mx), panY: clamp(v.panY, -my, my) }
  }

  live.current = { src, crop, W, H, aspect, scale, imgLeft, imgTop, view, fit, stageW, stageH, zoomTo, clampView }

  // Wheel zoom needs a non-passive listener.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const L = live.current
      L.zoomTo(L.view.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src])

  // Pointer interaction: move, resize, pan, pinch.
  function stagePoint(e) {
    const r = stageRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e) {
    if (!crop || (e.pointerType === 'mouse' && e.button !== 0)) return
    stageRef.current.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, stagePoint(e))
    const L = live.current
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      dragRef.current = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: L.view.zoom }
      return
    }
    const p = stagePoint(e)
    const mode = e.target.dataset.handle || (e.target.closest('.crop-box') ? 'move' : 'pan')
    dragRef.current = { mode, start: { ...crop }, px: p.x, py: p.y, view: { ...L.view } }
    setDragging(true)
    e.preventDefault()
  }

  function onPointerMove(e) {
    const d = dragRef.current
    if (!d || !pointers.current.has(e.pointerId)) return
    const p = stagePoint(e)
    pointers.current.set(e.pointerId, p)
    const L = live.current
    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      L.zoomTo(d.zoom * (dist / d.dist), (a.x + b.x) / 2, (a.y + b.y) / 2)
      return
    }
    const dx = (p.x - d.px) / L.scale
    const dy = (p.y - d.py) / L.scale
    if (d.mode === 'move') setCrop(moveRect(d.start, dx, dy, L.W, L.H))
    else if (d.mode === 'pan') setView(L.clampView({ ...d.view, panX: d.view.panX + p.x - d.px, panY: d.view.panY + p.y - d.py }))
    else {
      const ix = (p.x - L.imgLeft) / L.scale
      const iy = (p.y - L.imgTop) / L.scale
      setCrop(resizeRect(d.start, d.mode, ix, iy, { W: L.W, H: L.H, aspect: L.aspect, min: Math.min(24 / L.scale, L.W, L.H) }))
    }
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      dragRef.current = null
      setDragging(false)
    } else if (dragRef.current?.mode === 'pinch') {
      // One finger left after a pinch: carry on as a pan from here.
      const [p] = [...pointers.current.values()]
      dragRef.current = { mode: 'pan', px: p.x, py: p.y, view: { ...live.current.view } }
    }
  }

  function onKeyDown(e) {
    if (!crop) return
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (e.key === '+' || e.key === '=') return (e.preventDefault(), zoomTo(view.zoom * 1.25))
    if (e.key === '-') return (e.preventDefault(), zoomTo(view.zoom / 1.25))
    if (e.key === '0') return (e.preventDefault(), setView({ zoom: 1, panX: 0, panY: 0 }))
    const dir = dirs[e.key]
    if (!dir) return
    e.preventDefault()
    const step = Math.max(1, (e.shiftKey ? 10 : 1) / scale)
    if (e.altKey) {
      // Alt + arrows resize from the bottom-right corner.
      const grow = dir[0] + dir[1]
      const dw = aspect ? grow * step : dir[0] * step
      const dh = aspect ? (grow * step) / aspect : dir[1] * step
      setCrop(resizeRect(crop, 'se', crop.x + crop.w + dw, crop.y + crop.h + dh, { W, H, aspect, min: Math.min(24 / scale, W, H) }))
    } else {
      setCrop(moveRect(crop, dir[0] * step, dir[1] * step, W, H))
    }
    setDragging(true)
    clearTimeout(kbTimer.current)
    kbTimer.current = setTimeout(() => setDragging(false), 700)
  }

  // Output.
  const out = crop ? outputSize(crop, target && target.w > 0 && target.h > 0 ? target : null, noUpscale) : null
  const fmtKey = circleOn && !FORMATS[format].alpha ? 'png' : format
  const fmt = FORMATS[fmtKey]
  const exportKey = crop && out ? JSON.stringify([t, Math.round(crop.x), Math.round(crop.y), Math.round(crop.w), Math.round(crop.h), out.width, out.height, fmtKey, quality, circleOn]) : ''
  const tooBig = out && out.width * out.height > 100_000_000

  function exportOptions() {
    return { width: out.width, height: out.height, mime: fmt.mime, quality: quality / 100, circle: circleOn, dpi: preset.dpi || 0 }
  }

  useEffect(() => {
    if (!src || !crop || !out || dragging || tooBig) return
    let cancelled = false
    const id = setTimeout(() => {
      exportCrop(src.bitmap, t, crop, exportOptions())
        .then((blob) => !cancelled && setEstimate({ key: exportKey, blob }))
        .catch(() => {})
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportKey, dragging])

  async function download() {
    if (!src || !crop || !out) return
    setExporting(true)
    setError(null)
    try {
      const blob = estimate?.key === exportKey ? estimate.blob : await exportCrop(src.bitmap, t, crop, exportOptions())
      const suffix = preset.id === 'free' ? 'cropped' : preset.id === 'custom' ? `${out.width}x${out.height}` : preset.id
      downloadBlob(blob, `${baseOf(src.name)}-${suffix}.${fmt.ext}`)
    } catch {
      setError('Couldn’t create the image. Try a smaller size.')
    }
    setExporting(false)
  }

  function reset() {
    setT(NO_TRANSFORM)
    setView({ zoom: 1, panX: 0, panY: 0 })
    const { W: w0, H: h0 } = workingSize(src.sw, src.sh, 0)
    setCrop(fitAspect(w0, h0, aspect, aspect ? 1 : 0.9))
  }

  const estimateFresh = estimate?.key === exportKey
  const cropStyle = crop && {
    left: imgLeft + crop.x * scale,
    top: imgTop + crop.y * scale,
    width: crop.w * scale,
    height: crop.h * scale,
  }
  const formatList = Object.entries(FORMATS).filter(([k]) => k !== 'webp' || webp)

  return (
    <div className="tool crop">
      <header className="header">
        <h1 className="title">Crop &amp; resize</h1>
        <p className="lede">Crop a photo to an exact size for Instagram, YouTube, X, LinkedIn or a passport photo. It runs in your browser, nothing is uploaded.</p>
      </header>

      {error && error !== 'heic' && (
        <p className="notice error crop-gap" role="alert">
          <WarningCircle size={15} weight="fill" />
          {error}
        </p>
      )}
      {error === 'heic' && (
        <p className="notice error crop-gap" role="alert">
          <WarningCircle size={15} weight="fill" />
          <span>
            HEIC photos can’t be opened here. Convert it to JPG with <a href="#/images">Compress images</a> first, then crop the JPG.
          </span>
        </p>
      )}

      {!src ? (
        <DropZone
          onFiles={addFiles}
          accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif"
          multiple={false}
          title="Drop an image here or click to browse"
          sub="JPG, PNG, WebP or GIF (first frame). You can also paste an image."
          button="Choose an image"
        />
      ) : (
        <>
          <div className="crop-file">
            <div className="crop-file-text">
              <span className="name">{src.name}</span>
              <span className="meta">
                {src.sw} × {src.sh} · {formatBytes(src.file.size)}
                {src.gif && ' · first frame only'}
              </span>
            </div>
            <label className="btn small">
              Change image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif"
                hidden
                onChange={(e) => {
                  const files = [...e.target.files]
                  e.target.value = ''
                  if (files.length) addFiles(files)
                }}
              />
            </label>
          </div>

          <section className="crop-section" aria-label="Size">
            <span className="field-label" id="crop-presets">
              Size
            </span>
            <div className="crop-presets" role="radiogroup" aria-labelledby="crop-presets">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={presetId === p.id} className={`crop-preset${presetId === p.id ? ' on' : ''}`} onClick={() => choosePreset(p)} title={p.note}>
                  <AspectIcon preset={p} />
                  <span className="crop-preset-text">
                    <span className="crop-preset-label">{p.label}</span>
                    <span className="crop-preset-detail">{p.detail}</span>
                  </span>
                </button>
              ))}
            </div>
            {preset.id === 'custom' && (
              <div className="crop-custom">
                <label>
                  <span className="field-label">Width</span>
                  <input className="input crop-num" type="number" min="1" max="10000" inputMode="numeric" value={custom.w || ''} onChange={(e) => setCustomSize('w', e.target.value)} />
                </label>
                <span className="crop-times" aria-hidden="true">
                  ×
                </span>
                <label>
                  <span className="field-label">Height</span>
                  <input className="input crop-num" type="number" min="1" max="10000" inputMode="numeric" value={custom.h || ''} onChange={(e) => setCustomSize('h', e.target.value)} />
                </label>
                <span className="meta crop-px">pixels</span>
              </div>
            )}
            {preset.note && preset.id !== 'free' && (
              <p className="crop-note">
                <Info size={14} aria-hidden="true" />
                {preset.id === 'passport'
                  ? 'Prints at 35 × 45 mm (JPGs are tagged 300 dpi). Check your country’s rules for head size and background.'
                  : preset.note + '.'}
              </p>
            )}
          </section>

          <div className="crop-stage-wrap" ref={wrapRef}>
            <div
              ref={stageRef}
              className={`crop-stage${dragging ? ' dragging' : ''}${view.zoom > 1 ? ' zoomed' : ''}`}
              style={{ height: stageH }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <canvas
                ref={canvasRef}
                className="crop-image"
                style={{ left: imgLeft, top: imgTop, width: W * scale, height: H * scale }}
                role="img"
                aria-label={`${src.name}${view.zoom > 1 ? `, zoomed to ${Math.round(view.zoom * 100)}%` : ''}`}
              />
              {crop && stageW > 0 && (
                <>
                  <span className="crop-shade" style={{ left: 0, top: 0, width: '100%', height: Math.max(0, cropStyle.top) }} aria-hidden="true" />
                  <span className="crop-shade" style={{ left: 0, top: cropStyle.top + cropStyle.height, width: '100%', bottom: 0 }} aria-hidden="true" />
                  <span className="crop-shade" style={{ left: 0, top: cropStyle.top, width: Math.max(0, cropStyle.left), height: cropStyle.height }} aria-hidden="true" />
                  <span className="crop-shade" style={{ left: cropStyle.left + cropStyle.width, top: cropStyle.top, right: 0, height: cropStyle.height }} aria-hidden="true" />
                </>
              )}
              {crop && stageW > 0 && (
                <div
                  className={`crop-box${preset.circle ? ' circle' : ''}`}
                  style={cropStyle}
                  tabIndex={0}
                  role="group"
                  aria-label={`Crop area, ${Math.round(crop.w)} by ${Math.round(crop.h)} pixels. Arrow keys move it, Shift moves further, Alt with arrows resizes, plus and minus zoom.`}
                  onKeyDown={onKeyDown}
                >
                  <span className="crop-grid" aria-hidden="true" />
                  {HANDLES.map((h) => (
                    <span key={h} className={`crop-handle h-${h}`} data-handle={h} aria-hidden="true" />
                  ))}
                  <span className="crop-size" aria-hidden="true">
                    {Math.round(crop.w)} × {Math.round(crop.h)}
                  </span>
                </div>
              )}
            </div>

            <div className="crop-toolbar" role="toolbar" aria-label="Image adjustments">
              <div className="crop-tools">
                <button type="button" className="icon" onClick={() => rotate(-1)} aria-label="Rotate left" title="Rotate left">
                  <ArrowCounterClockwise size={18} />
                </button>
                <button type="button" className="icon" onClick={() => rotate(1)} aria-label="Rotate right" title="Rotate right">
                  <ArrowClockwise size={18} />
                </button>
                <button type="button" className={`icon${t.flipH ? ' on' : ''}`} onClick={() => flip('h')} aria-label="Flip horizontally" aria-pressed={t.flipH} title="Flip horizontally">
                  <FlipHorizontal size={18} />
                </button>
                <button type="button" className={`icon${t.flipV ? ' on' : ''}`} onClick={() => flip('v')} aria-label="Flip vertically" aria-pressed={t.flipV} title="Flip vertically">
                  <FlipVertical size={18} />
                </button>
                <span className="crop-sep" aria-hidden="true" />
                <button type="button" className="icon" onClick={() => zoomTo(view.zoom / 1.25)} disabled={view.zoom <= 1} aria-label="Zoom out" title="Zoom out">
                  <MagnifyingGlassMinus size={18} />
                </button>
                <span className="crop-zoom" aria-live="polite">
                  {Math.round(view.zoom * 100)}%
                </span>
                <button type="button" className="icon" onClick={() => zoomTo(view.zoom * 1.25)} disabled={view.zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in">
                  <MagnifyingGlassPlus size={18} />
                </button>
                <button type="button" className="icon" onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })} disabled={view.zoom === 1} aria-label="Fit image" title="Fit">
                  <CornersOut size={18} />
                </button>
              </div>
              <label className="crop-straighten">
                <span className="field-label">
                  Straighten <span className="crop-value">{t.angle > 0 ? '+' : ''}{t.angle}°</span>
                </span>
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="0.5"
                  value={t.angle}
                  onChange={(e) => setT((o) => ({ ...o, angle: Number(e.target.value) }))}
                  onDoubleClick={() => setT((o) => ({ ...o, angle: 0 }))}
                />
              </label>
              <button type="button" className="btn ghost small" onClick={reset}>
                <ArrowsClockwise size={15} />
                Reset
              </button>
            </div>
            <p className="crop-hint">Drag the box or its handles. Scroll or pinch to zoom, drag outside the box to move around when zoomed. Arrow keys nudge the selected box.</p>
          </div>

          <section className="section" aria-label="Export">
            <div className="panel crop-export">
              <div className="crop-export-row">
                <div className="crop-field">
                  <span className="field-label" id="crop-format">
                    Format
                  </span>
                  <div className="segmented" role="radiogroup" aria-labelledby="crop-format">
                    {formatList.map(([key, f]) => (
                      <button key={key} type="button" role="radio" aria-checked={fmtKey === key} className={fmtKey === key ? 'on' : ''} onClick={() => setFormat(key)} disabled={circleOn && !f.alpha}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className={`crop-field crop-quality${fmt.lossy ? '' : ' off'}`}>
                  <span className="field-label">
                    Quality <span className="crop-value">{fmt.lossy ? `${quality}%` : 'Lossless'}</span>
                  </span>
                  <input type="range" min="40" max="100" value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={!fmt.lossy} />
                </label>
                {preset.circle && (
                  <label className={`check crop-circle${circle ? ' on' : ''}`}>
                    <input type="checkbox" checked={circle} onChange={(e) => setCircle(e.target.checked)} />
                    Circle with transparent corners
                  </label>
                )}
              </div>

              {out?.upscale && (
                <p className="notice error crop-warn" role="status">
                  <WarningCircle size={15} weight="fill" />
                  <span>
                    The crop is {Math.round(crop.w)} × {Math.round(crop.h)}, smaller than {out.width} × {out.height}, so it will be upscaled and may look soft.{' '}
                    <button type="button" className="crop-link" onClick={() => setNoUpscale(true)}>
                      Keep it at crop size
                    </button>
                  </span>
                </p>
              )}
              {out?.capped && (
                <p className="notice crop-capped" role="status">
                  <Info size={15} />
                  <span>
                    Kept at crop size, smaller than {target.w} × {target.h}.{' '}
                    <button type="button" className="crop-link" onClick={() => setNoUpscale(false)}>
                      Use {target.w} × {target.h}
                    </button>
                  </span>
                </p>
              )}
              {tooBig && (
                <p className="notice error crop-warn" role="alert">
                  <WarningCircle size={15} weight="fill" />
                  That’s too large for the browser to create. Use a smaller size.
                </p>
              )}

              <div className="crop-out">
                <div className="crop-out-text">
                  <span className="crop-out-size">{out ? `${out.width} × ${out.height}` : '—'}</span>
                  <span className="meta">
                    {fmt.label}
                    {circleOn ? ', circle' : ''} · {estimateFresh ? `≈ ${formatBytes(estimate.blob.size)}` : 'estimating…'}
                  </span>
                </div>
                <button type="button" className={`btn primary${exporting ? ' loading' : ''}`} onClick={download} disabled={!out || exporting || tooBig || (target && !(target.w > 0 && target.h > 0))}>
                  {exporting ? <span className="spinner" aria-hidden="true" /> : <DownloadSimple size={16} weight="bold" />}
                  Download {fmt.label}
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      <footer className="footer">Photos are rotated the right way up from their camera data. Exports are drawn once from the original pixels, so cropping never adds extra blur.</footer>
    </div>
  )
}
