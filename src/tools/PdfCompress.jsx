import { useCallback, useState } from 'react'
import { DownloadSimple, FilePdf, Info, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { pdfErrorMessage, rasterizePdf } from '../lib/pdf.js'
import { downloadBlob, formatBytes } from '../lib/format.js'
import './PdfCompress.css'

const uid = () => crypto.randomUUID()
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const baseName = (name) => name.replace(/\.pdf$/i, '') || 'document'

const LEVELS = {
  small: { label: 'Small', detail: '72 dpi', dpi: 72, quality: 0.5 },
  balanced: { label: 'Balanced', detail: '110 dpi', dpi: 110, quality: 0.65 },
  sharp: { label: 'Sharp', detail: '150 dpi', dpi: 150, quality: 0.8 },
}

export default function PdfCompress() {
  const [items, setItems] = useState([])
  const [level, setLevel] = useState('balanced')
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState([])

  const update = (id, patch) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (id) => setItems((list) => list.filter((x) => x.id !== id))

  const addFiles = useCallback((list) => {
    setSkipped(list.filter((f) => !isPdf(f)).map((f) => f.name))
    const fresh = list.filter(isPdf).map((file) => ({ id: uid(), file, status: 'ready' }))
    setItems((prev) => [...prev, ...fresh])
  }, [])

  function chooseLevel(key) {
    setLevel(key)
    // Results were made at the old setting; let the button redo them.
    setItems((list) => list.map((x) => (x.status === 'done' ? { ...x, status: 'ready', result: null } : x)))
  }

  const pending = items.filter((x) => x.status === 'ready' || x.status === 'error')

  async function compress() {
    if (busy || !pending.length) return
    setBusy(true)
    const { dpi, quality } = LEVELS[level]
    for (const item of pending) {
      update(item.id, { status: 'working', page: 0, total: 0, error: null })
      try {
        const bytes = new Uint8Array(await item.file.arrayBuffer())
        const out = await rasterizePdf(bytes, { dpi, quality, onProgress: (page, total) => update(item.id, { page, total }) })
        const kept = out.bytes.byteLength >= bytes.byteLength
        update(item.id, {
          status: 'done',
          result: {
            blob: new Blob([kept ? bytes : out.bytes], { type: 'application/pdf' }),
            name: kept ? item.file.name : `${baseName(item.file.name)}-compressed.pdf`,
            size: kept ? bytes.byteLength : out.bytes.byteLength,
            kept,
          },
        })
      } catch (err) {
        console.error(err)
        const memory = err?.message === 'Couldn’t encode a page.'
        update(item.id, { status: 'error', error: memory ? 'A page was too large to process. Try Small.' : pdfErrorMessage(err) })
      }
    }
    setBusy(false)
  }

  const done = items.filter((x) => x.status === 'done')
  const totalBefore = done.reduce((n, x) => n + x.file.size, 0)
  const totalAfter = done.reduce((n, x) => n + x.result.size, 0)

  async function downloadAll() {
    if (done.length === 1) return downloadBlob(done[0].result.blob, done[0].result.name)
    const { zipSync } = await import('fflate')
    const used = new Set()
    const entries = {}
    for (const x of done) {
      let name = x.result.name
      for (let i = 2; used.has(name); i++) name = x.result.name.replace(/\.pdf$/i, `-${i}.pdf`)
      used.add(name)
      entries[name] = [new Uint8Array(await x.result.blob.arrayBuffer()), { level: 0 }]
    }
    downloadBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), 'compressed-pdfs.zip')
  }

  return (
    <div className="tool cmp">
      <header className="header">
        <h1 className="title">Compress PDF</h1>
        <p className="lede">Make PDFs small enough to email or upload. Everything happens in your browser — nothing is uploaded.</p>
      </header>

      <DropZone
        onFiles={addFiles}
        accept="application/pdf,.pdf"
        compact={items.length > 0}
        title={items.length ? 'Add more PDFs' : 'Drop PDFs here or click to browse'}
        sub="Best for scans and image-heavy PDFs."
      />

      {skipped.length > 0 && (
        <p className="notice error cmp-skipped" role="alert">
          <WarningCircle size={15} weight="fill" />
          {skipped.length === 1 ? `${skipped[0]} isn’t a PDF.` : `${skipped.length} files weren’t PDFs and were skipped.`}
        </p>
      )}

      {items.length > 0 && (
        <section className="section" aria-label="Files to compress">
          <ul className="rows">
            {items.map((item) => (
              <Row key={item.id} item={item} onRemove={() => remove(item.id)} disabled={busy} />
            ))}
          </ul>

          <p className="cmp-note">
            <Info size={16} aria-hidden="true" />
            Pages are saved as images, so text in the compressed file can’t be selected or searched. Keep the original if you need that.
          </p>

          <div className="controls">
            <div className="segmented cmp-levels" role="radiogroup" aria-label="Quality">
              {Object.entries(LEVELS).map(([key, l]) => (
                <button key={key} type="button" role="radio" aria-checked={level === key} className={level === key ? 'on' : ''} onClick={() => chooseLevel(key)} disabled={busy}>
                  {l.label}
                  <span className="choice-detail">{l.detail}</span>
                </button>
              ))}
            </div>
            <div className="actions">
              {done.length > 0 && !pending.length && !busy ? (
                <>
                  <button type="button" className="btn ghost" onClick={() => setItems([])}>
                    Clear
                  </button>
                  <button type="button" className="btn primary" onClick={downloadAll}>
                    <DownloadSimple size={16} weight="bold" />
                    {done.length > 1 ? 'Download all' : 'Download'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn ghost" onClick={() => setItems([])} disabled={busy}>
                    Clear
                  </button>
                  <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={compress} disabled={busy || !pending.length}>
                    {busy && <span className="spinner" aria-hidden="true" />}
                    {busy ? 'Compressing…' : `Compress ${pending.length} ${pending.length === 1 ? 'file' : 'files'}`}
                  </button>
                </>
              )}
            </div>
          </div>

          {done.length > 1 && (
            <p className="cmp-total" aria-live="polite">
              {formatBytes(totalBefore)} → {formatBytes(totalAfter)} in total
              {totalAfter < totalBefore && <> · {Math.round((1 - totalAfter / totalBefore) * 100)}% smaller</>}
            </p>
          )}
        </section>
      )}

      <footer className="footer">Compression re-draws each page at the chosen resolution. Small suits on-screen reading, Sharp keeps scans legible when printed.</footer>
    </div>
  )
}

