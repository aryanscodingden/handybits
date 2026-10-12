import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeft, CaretRight, Check, ClipboardText, Copy, DownloadSimple, FilePdf, Globe, Image as ImageIcon, Info, Scan, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { closePdf, openPdf, pagesInRange, parsePageRange, pdfErrorMessage, renderPageAtDpi } from '../lib/pdf.js'
import { downloadBlob, formatBytes } from '../lib/format.js'
import { baseOf, isHeic } from '../lib/image-core.js'
import { LANGUAGES, confidenceOf, enhance, imageToCanvas, joinPages, toBlob } from '../lib/ocr-image.js'
import { nf, useAutosize, useCopy, useStoredState } from '../lib/text-hooks.js'
import './OcrTool.css'

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')
const isImage = (f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name || '')

const STATUS = {
  'loading tesseract core': 'Loading the OCR engine',
  'initializing tesseract': 'Starting the OCR engine',
  'initialized tesseract': 'Starting the OCR engine',
  'loading language traineddata': 'Loading language data',
  'loaded language traineddata': 'Loading language data',
  'initializing api': 'Preparing',
  'initialized api': 'Preparing',
  'recognizing text': 'Reading text',
}

const PDF_DPI = 200
const PDF_WARN_PAGES = 20

export default function OcrTool() {
  const [source, setSource] = useState(null) // { kind, file, url?, pages? , error? }
  const [lang, setLang] = useStoredState('ocr-lang', 'eng')
  const [boost, setBoost] = useStoredState('ocr-enhance', true)
  const [range, setRange] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { label, pct, page, total }
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { pages, text, words, conf, lang }
  const [text, setText] = useState('')
  const [view, setView] = useState(0)
  const [active, setActive] = useState(null) // { page, index }
  const [copied, copy] = useCopy()

  const ocrRef = useRef(null) // { lang, engine }
  const aliveRef = useRef(true)
  const textRef = useRef(null)
  const urlsRef = useRef([])
  useAutosize(textRef, text, 520)

  const track = (url) => (urlsRef.current.push(url), url)

  useEffect(() => {
    aliveRef.current = true
    const urls = urlsRef.current
    return () => {
      aliveRef.current = false
      ocrRef.current?.engine.terminate()
      ocrRef.current = null
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  const language = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0]

  const resetResult = () => {
    setResult(null)
    setText('')
    setView(0)
    setActive(null)
  }

  const addFiles = useCallback((files) => {
    const file = files.find((f) => isPdf(f) || isImage(f))
    setError(null)
    if (!file) {
      setError(files.length ? 'Use an image (PNG, JPG, WebP, GIF) or a PDF.' : null)
      return
    }
    if (isHeic(file)) {
      setError('HEIC photos can’t be read here. Convert it to JPG with Compress images first, then come back.')
      return
    }
    resetResult()
    setRange('')
    if (isPdf(file)) {
      setSource({ kind: 'pdf', file, pages: null })
      file
        .arrayBuffer()
        .then((buf) => openPdf(new Uint8Array(buf)))
        .then((pdf) => {
          const pages = pdf.numPages
          closePdf(pdf)
          setSource((s) => (s?.file === file ? { ...s, pages } : s))
        })
        .catch((err) => setSource((s) => (s?.file === file ? { ...s, error: pdfErrorMessage(err) } : s)))
    } else {
      const name = file.name && file.name !== 'image.png' ? file.name : `Pasted image.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`
      setSource({ kind: 'image', file, name, url: track(URL.createObjectURL(file)) })
    }
  }, [])

  // Paste a screenshot anywhere on the page.
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => isImage(f) || isPdf(f))
      if (!files.length || busy) return
      e.preventDefault()
      addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles, busy])

  async function pasteButton() {
    setError(null)
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          return addFiles([new File([blob], `Pasted image.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type })])
        }
      }
      setError('There’s no image on the clipboard. Copy a screenshot or image first.')
    } catch {
      setError('The browser didn’t allow reading the clipboard. Press Ctrl+V (⌘V on a Mac) instead.')
    }
  }

  function clearSource() {
    setSource(null)
    resetResult()
    setError(null)
  }

  const parsed = useMemo(() => parsePageRange(range), [range])
  const pdfPages = source?.kind === 'pdf' && source.pages && parsed.ranges ? pagesInRange(parsed.ranges, source.pages) : []

  async function getEngine(onProgress) {
    if (ocrRef.current?.lang === lang) return ocrRef.current.engine
    ocrRef.current?.engine.terminate()
    ocrRef.current = null
    const { createOcr } = await import('../lib/ocr-engine.js')
    const engine = await createOcr(lang, onProgress)
    if (!aliveRef.current) {
      engine.terminate()
      throw new Error('closed')
    }
    ocrRef.current = { lang, engine }
    return engine
  }

  async function run() {
    if (!source || busy) return
    setBusy(true)
    setError(null)
    resetResult()
    let pageInfo = { page: 0, total: 1 }
    const onProgress = (m) => {
      if (!aliveRef.current) return
      const label = STATUS[m.status]
      if (!label) return
      const shown = m.status === 'loading language traineddata' && language.local ? 'Loading English data' : label
      setStatus({ label: shown, pct: typeof m.progress === 'number' ? m.progress : null, ...pageInfo })
    }
    setStatus({ label: 'Loading the OCR engine', pct: null, ...pageInfo })
    try {
      const engine = await getEngine(onProgress)
      const { wordsOf } = await import('../lib/ocr-engine.js')
      const jobs = []
      if (source.kind === 'image') {
        jobs.push(async () => ({ n: 1, canvas: await imageToCanvas(source.file), url: source.url }))
      } else {
        const pdf = await openPdf(new Uint8Array(await source.file.arrayBuffer()))
        for (const n of pdfPages)
          jobs.push(async () => {
            const { canvas } = await renderPageAtDpi(pdf, n, { dpi: PDF_DPI, maxPixels: 16_000_000 })
            return { n, canvas, url: null }
          })
        jobs.close = () => closePdf(pdf)
      }
      const pages = []
      try {
        for (let i = 0; i < jobs.length; i++) {
          pageInfo = { page: i + 1, total: jobs.length }
          setStatus({ label: source.kind === 'pdf' ? 'Rendering page' : 'Preparing', pct: null, ...pageInfo })
          const job = await jobs[i]()
          const work = boost ? enhance(job.canvas) : job.canvas
          const blob = await toBlob(work, 'image/png')
          const width = work.width
          const height = work.height
          let url = job.url
          if (!url) url = track(URL.createObjectURL(await toBlob(job.canvas, 'image/jpeg', 0.85)))
          if (work !== job.canvas) work.width = work.height = 0
          job.canvas.width = job.canvas.height = 0
          setStatus({ label: 'Reading text', pct: 0, ...pageInfo })
          const data = await engine.recognize(blob)
          if (!aliveRef.current) return
          pages.push({ n: job.n, url, width, height, text: data.text || '', words: wordsOf(data) })
        }
      } finally {
        jobs.close?.()
      }
      const joined = joinPages(pages)
      setResult({ pages, text: joined.text, words: joined.words, conf: confidenceOf(pages), lang: language.label })
      setText(joined.text)
      setView(0)
    } catch (err) {
      if (err?.message === 'closed') return
      console.error(err)
      ocrRef.current?.engine.terminate()
      ocrRef.current = null
      const msg = String(err?.message || err || '')
      if (source.kind === 'pdf' && /password|encrypt|pdf/i.test(msg + (err?.name || ''))) setError(pdfErrorMessage(err))
      else if (/fetch|network/i.test(msg))
        setError(language.local ? 'Couldn’t load the OCR engine. Reload the page and try again.' : `Couldn’t download the ${language.label} data. Check your connection and try again.`)
      else if (/decode|source image|InvalidStateError/i.test(msg + (err?.name || ''))) setError('This image couldn’t be opened. It may be damaged or in an unsupported format.')
      else setError('Text recognition failed. Try again, or try a clearer image.')
    } finally {
      if (aliveRef.current) {
        setBusy(false)
        setStatus(null)
      }
    }
  }

  const edited = result && text !== result.text
  const page = result?.pages[view]

  function selectWord(pi, wi) {
    setActive({ page: pi, index: wi })
    if (!result || edited) return
    const w = result.words.find((x) => x.page === pi && x.index === wi)
    const el = textRef.current
    if (!w || !el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(w.start, w.end)
    // Scroll the textarea so the selection is visible.
    const before = el.value.slice(0, w.start).split('\n').length - 1
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22
    el.scrollTop = Math.max(0, before * lineHeight - el.clientHeight / 3)
  }

  function onTextSelect(e) {
    if (!result || edited) return
    const at = e.target.selectionStart
    const w = result.words.find((x) => at >= x.start && at <= x.end)
    if (!w) return
    setActive({ page: w.page, index: w.index })
    if (w.page !== view) setView(w.page)
  }

  const activeWord = active && result?.pages[active.page]?.words[active.index]
  const outName = source ? `${baseOf(source.name || source.file.name || 'text')}.txt` : 'text.txt'
  const chars = text.length
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
  const pct = status?.pct == null ? null : Math.round(status.pct * 100)
  const canRun = source && !source.error && (source.kind === 'image' || (pdfPages.length > 0 && !parsed.error))

  return (
    <div className="tool ocr">
      <header className="header">
        <h1 className="title">Image to text</h1>
        <p className="lede">
          Pull the text out of screenshots, photos and scanned PDFs. Paste a screenshot with <kbd>Ctrl</kbd> <kbd>V</kbd> or drop a file. It runs in your browser,
          nothing is uploaded.
        </p>
      </header>

      {!source ? (
        <>
          <DropZone
            onFiles={addFiles}
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,application/pdf,.pdf"
            multiple={false}
            title="Drop an image or PDF, or paste a screenshot"
            sub="PNG, JPG, WebP, GIF or a scanned PDF. Printed text works best; handwriting usually doesn’t."
          />
          <div className="ocr-paste">
            <button type="button" className="btn small" onClick={pasteButton}>
              <ClipboardText size={15} />
              Paste image
            </button>
            <span className="meta">
              or press <kbd>Ctrl</kbd> <kbd>V</kbd> / <kbd>⌘</kbd> <kbd>V</kbd>
            </span>
          </div>
        </>
      ) : (
        <ul className="rows">
          <li className={`row${source.error ? ' failed' : ''}`}>
            {source.kind === 'image' ? (
              <img className="ocr-thumb" src={source.url} alt="" />
            ) : (
              <span className="file-icon pdf" aria-hidden="true">
                <FilePdf size={20} weight="duotone" />
              </span>
            )}
            <div className="row-main">
              <span className="name">{source.name || source.file.name}</span>
              <span className="meta">
                {formatBytes(source.file.size)}
                {source.kind === 'pdf' && source.pages != null && ` · ${source.pages} ${source.pages === 1 ? 'page' : 'pages'}`}
              </span>
              {source.error && (
                <span className="error">
                  <WarningCircle size={14} weight="fill" />
                  {source.error}
                </span>
              )}
            </div>
            <div className="row-actions">
              <button type="button" className="icon" aria-label="Remove file" title="Remove" onClick={clearSource} disabled={busy}>
                <X size={16} />
              </button>
            </div>
          </li>
        </ul>
      )}

      {error && (
        <p className="notice error ocr-gap" role="alert">
          <WarningCircle size={15} weight="fill" />
          {error}
        </p>
      )}

      {source && !source.error && (
        <section className="section" aria-label="Options">
          <div className="panel ocr-options">
            <label className="ocr-field">
              <span className="field-label">Language</span>
              <span className="ocr-select-wrap">
                <Globe size={16} className="ocr-select-icon" aria-hidden="true" />
                <select className="ocr-select" value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.local ? `${l.label} (built in)` : `${l.label} (${l.mb} MB download)`}
                    </option>
                  ))}
                </select>
              </span>
            </label>

            {source.kind === 'pdf' && (
              <label className="ocr-field">
                <span className="field-label">Pages</span>
                <input
                  className={`input ocr-input${parsed.error ? ' invalid' : ''}`}
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder="All, or e.g. 1-3, 5"
                  aria-invalid={!!parsed.error}
                  aria-describedby="ocr-range-hint"
                  disabled={busy}
                  spellCheck={false}
                />
              </label>
            )}

            <label className={`check ocr-check${boost ? ' on' : ''}`}>
              <input type="checkbox" checked={boost} onChange={(e) => setBoost(e.target.checked)} disabled={busy} />
              Enhance for accuracy
            </label>

            <p className="ocr-hint ocr-wide" id="ocr-range-hint">
              {source.kind === 'pdf' && parsed.error ? (
                <span className="bad">{parsed.error}</span>
              ) : !language.local ? (
                <>
                  <Info size={14} aria-hidden="true" />
                  <span>
                    Downloads the {language.label} data from jsDelivr (about {language.mb} MB) the first time, then your browser keeps it. Only the language file is fetched;
                    your image stays here. English needs no download.
                  </span>
                </>
              ) : (
                <>
                  <Info size={14} aria-hidden="true" />
                  <span>
                    {boost ? 'Grayscale with stronger contrast, and small images are enlarged. ' : ''}
                    {source.kind === 'pdf' && pdfPages.length > PDF_WARN_PAGES ? `${pdfPages.length} pages will take a few minutes.` : 'English is built in, so nothing is downloaded from anywhere else.'}
                  </span>
                </>
              )}
            </p>
          </div>

          {busy && status && (
            <div className="ocr-progress" role="status" aria-live="polite">
              <div className="ocr-progress-text">
                <span>
                  {status.label}
                  {pct != null && status.label === 'Reading text' ? ` · ${pct}%` : '…'}
                </span>
                {status.total > 1 && (
                  <span className="ocr-progress-note">
                    Page {status.page} of {status.total}
                  </span>
                )}
              </div>
              <div
                className={`ocr-bar${pct == null ? ' indeterminate' : ''}`}
                role="progressbar"
                aria-label="Text recognition"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct == null ? undefined : pct}
              >
                <span style={pct == null ? undefined : { width: `${Math.max(3, pct)}%` }} />
              </div>
            </div>
          )}

          <div className="controls">
            <span className="meta">{source.kind === 'pdf' && pdfPages.length > 0 && `${pdfPages.length} ${pdfPages.length === 1 ? 'page' : 'pages'} at ${PDF_DPI} dpi`}</span>
            <div className="actions">
              <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={run} disabled={busy || !canRun}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <Scan size={16} weight="bold" />}
                {busy ? 'Recognising…' : result ? 'Recognise again' : 'Recognise text'}
              </button>
            </div>
          </div>
        </section>
      )}

      {result && (
        <section className="section" aria-label="Result">
          <div className="section-head">
            <h2>Text</h2>
            <div className="ocr-conf" title="Average confidence across recognised words">
              {result.conf.words ? (
                <>
                  <span className={`ocr-dot ${result.conf.mean >= 85 ? 'good' : result.conf.mean >= 65 ? 'fair' : 'poor'}`} aria-hidden="true" />
                  {result.conf.mean}% confidence
                  {result.conf.low > 0 && (
                    <span className="ocr-conf-low">
                      · {nf.format(result.conf.low)} doubtful {result.conf.low === 1 ? 'word' : 'words'}
                    </span>
                  )}
                </>
              ) : (
                'No text found'
              )}
            </div>
          </div>

          <div className="ocr-result">
            <textarea
              ref={textRef}
              className="ocr-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onSelect={onTextSelect}
              aria-label="Recognised text"
              spellCheck={false}
              placeholder="No text was found. Try turning on Enhance, or use a sharper image."
            />
            <div className="ocr-text-foot">
              <span className="meta">
                {nf.format(wordCount)} {wordCount === 1 ? 'word' : 'words'} · {nf.format(chars)} characters
                {edited && (
                  <button type="button" className="ocr-link" onClick={() => setText(result.text)}>
                    Undo edits
                  </button>
                )}
              </span>
              <div className="actions">
                <button type="button" className="btn small" onClick={() => copy(text, 'text')} disabled={!text}>
                  {copied === 'text' ? <Check size={15} weight="bold" /> : <Copy size={15} />}
                  {copied === 'text' ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="btn small" onClick={() => downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), outName)} disabled={!text}>
                  <DownloadSimple size={15} />
                  Download .txt
                </button>
              </div>
            </div>
          </div>

          {page && (
            <div className="ocr-view">
              <div className="ocr-view-head">
                <span className="field-label">
                  <ImageIcon size={15} aria-hidden="true" /> Recognised words
                </span>
                {result.pages.length > 1 && (
                  <div className="ocr-pager">
                    <button type="button" className="icon" aria-label="Previous page" onClick={() => setView((v) => Math.max(0, v - 1))} disabled={view === 0}>
                      <CaretLeft size={16} />
                    </button>
                    <span className="meta">
                      Page {page.n} <span className="ocr-of">({view + 1} of {result.pages.length})</span>
                    </span>
                    <button type="button" className="icon" aria-label="Next page" onClick={() => setView((v) => Math.min(result.pages.length - 1, v + 1))} disabled={view === result.pages.length - 1}>
                      <CaretRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="ocr-stage">
                <div className="ocr-frame" style={{ aspectRatio: `${page.width} / ${page.height}`, width: `min(100%, calc(70vh * ${page.width / page.height}))` }}>
                  <img src={page.url} alt={`Page ${page.n} of the source`} draggable={false} />
                  {page.words.map((w, i) => {
                    const on = active?.page === view && active.index === i
                    return (
                      <button
                        key={i}
                        type="button"
                        tabIndex={-1}
                        className={`ocr-box${w.confidence < 60 ? ' low' : ''}${on ? ' on' : ''}`}
                        style={{
                          left: `${(w.box.x0 / page.width) * 100}%`,
                          top: `${(w.box.y0 / page.height) * 100}%`,
                          width: `${((w.box.x1 - w.box.x0) / page.width) * 100}%`,
                          height: `${((w.box.y1 - w.box.y0) / page.height) * 100}%`,
                        }}
                        aria-label={`${w.text}, ${Math.round(w.confidence)}% confidence`}
                        onMouseEnter={() => setActive({ page: view, index: i })}
                        onClick={() => selectWord(view, i)}
                      />
                    )
                  })}
                </div>
              </div>
              <p className="ocr-caption" aria-live="polite">
                {activeWord && active.page === view ? (
                  <>
                    <strong>{activeWord.text}</strong> · {Math.round(activeWord.confidence)}% confidence
                  </>
                ) : (
                  <>Hover a box to see the word; click it to select it in the text. Outlined in orange: lower confidence.</>
                )}
              </p>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        Uses Tesseract (Apache 2.0 licence) compiled to WebAssembly. The engine and English data are served by this site and load only when you press Recognise.
        {result?.lang && result.lang !== 'English' ? ` ${result.lang} data came from jsDelivr.` : ''}
      </footer>
    </div>
  )
}
