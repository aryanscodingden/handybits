import { useCallback, useEffect, useRef, useState } from 'react'
import { Cpu, DownloadSimple, FileZip, Image as ImageIcon, Lightning, Scissors, User, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { downloadBlob, formatBytes } from '../lib/format.js'
import './BgRemover.css'

// Both models are permissively licensed (no RMBG-1.4/2.0, which are
// non-commercial). See src/lib/bg-worker.js for details.
const MODELS = {
  general: {
    id: 'onnx-community/BiRefNet_lite-ONNX',
    label: 'Any subject',
    hint: 'BiRefNet lite',
    icon: Scissors,
    mb: { fp16: 115, fp32: 224 },
  },
  portrait: {
    id: 'Xenova/modnet',
    label: 'People',
    hint: 'MODNet',
    icon: User,
    mb: { fp32: 26 },
  },
}

const BACKGROUNDS = [
  { key: 'transparent', label: 'Transparent' },
  { key: 'white', label: 'White' },
  { key: 'black', label: 'Black' },
  { key: 'color', label: 'Colour' },
  { key: 'blur', label: 'Blur' },
]

const ACCEPT = 'image/jpeg,image/png,image/webp'
const isImage = (f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
const uid = () => crypto.randomUUID()
const baseName = (name) => name.replace(/\.[^.]+$/, '')
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)

const dtypeFor = (key, gpu) => (key === 'general' && gpu?.f16 ? 'fp16' : 'fp32')
const modelUrl = (id, dtype) => `https://huggingface.co/${id}/resolve/main/onnx/model${dtype === 'fp32' ? '' : `_${dtype}`}.onnx`

async function detectGpu() {
  if (!('gpu' in navigator)) return null
  try {
    const adapter = await navigator.gpu.requestAdapter()
    return adapter ? { f16: adapter.features.has('shader-f16') } : null
  } catch {
    return null
  }
}

function friendlyError(err) {
  const msg = String(err?.message || err || '')
  if (/memory|alloc|oom|array buffer|RangeError/i.test(msg))
    return 'Your device ran out of memory. Try a smaller image, close other tabs, or switch to the People model.'
  if (/fetch|network|load failed|Failed to fetch/i.test(msg)) return 'Couldn’t download the model. Check your connection and try again.'
  if (/too large|no audio/i.test(msg)) return msg
  if (/OrtRun|onnx|webgpu|session/i.test(msg) || msg.length > 160)
    return 'The model couldn’t run in this browser. Try the People model, or a recent version of Chrome or Edge.'
  return msg ? `Something went wrong: ${msg}` : 'Something went wrong.'
}

function bgStyle(bg, color) {
  if (bg === 'white') return { kind: 'color', color: '#ffffff' }
  if (bg === 'black') return { kind: 'color', color: '#000000' }
  if (bg === 'color') return { kind: 'color', color }
  if (bg === 'blur') return { kind: 'blur' }
  return { kind: 'transparent' }
}

export default function BgRemover() {
  const [items, setItems] = useState([])
  const [model, setModel] = useState('general')
  const [gpu, setGpu] = useState(undefined) // undefined = still checking, null = none
  const [cached, setCached] = useState({})
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState(null) // null | 'loading' | 'running'
  const [progress, setProgress] = useState(null) // { loaded, total }
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [bg, setBg] = useState('transparent')
  const [color, setColor] = useState('#e8dccb')
  const [split, setSplit] = useState(50)
  const [exporting, setExporting] = useState(false)

  const workerRef = useRef(null)
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const supported = typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof createImageBitmap !== 'undefined'

  // Only feature detection here; the model and its runtime load on first use.
  useEffect(() => {
    let live = true
    detectGpu().then((g) => {
      if (!live) return
      setGpu(g)
      if (!g) setModel('portrait')
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (gpu === undefined || !('caches' in window)) return
    let live = true
    caches
      .open('transformers-cache')
      .then((c) => Promise.all(Object.entries(MODELS).map(async ([key, m]) => [key, !!(await c.match(modelUrl(m.id, dtypeFor(key, gpu))))])))
      .then((pairs) => live && setCached(Object.fromEntries(pairs)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [gpu, busy])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      for (const it of itemsRef.current) {
        URL.revokeObjectURL(it.url)
        if (it.cutoutUrl) URL.revokeObjectURL(it.cutoutUrl)
      }
    },
    [],
  )

  const addFiles = useCallback((files) => {
    const images = files.filter(isImage)
    setError(images.length < files.length ? 'Some files were skipped. Use JPG, PNG or WebP images.' : null)
    if (!images.length) return
    setItems((list) => [...list, ...images.map((file) => ({ id: uid(), file, url: URL.createObjectURL(file), status: 'queued' }))])
  }, [])

  const update = (id, patch) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  function remove(id) {
    const it = items.find((x) => x.id === id)
    if (it) {
      URL.revokeObjectURL(it.url)
      if (it.cutoutUrl) URL.revokeObjectURL(it.cutoutUrl)
    }
    setItems((list) => list.filter((x) => x.id !== id))
    if (selected === id) setSelected(null)
  }

  function clearAll() {
    for (const it of items) {
      URL.revokeObjectURL(it.url)
      if (it.cutoutUrl) URL.revokeObjectURL(it.cutoutUrl)
    }
    setItems([])
    setSelected(null)
    setError(null)
  }

  function getWorker() {
    if (!workerRef.current) workerRef.current = new Worker(new URL('../lib/bg-worker.js', import.meta.url), { type: 'module' })
    return workerRef.current
  }

  function segment(file, key, device, dtype) {
    const worker = getWorker()
    const id = uid()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }
      const onMessage = ({ data }) => {
        if (data.type === 'progress') setProgress({ loaded: data.loaded, total: data.total })
        else if (data.type === 'stage') setPhase(data.stage)
        else if (data.id === id && data.type === 'done') {
          cleanup()
          resolve(data)
        } else if (data.id === id && data.type === 'error') {
          cleanup()
          reject(new Error(data.message))
        }
      }
      const onError = (e) => {
        cleanup()
        // A crashed worker (often out of memory) can't be reused.
        worker.terminate()
        workerRef.current = null
        reject(new Error(e.message || 'The background remover stopped unexpectedly, possibly out of memory.'))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ type: 'run', id, model: MODELS[key].id, device, dtype, blob: file })
    })
  }

  async function run() {
    const todo = items.filter((x) => x.status === 'queued' || x.status === 'error')
    if (!todo.length || busy) return
    setBusy(true)
    setError(null)
    setProgress(null)
    const { cutOut } = await import('../lib/bg-composite.js')
    const key = model
    let device = gpu ? 'webgpu' : 'wasm'

    for (const it of todo) {
      update(it.id, { status: 'working', error: null })
      try {
        let result
        try {
          result = await segment(it.file, key, device, device === 'webgpu' ? dtypeFor(key, gpu) : 'fp32')
        } catch (err) {
          if (device !== 'webgpu' || /memory|alloc/i.test(String(err?.message))) throw err
          // WebGPU can be present but broken. ONNX Runtime keeps its WebGPU
          // backend for the life of the worker, so the CPU needs a fresh one.
          console.warn('WebGPU failed', err)
          device = 'wasm'
          setGpu(null)
          workerRef.current?.terminate()
          workerRef.current = null
          // BiRefNet is too big for the CPU backend (it runs out of memory),
          // so only People can fall back.
          if (key === 'general') {
            setModel('portrait')
            const gpuError = new Error('Any subject needs a working graphics card (WebGPU), which failed on this device. People is selected instead and runs on any device.')
            gpuError.gpu = true
            throw gpuError
          }
          result = await segment(it.file, key, device, 'fp32')
        }
        const out = await cutOut(it.file, result.mask, result.width, result.height)
        update(it.id, { status: 'done', cutout: out.blob, cutoutUrl: URL.createObjectURL(out.blob), width: out.width, height: out.height })
        setSelected((s) => s ?? it.id)
      } catch (err) {
        console.error(err)
        if (err.gpu) {
          update(it.id, { status: 'queued' })
          setError(err.message)
          break
        }
        update(it.id, { status: 'error', error: friendlyError(err) })
      }
    }

    setPhase(null)
    setProgress(null)
    setBusy(false)
  }

  const current = items.find((x) => x.id === selected && x.status === 'done')
  const done = items.filter((x) => x.status === 'done')
  const pending = items.filter((x) => x.status === 'queued' || x.status === 'error')
  const solid = bg !== 'transparent'
  const choice = bgStyle(bg, color)

  async function download(it, type) {
    setExporting(true)
    try {
      const { compose } = await import('../lib/bg-composite.js')
      const blob = await compose({ file: it.file, cutout: it.cutout, width: it.width, height: it.height }, choice, type)
      downloadBlob(blob, `${baseName(it.file.name)}-no-bg.${type === 'image/jpeg' ? 'jpg' : 'png'}`)
    } catch (err) {
      setError(friendlyError(err))
    }
    setExporting(false)
  }

  async function downloadAll(type) {
    setExporting(true)
    try {
      const [{ compose }, { zipSync }] = await Promise.all([import('../lib/bg-composite.js'), import('fflate')])
      const files = {}
      const ext = type === 'image/jpeg' ? 'jpg' : 'png'
      for (const it of done) {
        const blob = await compose({ file: it.file, cutout: it.cutout, width: it.width, height: it.height }, choice, type)
        let name = `${baseName(it.file.name)}-no-bg.${ext}`
        for (let n = 2; files[name]; n++) name = `${baseName(it.file.name)}-no-bg-${n}.${ext}`
        files[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
      }
      downloadBlob(new Blob([zipSync(files)], { type: 'application/zip' }), 'backgrounds-removed.zip')
    } catch (err) {
      setError(friendlyError(err))
    }
    setExporting(false)
  }

  const m = MODELS[model]
  const pct = progress?.total ? Math.min(100, (progress.loaded / progress.total) * 100) : null

  return (
    <div className="tool">
      <header className="header">
        <h1 className="title">Remove background</h1>
        <p className="lede">
          Cut out the subject of a photo and get a transparent PNG at full resolution. A free, private alternative to remove.bg, whose website closes on
          1 December 2026. It all runs in your browser, so your photos are never uploaded.
        </p>
      </header>

      {!supported && (
        <p className="notice error" role="alert">
          <WarningCircle size={16} weight="fill" />
          This browser can’t run the background remover. Try a recent version of Chrome, Edge, Firefox or Safari.
        </p>
      )}

      <DropZone
        onFiles={addFiles}
        accept={ACCEPT}
        title={items.length ? 'Add more images' : 'Drop images here or click to browse'}
        sub="JPG, PNG or WebP. Works best on people, portraits, products and animals with a clear subject. Busy scenes and fine detail like hair against a similar background are harder."
        button="Choose images"
        compact={items.length > 0}
      />

      {error && (
        <p className="notice error bg-top-notice" role="alert">
          <WarningCircle size={16} weight="fill" />
          {error}
        </p>
      )}

      {items.length > 0 && (
        <section className="section" aria-label="Images">
          <ul className="rows">
            {items.map((it) => (
              <li key={it.id} className={`row bg-row${it.id === selected ? ' on' : ''}${it.status === 'error' ? ' failed' : ''}`}>
                <img className="bg-thumb" src={it.cutoutUrl || it.url} alt="" />
                <div className="row-main">
                  <span className="name">{it.file.name}</span>
                  <span className="meta">
                    {formatBytes(it.file.size)}
                    {it.width ? ` · ${it.width} × ${it.height}` : ''}
                  </span>
                  {it.error && (
                    <span className="error">
                      <WarningCircle size={14} weight="fill" />
                      {it.error}
                    </span>
                  )}
                </div>
                <div className="row-actions">
                  {it.status === 'queued' && <span className="status">Ready</span>}
                  {it.status === 'working' && <span className="status converting">{phase === 'loading' ? 'Loading model…' : 'Removing…'}</span>}
                  {it.status === 'done' &&
                    (it.id === selected ? (
                      <span className="status ready">Showing</span>
                    ) : (
                      <button type="button" className="btn small" onClick={() => setSelected(it.id)}>
                        View
                      </button>
                    ))}
                  <button type="button" className="icon" aria-label={`Remove ${it.file.name}`} title="Remove" onClick={() => remove(it.id)} disabled={busy}>
                    <X size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="bg-settings">
            <div className="bg-setting">
              <span className="field-label" id="bg-model-label">
                Subject
              </span>
              <div className="choice" role="radiogroup" aria-labelledby="bg-model-label">
                {Object.entries(MODELS).map(([key, def]) => {
                  const Icon = def.icon
                  const size = def.mb[gpu ? dtypeFor(key, gpu) : 'fp32']
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={model === key}
                      className={model === key ? 'on' : ''}
                      onClick={() => setModel(key)}
                      disabled={busy || (key === 'general' && !gpu)}
                    >
                      <Icon size={16} />
                      {def.label}
                      <span className="choice-detail">{key === 'general' && !gpu ? 'Needs WebGPU' : cached[key] ? 'Ready' : `${size} MB`}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="bg-device">
              {gpu === undefined ? null : gpu ? (
                <>
                  <Lightning size={15} weight="fill" aria-hidden="true" /> Using your graphics card (WebGPU).
                </>
              ) : (
                <>
                  <Cpu size={15} aria-hidden="true" /> Using your processor. Any subject needs WebGPU, which isn’t available here, so People is
                  the option on this device. Recent Chrome and Edge support WebGPU on most computers.
                </>
              )}
            </p>
          </div>

          {busy && phase === 'loading' && (
            <div className="bg-progress-wrap" role="status" aria-live="polite">
              <div className="bg-progress-text">
                <span>
                  Downloading {m.hint}
                  {progress?.total ? ` · ${mb(progress.loaded)} of ${mb(progress.total)} MB` : '…'}
                </span>
                <span className="bg-progress-note">One-time download, cached by your browser</span>
              </div>
              <div
                className={`bg-progress${pct === null ? ' indeterminate' : ''}`}
                role="progressbar"
                aria-label="Model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct === null ? undefined : Math.round(pct)}
              >
                <span style={pct === null ? undefined : { width: `${pct}%` }} />
              </div>
            </div>
          )}

          <div className="controls">
            <span className="meta">
              {done.length > 0 && `${done.length} of ${items.length} done`}
            </span>
            <div className="actions">
              <button type="button" className="btn ghost" onClick={clearAll} disabled={busy}>
                Clear
              </button>
              <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={run} disabled={busy || !pending.length || !supported}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {busy
                  ? phase === 'loading'
                    ? 'Loading model…'
                    : 'Removing…'
                  : pending.length
                    ? `Remove background${pending.length > 1 ? ` from ${pending.length} images` : ''}`
                    : 'All done'}
              </button>
            </div>
          </div>
        </section>
      )}

      {current && (
        <section className="section" aria-label="Result">
          <div className="section-head">
            <h2>Result</h2>
          </div>
          <div className="panel bg-result">
            <div className="bg-stage">
              <div
                className={`bg-frame bg-${bg}`}
                style={{
                  aspectRatio: `${current.width} / ${current.height}`,
                  width: `min(100%, ${(440 * current.width) / current.height}px)`,
                  backgroundColor: choice.kind === 'color' ? choice.color : undefined,
                }}
              >
                {bg === 'blur' && <img className="bg-layer bg-blurred" src={current.url} alt="" />}
                <img className="bg-layer" src={current.cutoutUrl} alt={`${current.file.name} with the background removed`} />
                <img className="bg-layer bg-before" src={current.url} alt="" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
                <span className="bg-divider" style={{ left: `${split}%` }} aria-hidden="true" />
                <span className="bg-badge bg-badge-left" aria-hidden="true" hidden={split < 12}>
                  Before
                </span>
                <span className="bg-badge bg-badge-right" aria-hidden="true" hidden={split > 88}>
                  After
                </span>
              </div>
            </div>
            <label className="bg-compare">
              <span className="field-label">Compare</span>
              <input type="range" min="0" max="100" value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Before and after split" />
            </label>

            <div className="bg-options">
              <span className="field-label" id="bg-bg-label">
                Background
              </span>
              <div className="bg-option-row">
                <div className="segmented bg-segmented" role="radiogroup" aria-labelledby="bg-bg-label">
                  {BACKGROUNDS.map((b) => (
                    <button key={b.key} type="button" role="radio" aria-checked={bg === b.key} className={bg === b.key ? 'on' : ''} onClick={() => setBg(b.key)}>
                      <span className={`bg-swatch bg-swatch-${b.key}`} style={b.key === 'color' ? { background: color } : undefined} aria-hidden="true" />
                      {b.label}
                    </button>
                  ))}
                </div>
                {bg === 'color' && (
                  <label className="bg-color">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Background colour" />
                    <span>{color}</span>
                  </label>
                )}
              </div>
            </div>

            <div className="bg-downloads">
              <span className="meta">
                {current.width} × {current.height} · {solid ? 'PNG or JPG' : 'Transparent PNG'}
              </span>
              <div className="actions">
                {solid && (
                  <button type="button" className="btn" onClick={() => download(current, 'image/jpeg')} disabled={exporting}>
                    <ImageIcon size={16} />
                    Download JPG
                  </button>
                )}
                <button type="button" className="btn primary" onClick={() => download(current, 'image/png')} disabled={exporting}>
                  <DownloadSimple size={16} weight="bold" />
                  Download PNG
                </button>
              </div>
            </div>
            {done.length > 1 && (
              <div className="bg-all">
                <span className="meta">Applies the chosen background to all {done.length} images.</span>
                <div className="actions">
                  {solid && (
                    <button type="button" className="btn small" onClick={() => downloadAll('image/jpeg')} disabled={exporting}>
                      <FileZip size={15} />
                      All as JPG
                    </button>
                  )}
                  <button type="button" className="btn small" onClick={() => downloadAll('image/png')} disabled={exporting}>
                    <FileZip size={15} />
                    All as PNG
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="footer">
        Runs in your browser with Transformers.js. Any subject uses BiRefNet lite (MIT licence); People uses MODNet (Apache 2.0 licence). The model
        downloads from Hugging Face once and is cached; your images never leave this device.
      </footer>
    </div>
  )
}