function Row({ item, onRemove, disabled }) {
  const { file, status, page, total, result, error } = item
  const saved = result && !result.kept ? Math.round((1 - result.size / file.size) * 100) : 0
  return (
    <li className={`row${status === 'error' ? ' failed' : ''}`}>
      <span className="file-icon pdf" aria-hidden="true">
        <FilePdf size={20} weight="duotone" />
      </span>
      <div className="row-main">
        <span className="name">{file.name}</span>
        <span className="meta" aria-live="polite">
          {status === 'done' ? (
            result.kept ? (
              <>{formatBytes(file.size)} · Already well compressed, kept the original</>
            ) : (
              <>
                {formatBytes(file.size)} → <strong className="cmp-after">{formatBytes(result.size)}</strong>
              </>
            )
          ) : status === 'working' ? (
            total ? `Page ${Math.min(page + 1, total)} of ${total}` : 'Opening…'
          ) : (
            formatBytes(file.size)
          )}
        </span>
        {status === 'working' && (
          <span className="cmp-bar" role="progressbar" aria-label={`Compressing ${file.name}`} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={page}>
            <span style={{ width: `${total ? (page / total) * 100 : 4}%` }} />
          </span>
        )}
        {error && (
          <span className="error">
            <WarningCircle size={14} weight="fill" />
            {error}
          </span>
        )}
      </div>
      <div className="row-actions">
        {status === 'done' && !result.kept && <span className="status ready">−{saved}%</span>}
        {status === 'done' && (
          <button type="button" className="btn small" onClick={() => downloadBlob(result.blob, result.name)} aria-label={`Download ${result.name}`}>
            <DownloadSimple size={15} weight="bold" />
            Download
          </button>
        )}
        <button type="button" className="icon" aria-label={`Remove ${file.name}`} title="Remove" onClick={onRemove} disabled={disabled}>
          <X size={16} />
        </button>
      </div>
    </li>
  )
}
