import { useCallback, useEffect, useState } from 'react'
import { ArrowSquareOut, ArrowsMerge, DownloadSimple, File, FilePdf, Trash, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { detectType } from '../lib/detect.js'
import { PAGE_SIZES } from '../lib/pages.js'
import { deleteFile, forTool, getBlob, purgeExpired, readIndex, saveFile } from '../lib/storage.js'
import { downloadBlob, formatBytes, formatTimeLeft, openBlob, toPdfName } from '../lib/format.js'

const uid = () => crypto.randomUUID()

function storageError(err) {
  if (err?.name === 'QuotaExceededError') return 'Browser storage is full. Delete some PDFs and try again.'
  return err?.message || 'Something went wrong.'
}

export default function PdfTool() {
  const [queue, setQueue] = useState([])
  const [library, setLibrary] = useState(() => forTool(readIndex(), 'pdf'))
  const [pageSize, setPageSize] = useState('a4')
  const [merge, setMerge] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [freshIds, setFreshIds] = useState(() => new Set())

  const refresh = useCallback(
    () =>
      purgeExpired()
        .catch(() => forTool(readIndex(), 'pdf'))
        .then((list) => {
          setLibrary(forTool(list, 'pdf'))
          setNow(Date.now())
        }),
    [],
  )

  // Purge expired files on load, then once a minute. Also stay in sync with
  // other open tabs.
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 60_000)
    const onStorage = (e) => e.key === 'pdf-toolkit:files' && refresh()
    window.addEventListener('storage', onStorage)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  const addFiles = useCallback(async (fileList) => {
    const items = [...fileList].map((file) => ({ id: uid(), file, type: null, status: 'detecting' }))
    if (!items.length) return
    setQueue((q) => [...q, ...items])
    for (const item of items) {
      const type = await detectType(item.file).catch(() => ({ kind: 'unsupported', label: 'Unknown', note: 'Couldn’t read this file.' }))
      const status = type.kind === 'unsupported' ? 'error' : 'ready'
      setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, type, status, error: type.note && status === 'error' ? type.note : null } : x)))
    }
  }, [])

  const update = (id, patch) => setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (id) => setQueue((q) => q.filter((x) => x.id !== id))

  const ready = queue.filter((x) => x.status === 'ready')
  const willMerge = merge && ready.length > 1

  async function convert() {
    if (!ready.length || busy) return
    setBusy(true)
    setFreshIds(new Set())
    const opts = { pageSize }
    // Converters are heavy (jsPDF, html2canvas, pdf-lib); load them on first use.
    const { convertToPdf, mergePdfs } = await import('../lib/convert.js')
    const outputs = []

    for (const item of ready) {
      update(item.id, { status: 'converting', error: null })
      try {
        const out = await convertToPdf(item.file, item.type, opts)
        if (willMerge) {
          outputs.push({ item, out })
          update(item.id, { status: 'converted' })
        } else {
          const entry = await saveFile(
            {
              id: uid(),
              name: toPdfName(item.file.name),
              source: item.file.name,
              sourceLabel: item.type.label,
              tool: 'pdf',
              size: out.bytes.byteLength,
              pages: out.pages,
            },
            new Blob([out.bytes], { type: 'application/pdf' }),
          )
          setFreshIds((ids) => new Set(ids).add(entry.id))
          remove(item.id)
          setLibrary(forTool(readIndex(), 'pdf'))
        }
      } catch (err) {
        console.error(err)
        update(item.id, { status: 'error', error: storageError(err) })
      }
    }

    if (willMerge && outputs.length) {
      try {
        const merged = outputs.length > 1 ? await mergePdfs(outputs.map((o) => o.out.bytes)) : outputs[0].out
        const first = outputs[0].item.file.name
        const entry = await saveFile(
          {
            id: uid(),
            name: outputs.length > 1 ? toPdfName(first).replace(/\.pdf$/, `-merged-${outputs.length}.pdf`) : toPdfName(first),
            source: outputs.map((o) => o.item.file.name).join(', '),
            sourceLabel: outputs.length > 1 ? `${outputs.length} files` : outputs[0].item.type.label,
            tool: 'pdf',
            size: merged.bytes.byteLength,
            pages: merged.pages,
          },
          new Blob([merged.bytes], { type: 'application/pdf' }),
        )
        setFreshIds((ids) => new Set(ids).add(entry.id))
        setQueue((q) => q.filter((x) => !outputs.some((o) => o.item.id === x.id)))
        setLibrary(forTool(readIndex(), 'pdf'))
      } catch (err) {
        console.error(err)
        outputs.forEach((o) => update(o.item.id, { status: 'error', error: storageError(err) }))
      }
    }

    setNow(Date.now())
    setBusy(false)
  }

  async function withBlob(entry, fn) {
    const blob = await getBlob(entry.id).catch(() => null)
    if (blob) fn(blob)
    else refresh()
  }

  async function removeEntry(id) {
    await deleteFile(id)
    setLibrary(forTool(readIndex(), 'pdf'))
  }

  async function removeAll() {
    if (!window.confirm('Delete all stored PDFs from this browser?')) return
    await Promise.all(library.map((f) => deleteFile(f.id)))
    setLibrary(forTool(readIndex(), 'pdf'))
  }

  return (
    <div className="tool">
      <header className="header">
        <h1 className="title">PDF Converter</h1>
        <p className="lede">Convert any file to PDF. Everything happens in your browser — nothing is uploaded.</p>
      </header>

      <DropZone onFiles={addFiles} sub="Images, Word, Excel, CSV, Markdown, HTML, text, code and PDF. File type is detected automatically." />

      {queue.length > 0 && (
        <section className="section" aria-label="Files to convert">
          <ul className="rows">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} onRemove={() => remove(item.id)} disabled={busy} />
            ))}
          </ul>

          <div className="controls">
            <div className="options">
              <div className="segmented" role="radiogroup" aria-label="Page size">
                {Object.entries(PAGE_SIZES).map(([key, s]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={pageSize === key}
                    className={pageSize === key ? 'on' : ''}
                    onClick={() => setPageSize(key)}
                    disabled={busy}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {ready.length > 1 && (
                <label className={`check${merge ? ' on' : ''}`}>
                  <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} disabled={busy} />
                  <ArrowsMerge size={16} />
                  Merge into one PDF
                </label>
              )}
            </div>
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => setQueue([])} disabled={busy}>
                Clear
              </button>
              <button type="button" className="btn primary" onClick={convert} disabled={busy || !ready.length}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {busy ? 'Converting…' : ready.length ? `Convert ${ready.length} ${ready.length === 1 ? 'file' : 'files'}` : 'Convert'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>
            Your PDFs
            {library.length > 0 && <span className="count">{library.length}</span>}
          </h2>
          {library.length > 0 && (
            <button type="button" className="btn ghost small danger" onClick={removeAll}>
              <Trash size={15} />
              Delete all
            </button>
          )}
        </div>

        {library.length === 0 ? (
          <div className="empty">
            <FilePdf size={28} weight="light" aria-hidden="true" />
            <p>Converted files show up here and stay on this device for 3 days.</p>
          </div>
        ) : (
          <ul className="rows">
            {library.map((f) => (
              <li key={f.id} className={`row${freshIds.has(f.id) ? ' fresh' : ''}`}>
                <span className="file-icon pdf" aria-hidden="true">
                  <FilePdf size={20} weight="duotone" />
                </span>
                <div className="row-main">
                  <span className="name" title={f.source}>{f.name}</span>
                  <span className="meta">
                    {f.pages} {f.pages === 1 ? 'page' : 'pages'} · {formatBytes(f.size)} · from {f.sourceLabel} · {formatTimeLeft(f.expiresAt - now)}
                  </span>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn small" onClick={() => withBlob(f, openBlob)}>
                    <ArrowSquareOut size={15} />
                    Open
                  </button>
                  <button type="button" className="btn small primary" onClick={() => withBlob(f, (b) => downloadBlob(b, f.name))}>
                    <DownloadSimple size={15} weight="bold" />
                    Download
                  </button>
                  <button type="button" className="icon danger" aria-label={`Delete ${f.name}`} title="Delete" onClick={() => removeEntry(f.id)}>
                    <Trash size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="footer">
        Files are processed and stored only in this browser, and deleted automatically after 3 days.
      </footer>
    </div>
  )
}

function QueueRow({ item, onRemove, disabled }) {
  const { file, type, status, error } = item
  const statusText = {
    detecting: 'Detecting…',
    ready: 'Ready',
    converting: 'Converting…',
    converted: 'Merging…',
    error: null,
  }[status]

  return (
    <li className={`row${status === 'error' ? ' failed' : ''}`}>
      <span className="file-icon" aria-hidden="true">
        <File size={20} weight="duotone" />
      </span>
      <div className="row-main">
        <span className="name">{file.name}</span>
        <span className="meta">
          {formatBytes(file.size)}
          {type && type.kind !== 'unsupported' && (
            <>
              {' · '}
              <span className="tag">{type.format.toUpperCase()} → PDF</span>
            </>
          )}
          {type?.note && status !== 'error' && <> · {type.note}</>}
        </span>
        {error && (
          <span className="error">
            <WarningCircle size={14} weight="fill" />
            {error}
          </span>
        )}
      </div>
      <div className="row-actions">
        {statusText && <span className={`status ${status}`}>{statusText}</span>}
        <button type="button" className="icon" aria-label={`Remove ${file.name}`} title="Remove" onClick={onRemove} disabled={disabled}>
          <X size={16} />
        </button>
      </div>
    </li>
  )
}
