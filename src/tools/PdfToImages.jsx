import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DownloadSimple, FilePdf, FileZip, Info, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { closePdf, openPdf, pagesInRange, parsePageRange, pdfErrorMessage, renderPageAtDpi } from '../lib/pdf.js'
import { downloadBlob, formatBytes } from '../lib/format.js'
import { dedupeNames } from '../lib/image-core.js'
import './PdfToImages.css'

const uid = () => crypto.randomUUID()
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const baseName = (name) => name.replace(/\.pdf$/i, '') || 'document'

const DPIS = [
  { dpi: 72, label: '72', detail: 'Screen' },
  { dpi: 150, label: '150', detail: 'Standard' },
  { dpi: 300, label: '300', detail: 'Print' },
]

const ALL_FORMATS = {
  jpeg: { label: 'JPG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
}

function canEncodeWebp() {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    return c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

const toBlob = (canvas, mime, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), mime, quality))

// A small JPEG preview, so the grid doesn't hold full-size decoded images.
async function thumbnail(canvas) {
  const w = 280
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w))
  const t = document.createElement('canvas')
  t.width = w
  t.height = h
  const ctx = t.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, w, h)
  const blob = await toBlob(t, 'image/jpeg', 0.8)
  t.width = t.height = 0
  return URL.createObjectURL(blob)
}

