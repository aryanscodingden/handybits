import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowClockwise, CaretLeft, CaretRight, Check, DownloadSimple, FilePdf, Scissors, SelectionPlus, Trash, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { assemblePages, checkEditable, closePdf, openPdf, pdfErrorMessage, renderPage, splitPages } from '../lib/pdf.js'
import { downloadBlob } from '../lib/format.js'
import './PdfOrganize.css'

const uid = () => crypto.randomUUID()
const COLORS = ['#b5532f', '#4f6f8f', '#6b7a3a', '#a87a1f', '#7d5a86', '#3e7c78']
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const THUMB_WIDTH = 140
const FRAME = 0.75 // thumbnail frame aspect (width / height)

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const baseName = (name) => name.replace(/\.pdf$/i, '') || 'document'
const thumbKey = (fileId, index) => `${fileId}:${index}`

// Sizes and rotates a thumbnail so it always fits its frame, whatever the
// page shape or rotation. Sizes are relative to the frame, so tiles can flex.
function thumbStyle(aspect, rotation) {
  const odd = rotation % 180 !== 0
  const a = odd ? 1 / aspect : aspect
  const fit = 0.86
  const dw = (a >= FRAME ? 1 : a / FRAME) * fit
  const dh = dw / a
  const w = odd ? dh : dw
  const h = odd ? dw : dh
  return { width: `${w * 100}%`, height: `${h * FRAME * 100}%`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }
}