export default function PdfToImages() {
  const [files, setFiles] = useState([])
  const [skipped, setSkipped] = useState([])
  const [format, setFormat] = useState('jpeg')
  const [dpi, setDpi] = useState(150)
  const [quality, setQuality] = useState(85)
  const [range, setRange] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total, name }
  const [results, setResults] = useState([]) // [{ fileId, name, base, pages: [{ n, blob, thumb, width, height, name }] , error }]
  const [error, setError] = useState(null)
  const cancelRef = useRef(false)
  const resultsRef = useRef(results)
  const webp = useMemo(() => canEncodeWebp(), [])
  const formats = useMemo(() => Object.entries(ALL_FORMATS).filter(([k]) => k !== 'webp' || webp), [webp])

  useEffect(() => {
    resultsRef.current = results
  }, [results])
  useEffect(() => () => resultsRef.current.forEach((r) => r.pages.forEach((p) => URL.revokeObjectURL(p.thumb))), [])

  const parsed = useMemo(() => parsePageRange(range), [range])

  const addFiles = useCallback((list) => {
    setSkipped(list.filter((f) => !isPdf(f)).map((f) => f.name))
    const fresh = list.filter(isPdf).map((file) => ({ id: uid(), file, pages: null, error: null }))
    setFiles((prev) => [...prev, ...fresh])
    // Count pages up front so the button can say how many images to expect.
    for (const item of fresh) {
      item.file
        .arrayBuffer()
        .then((buf) => openPdf(new Uint8Array(buf)))
        .then((pdf) => {
          const pages = pdf.numPages
          closePdf(pdf)
          setFiles((prev) => prev.map((x) => (x.id === item.id ? { ...x, pages } : x)))
        })
        .catch((err) => setFiles((prev) => prev.map((x) => (x.id === item.id ? { ...x, error: pdfErrorMessage(err) } : x))))
    }
  }, [])

  function clearResults() {
    results.forEach((r) => r.pages.forEach((p) => URL.revokeObjectURL(p.thumb)))
    setResults([])
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((x) => x.id !== id))
    setResults((prev) => {
      prev.filter((r) => r.fileId === id).forEach((r) => r.pages.forEach((p) => URL.revokeObjectURL(p.thumb)))
      return prev.filter((r) => r.fileId !== id)
    })
  }

  function clearAll() {
    clearResults()
    setFiles([])
    setSkipped([])
    setError(null)
  }

  const usable = files.filter((f) => !f.error)
  const plan = parsed.ranges ? usable.map((f) => ({ f, pages: f.pages == null ? null : pagesInRange(parsed.ranges, f.pages) })) : []
  const planned = plan.reduce((n, p) => n + (p.pages?.length || 0), 0)
  const counting = usable.some((f) => f.pages == null)
  const emptyFiles = plan.filter((p) => p.pages && !p.pages.length)

  async function convert() {
    if (busy || !planned || parsed.error) return
    clearResults()
    setError(null)
    setBusy(true)
    cancelRef.current = false
    const fmt = ALL_FORMATS[format]
    const q = fmt.lossy ? quality / 100 : undefined
    let done = 0
    let reduced = false
    for (const { f, pages } of plan) {
      if (!pages?.length || cancelRef.current) continue
      const base = baseName(f.file.name)
      const pad = Math.max(2, String(f.pages).length)
      const entry = { fileId: f.id, name: f.file.name, base, pages: [], error: null }
      setResults((prev) => [...prev, entry])
      let pdf
      try {
        pdf = await openPdf(new Uint8Array(await f.file.arrayBuffer()))
        for (const n of pages) {
          if (cancelRef.current) break
          setProgress({ done, total: planned, name: f.file.name, page: n })
          const out = await renderPageAtDpi(pdf, n, { dpi })
          reduced ||= out.reduced
          const { canvas } = out
          let blob
          try {
            blob = await toBlob(canvas, fmt.mime, q)
          } catch {
            throw new Error('memory')
          }
          const page = { n, blob, width: canvas.width, height: canvas.height, thumb: await thumbnail(canvas), name: `${base}-p${String(n).padStart(pad, '0')}.${fmt.ext}` }
          canvas.width = canvas.height = 0
          done++
          setResults((prev) => prev.map((r) => (r.fileId === f.id ? { ...r, pages: [...r.pages, page] } : r)))
        }
      } catch (err) {
        console.error(err)
        const msg = err?.message === 'memory' ? 'A page was too large to convert. Try a lower resolution.' : pdfErrorMessage(err)
        setResults((prev) => prev.map((r) => (r.fileId === f.id ? { ...r, error: msg } : r)))
      } finally {
        closePdf(pdf)
      }
    }
    setProgress(null)
    setBusy(false)
    if (reduced) setError('Some pages were very large, so they were rendered at a lower resolution to fit in memory.')
  }

  const allPages = results.flatMap((r) => r.pages)
  const outputCount = allPages.length

  async function downloadAll() {
    if (outputCount === 1) return downloadBlob(allPages[0].blob, allPages[0].name)
    const { zipSync } = await import('fflate')
    const names = dedupeNames(allPages.map((p) => p.name))
    const entries = {}
    for (let i = 0; i < allPages.length; i++) entries[names[i]] = [new Uint8Array(await allPages[i].blob.arrayBuffer()), { level: 0 }]
    const withPages = results.filter((r) => r.pages.length)
    const zipName = withPages.length === 1 ? `${withPages[0].base}-images.zip` : 'pdf-images.zip'
    downloadBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), zipName)
  }

  const totalBytes = allPages.reduce((n, p) => n + p.blob.size, 0)
  const pct = progress ? (progress.done / progress.total) * 100 : 0
  const lossy = ALL_FORMATS[format].lossy

  return (
    <div className="tool p2i">
      <header className="header">
        <h1 className="title">PDF to images</h1>
        <p className="lede">Save PDF pages as JPG, PNG or WebP images. It runs in your browser, nothing is uploaded.</p>
      </header>

      <DropZone
        onFiles={addFiles}
        accept="application/pdf,.pdf"
        compact={files.length > 0}
        title={files.length ? 'Add more PDFs' : 'Drop PDFs here or click to browse'}
        sub="One or more PDFs. Every page, or just the ones you pick, becomes an image."
      />

      {skipped.length > 0 && (
        <p className="notice error p2i-gap" role="alert">
          <WarningCircle size={15} weight="fill" />
          {skipped.length === 1 ? `${skipped[0]} isn’t a PDF.` : `${skipped.length} files weren’t PDFs and were skipped.`}
        </p>
      )}

      {files.length > 0 && (
        <section className="section" aria-label="PDFs to convert">
          <ul className="rows">
            {files.map((f) => (
              <li key={f.id} className={`row${f.error ? ' failed' : ''}`}>
                <span className="file-icon pdf" aria-hidden="true">
                  <FilePdf size={20} weight="duotone" />
                </span>
                <div className="row-main">
                  <span className="name">{f.file.name}</span>
                  <span className="meta">
                    {formatBytes(f.file.size)}
                    {f.pages != null && ` · ${f.pages} ${f.pages === 1 ? 'page' : 'pages'}`}
                  </span>
                  {f.error && (
                    <span className="error">
                      <WarningCircle size={14} weight="fill" />
                      {f.error}
                    </span>
                  )}
                </div>
                <div className="row-actions">
                  <button type="button" className="icon" aria-label={`Remove ${f.file.name}`} title="Remove" onClick={() => removeFile(f.id)} disabled={busy}>
                    <X size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="panel p2i-options">
            <div className="p2i-field">
              <span className="field-label" id="p2i-format">
                Format
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="p2i-format">
                {formats.map(([key, f]) => (
                  <button key={key} type="button" role="radio" aria-checked={format === key} className={format === key ? 'on' : ''} onClick={() => setFormat(key)} disabled={busy}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p2i-field">
              <span className="field-label" id="p2i-dpi">
                Resolution
              </span>
              <div className="segmented p2i-dpi" role="radiogroup" aria-labelledby="p2i-dpi">
                {DPIS.map((d) => (
                  <button key={d.dpi} type="button" role="radio" aria-checked={dpi === d.dpi} className={dpi === d.dpi ? 'on' : ''} onClick={() => setDpi(d.dpi)} disabled={busy}>
                    {d.label}
                    <span className="choice-detail">dpi</span>
                  </button>
                ))}
              </div>
            </div>

            <label className={`p2i-field p2i-quality${lossy ? '' : ' off'}`}>
              <span className="field-label">
                Quality <span className="p2i-value">{lossy ? `${quality}%` : 'Lossless'}</span>
              </span>
              <input type="range" min="40" max="100" step="1" value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={busy || !lossy} />
            </label>

            <label className="p2i-field p2i-range">
              <span className="field-label">Pages</span>
              <input
                className={`input p2i-input${parsed.error ? ' invalid' : ''}`}
                value={range}
                onChange={(e) => setRange(e.target.value)}
                placeholder="All pages, or e.g. 1-3, 5"
                aria-invalid={!!parsed.error}
                aria-describedby="p2i-range-hint"
                disabled={busy}
                spellCheck={false}
                inputMode="text"
              />
              <span id="p2i-range-hint" className={`p2i-hint${parsed.error ? ' bad' : ''}`}>
                {parsed.error || (files.length > 1 && range.trim() ? 'Applies to every PDF. Pages a file doesn’t have are skipped.' : 'Leave empty for every page.')}
              </span>
            </label>
          </div>

          {emptyFiles.length > 0 && !parsed.error && (
            <p className="notice error p2i-gap" role="status">
              <Info size={15} />
              {emptyFiles.length === 1
                ? `${emptyFiles[0].f.file.name} has only ${emptyFiles[0].f.pages} ${emptyFiles[0].f.pages === 1 ? 'page' : 'pages'}, so nothing is selected from it.`
                : `${emptyFiles.length} PDFs have no pages in that range.`}
            </p>
          )}

          {busy && progress && (
            <div className="p2i-progress" role="status" aria-live="polite">
              <div className="p2i-progress-text">
                <span>
                  Page {Math.min(progress.done + 1, progress.total)} of {progress.total}
                </span>
                <span className="p2i-progress-name">{progress.name}</span>
              </div>
              <div className="p2i-bar" role="progressbar" aria-label="Converting pages" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <span style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
            </div>
          )}

          <div className="controls">
            <span className="meta">{outputCount > 0 && !busy ? `${outputCount} ${outputCount === 1 ? 'image' : 'images'} · ${formatBytes(totalBytes)}` : ''}</span>
            <div className="actions">
              {busy ? (
                <button type="button" className="btn ghost" onClick={() => (cancelRef.current = true)}>
                  Stop
                </button>
              ) : (
                <button type="button" className="btn ghost" onClick={clearAll}>
                  Clear
                </button>
              )}
              <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={convert} disabled={busy || !planned || !!parsed.error}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {busy ? 'Converting…' : counting && !planned ? 'Reading PDFs…' : `Convert ${planned} ${planned === 1 ? 'page' : 'pages'}`}
              </button>
            </div>
          </div>
        </section>
      )}

      {error && (
        <p className="notice error p2i-gap" role="status">
          <Info size={15} />
          {error}
        </p>
      )}

      {results.length > 0 && (
        <section className="section" aria-label="Images">
          <div className="section-head">
            <h2>
              Images <span className="count">{outputCount}</span>
            </h2>
            {outputCount > 0 && !busy && (
              <button type="button" className="btn primary small" onClick={downloadAll}>
                {outputCount === 1 ? <DownloadSimple size={15} weight="bold" /> : <FileZip size={15} weight="bold" />}
                {outputCount === 1 ? 'Download' : 'Download all'}
              </button>
            )}
          </div>
          {results.map((r) => (
            <div key={r.fileId} className="p2i-group">
              {results.length > 1 && <h3 className="p2i-group-title">{r.name}</h3>}
              {r.error && (
                <p className="notice error" role="alert">
                  <WarningCircle size={15} weight="fill" />
                  {r.error}
                </p>
              )}
              <ul className="p2i-grid">
                {r.pages.map((p) => (
                  <li key={p.n} className="p2i-card">
                    <div className="p2i-thumb">
                      <img src={p.thumb} alt={`Page ${p.n}`} width={p.width} height={p.height} />
                    </div>
                    <div className="p2i-card-foot">
                      <div className="p2i-card-text">
                        <span className="p2i-card-name">Page {p.n}</span>
                        <span className="p2i-card-meta">
                          {p.width} × {p.height} · {formatBytes(p.blob.size)}
                        </span>
                      </div>
                      <button type="button" className="icon" aria-label={`Download ${p.name}`} title={`Download ${p.name}`} onClick={() => downloadBlob(p.blob, p.name)}>
                        <DownloadSimple size={16} />
                      </button>
                    </div>
                  </li>
                ))}
                {busy && progress && r.fileId === results[results.length - 1].fileId && (
                  <li className="p2i-card p2i-pending" aria-hidden="true">
                    <div className="p2i-thumb skeleton" />
                  </li>
                )}
              </ul>
            </div>
          ))}
        </section>
      )}

      <footer className="footer">
        150 dpi suits screens and sharing; 300 dpi is for printing. PNG keeps text crisp, JPG makes smaller files. Pages render with pdf.js, entirely on this device.
      </footer>
    </div>
  )
}