export default function PdfOrganize() {
  const [files, setFiles] = useState([])
  const [pages, setPages] = useState([])
  const [thumbs, setThumbs] = useState({})
  const [selected, setSelected] = useState(() => new Set())
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(null)
  const [drag, setDrag] = useState(null) // { id, over, after }
  const [status, setStatus] = useState('')

  const filesRef = useRef(new Set())
  const urlsRef = useRef([])
  const queueRef = useRef(Promise.resolve())
  const tileRefs = useRef(new Map())
  const focusRef = useRef(null)
  const colorRef = useRef(0)

  useEffect(() => {
    const alive = filesRef.current
    const urls = urlsRef.current
    return () => {
      alive.clear()
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  // Keep keyboard focus on a page after it moves.
  useLayoutEffect(() => {
    if (!focusRef.current) return
    tileRefs.current.get(focusRef.current)?.focus()
    focusRef.current = null
  }, [pages])

  // Thumbnails render one page at a time, across all files, so large PDFs
  // don't lock up the page.
  const queueThumbs = useCallback((fileId, pdf) => {
    queueRef.current = queueRef.current.then(async () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          if (!filesRef.current.has(fileId)) break
          try {
            const canvas = await renderPage(pdf, n, { width: THUMB_WIDTH * ratio })
            const aspect = canvas.width / canvas.height
            const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
            canvas.width = canvas.height = 0
            if (!blob || !filesRef.current.has(fileId)) continue
            const url = URL.createObjectURL(blob)
            urlsRef.current.push(url)
            setThumbs((t) => ({ ...t, [thumbKey(fileId, n - 1)]: { url, aspect } }))
          } catch {
            setThumbs((t) => ({ ...t, [thumbKey(fileId, n - 1)]: { failed: true, aspect: 0.75 } }))
          }
          await new Promise((r) => setTimeout(r, 0))
        }
      } finally {
        closePdf(pdf)
      }
    }).catch((err) => console.error(err))
  }, [])

  const addFiles = useCallback(
    async (list) => {
      const pdfs = list.filter(isPdf)
      const skipped = list.filter((f) => !isPdf(f))
      setErrors(skipped.map((f) => ({ id: uid(), text: `${f.name} isn’t a PDF.` })))
      for (const file of pdfs) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          await checkEditable(bytes)
          let pdf
          try {
            pdf = await openPdf(bytes)
          } catch (err) {
            throw new Error(pdfErrorMessage(err), { cause: err })
          }
          const id = uid()
          const color = COLORS[colorRef.current % COLORS.length]
          const letter = LETTERS[colorRef.current % LETTERS.length]
          colorRef.current++
          filesRef.current.add(id)
          setFiles((f) => [...f, { id, name: file.name, bytes, color, letter, pages: pdf.numPages }])
          setPages((p) => [...p, ...Array.from({ length: pdf.numPages }, (_, index) => ({ id: uid(), fileId: id, index, rotation: 0 }))])
          setStatus(`Added ${file.name}, ${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}.`)
          queueThumbs(id, pdf)
        } catch (err) {
          console.error(err)
          setErrors((e) => [...e, { id: uid(), text: `${file.name}: ${err.message}` }])
        }
      }
    },
    [queueThumbs],
  )

  const fileById = (id) => files.find((f) => f.id === id)

  function removeFile(id) {
    filesRef.current.delete(id)
    setFiles((f) => f.filter((x) => x.id !== id))
    setPages((p) => p.filter((x) => x.fileId !== id))
    setSelected((s) => new Set([...s].filter((pid) => pages.find((p) => p.id === pid)?.fileId !== id)))
  }

  function clearAll() {
    filesRef.current.clear()
    setFiles([])
    setPages([])
    setSelected(new Set())
    setErrors([])
  }

  const rotate = (id) => setPages((p) => p.map((x) => (x.id === id ? { ...x, rotation: x.rotation + 90 } : x)))

  function removePage(id) {
    const i = pages.findIndex((p) => p.id === id)
    const next = pages[i + 1] || pages[i - 1]
    if (next) focusRef.current = next.id
    setPages((p) => p.filter((x) => x.id !== id))
    setSelected((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    })
  }

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function move(id, delta) {
    const from = pages.findIndex((p) => p.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= pages.length) return
    focusRef.current = id
    setPages((p) => {
      const next = [...p]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setStatus(`Moved to position ${to + 1} of ${pages.length}.`)
  }

  function moveTo(id, targetId, after) {
    if (id === targetId) return
    setPages((p) => {
      const next = p.filter((x) => x.id !== id)
      const item = p.find((x) => x.id === id)
      let at = next.findIndex((x) => x.id === targetId)
      if (at < 0 || !item) return p
      if (after) at++
      next.splice(at, 0, item)
      return next
    })
  }

  const toSpec = (list) =>
    list.map((p) => ({ doc: fileById(p.fileId).bytes, index: p.index, rotation: ((p.rotation % 360) + 360) % 360 }))

  const outBase = () => {
    const first = files[0] ? baseName(files[0].name) : 'document'
    return files.length > 1 ? `${first}-merged` : first
  }

  async function run(kind, fn) {
    if (busy) return
    setBusy(kind)
    setErrors([])
    try {
      await fn()
    } catch (err) {
      console.error(err)
      setErrors([{ id: uid(), text: 'Couldn’t build the PDF. One of the files may be damaged.' }])
    }
    setBusy(null)
  }

  const download = () =>
    run('download', async () => {
      const out = await assemblePages(toSpec(pages))
      downloadBlob(new Blob([out.bytes], { type: 'application/pdf' }), `${outBase()}.pdf`)
    })

  const extract = () =>
    run('extract', async () => {
      const out = await assemblePages(toSpec(pages.filter((p) => selected.has(p.id))))
      downloadBlob(new Blob([out.bytes], { type: 'application/pdf' }), `${outBase()}-selected.pdf`)
    })

  const split = () =>
    run('split', async () => {
      const { zipSync } = await import('fflate')
      const parts = await splitPages(toSpec(pages))
      const base = outBase()
      const entries = Object.fromEntries(parts.map((bytes, i) => [`${base}-p${i + 1}.pdf`, [bytes, { level: 0 }]]))
      downloadBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), `${base}-pages.zip`)
    })

  const multi = files.length > 1
  const selectedCount = pages.filter((p) => selected.has(p.id)).length

  return (
    <div className="tool org">
      <header className="header">
        <h1 className="title">Merge & split PDF</h1>
        <p className="lede">Combine PDFs, reorder, rotate and remove pages, or pull pages out into their own files. Everything happens in your browser — nothing is uploaded.</p>
      </header>

      <DropZone
        onFiles={addFiles}
        accept="application/pdf,.pdf"
        compact={files.length > 0}
        title={files.length ? 'Add more PDFs' : 'Drop PDFs here or click to browse'}
        sub="Add one PDF to rearrange it, or several to merge them."
      />

      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>

      {errors.length > 0 && (
        <div className="org-errors">
          {errors.map((e) => (
            <p key={e.id} className="notice error" role="alert">
              <WarningCircle size={15} weight="fill" />
              {e.text}
            </p>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <section className="section" aria-label="Pages">
          <div className="section-head">
            <h2>
              Pages <span className="count">{pages.length}</span>
            </h2>
            <div className="org-head-actions">
              {pages.length > 0 && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setSelected(selectedCount === pages.length ? new Set() : new Set(pages.map((p) => p.id)))}
                >
                  <SelectionPlus size={15} />
                  {selectedCount === pages.length ? 'Clear selection' : 'Select all'}
                </button>
              )}
              <button type="button" className="btn ghost small danger" onClick={clearAll} disabled={!!busy}>
                <Trash size={15} />
                Start over
              </button>
            </div>
          </div>

          {multi && (
            <ul className="org-files" aria-label="Files">
              {files.map((f) => (
                <li key={f.id} className="org-file" style={{ '--file': f.color }}>
                  <span className="org-letter" aria-hidden="true">
                    {f.letter}
                  </span>
                  <span className="org-file-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="org-file-meta">{f.pages}p</span>
                  <button type="button" className="org-file-x" aria-label={`Remove ${f.name}`} title="Remove file" onClick={() => removeFile(f.id)} disabled={!!busy}>
                    <X size={13} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="org-hint">Click a page to select it. Drag to reorder, or focus a page and press Alt + arrow keys.</p>

          {pages.length === 0 ? (
            <div className="empty">
              <FilePdf size={28} weight="light" aria-hidden="true" />
              <p>All pages removed. Add a PDF or start over.</p>
            </div>
          ) : (
            <ol className="org-grid" onDragEnd={() => setDrag(null)}>
              {pages.map((p, i) => {
                const file = fileById(p.fileId)
                const thumb = thumbs[thumbKey(p.fileId, p.index)]
                const on = selected.has(p.id)
                const dropping = drag && drag.over === p.id && drag.id !== p.id
                return (
                  <li
                    key={p.id}
                    className={`org-tile${on ? ' on' : ''}${drag?.id === p.id ? ' dragging' : ''}${dropping ? (drag.after ? ' drop-after' : ' drop-before') : ''}`}
                    style={{ '--file': file?.color }}
                    draggable={!busy}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', p.id)
                      setDrag({ id: p.id, over: null, after: false })
                    }}
                    onDragOver={(e) => {
                      if (!drag) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const r = e.currentTarget.getBoundingClientRect()
                      const after = e.clientX > r.left + r.width / 2
                      if (drag.over !== p.id || drag.after !== after) setDrag({ ...drag, over: p.id, after })
                    }}
                    onDrop={(e) => {
                      if (!drag) return
                      e.preventDefault()
                      moveTo(drag.id, p.id, drag.after)
                      setDrag(null)
                    }}
                  >
                    <button
                      type="button"
                      ref={(el) => (el ? tileRefs.current.set(p.id, el) : tileRefs.current.delete(p.id))}
                      className="org-thumb"
                      aria-pressed={on}
                      aria-label={`Page ${i + 1}${multi ? `, from ${file?.name}` : ''}${p.rotation % 360 ? `, rotated ${p.rotation % 360}°` : ''}`}
                      onClick={() => toggle(p.id)}
                      onKeyDown={(e) => {
                        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
                          e.preventDefault()
                          move(p.id, -1)
                        } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
                          e.preventDefault()
                          move(p.id, 1)
                        } else if (e.key === 'Delete' || e.key === 'Backspace') {
                          e.preventDefault()
                          removePage(p.id)
                        } else if (e.key === 'r' || e.key === 'R') {
                          rotate(p.id)
                        }
                      }}
                    >
                      {thumb?.url ? (
                        <img src={thumb.url} alt="" draggable={false} style={thumbStyle(thumb.aspect, p.rotation)} />
                      ) : thumb?.failed ? (
                        <span className="org-failed" style={thumbStyle(thumb.aspect, p.rotation)}>
                          <WarningCircle size={18} />
                        </span>
                      ) : (
                        <span className="org-skeleton skeleton" style={thumbStyle(1 / 1.414, p.rotation)} />
                      )}
                      <span className="org-check" aria-hidden="true">
                        <Check size={12} weight="bold" />
                      </span>
                    </button>
                    <div className="org-tile-foot">
                      <span className="org-num">{i + 1}</span>
                      {multi && (
                        <span className="org-src" title={file?.name}>
                          {file?.letter}
                          <span className="org-src-page">·{p.index + 1}</span>
                        </span>
                      )}
                    </div>
                    <div className="org-tools">
                      <button type="button" className="org-tool org-move" aria-label={`Move page ${i + 1} earlier`} title="Move earlier" onClick={() => move(p.id, -1)} disabled={i === 0}>
                        <CaretLeft size={14} weight="bold" />
                      </button>
                      <button type="button" className="org-tool" aria-label={`Rotate page ${i + 1} clockwise`} title="Rotate" onClick={() => rotate(p.id)}>
                        <ArrowClockwise size={14} weight="bold" />
                      </button>
                      <button type="button" className="org-tool danger" aria-label={`Delete page ${i + 1}`} title="Delete" onClick={() => removePage(p.id)}>
                        <Trash size={14} weight="bold" />
                      </button>
                      <button
                        type="button"
                        className="org-tool org-move"
                        aria-label={`Move page ${i + 1} later`}
                        title="Move later"
                        onClick={() => move(p.id, 1)}
                        disabled={i === pages.length - 1}
                      >
                        <CaretRight size={14} weight="bold" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}

          <div className="controls org-controls">
            <p className="org-summary">
              {pages.length} {pages.length === 1 ? 'page' : 'pages'}
              {selectedCount > 0 && <> · {selectedCount} selected</>}
            </p>
            <div className="actions">
              <button type="button" className={`btn${busy === 'split' ? ' loading' : ''}`} onClick={split} disabled={!!busy || pages.length < 2}>
                {busy === 'split' ? <span className="spinner" aria-hidden="true" /> : <Scissors size={16} />}
                Split into single pages
              </button>
              <button type="button" className={`btn${busy === 'extract' ? ' loading' : ''}`} onClick={extract} disabled={!!busy || !selectedCount}>
                {busy === 'extract' && <span className="spinner" aria-hidden="true" />}
                Extract selected
              </button>
              <button type="button" className={`btn primary${busy === 'download' ? ' loading' : ''}`} onClick={download} disabled={!!busy || !pages.length}>
                {busy === 'download' ? <span className="spinner" aria-hidden="true" /> : <DownloadSimple size={16} weight="bold" />}
                Download PDF
              </button>
            </div>
          </div>
        </section>
      )}

      <footer className="footer">Pages are copied as they are, so text, links and quality are kept. Your files never leave this browser.</footer>
    </div>
  )
}
