// Page-level PDF work shared by the PDF tools. pdf-lib edits documents;
// pdf.js (loaded on demand, in a worker) renders pages to canvases.

import { PDFDocument, degrees } from 'pdf-lib'

export async function mergePdfs(list) {
  const out = await PDFDocument.create()
  for (const bytes of list) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const copied = await out.copyPages(src, src.getPageIndices())
    copied.forEach((p) => out.addPage(p))
  }
  return { bytes: await out.save(), pages: out.getPageCount() }
}

// Builds a new PDF from a list of pages, each `{ doc, index, rotation }`, where
// `doc` is the source PDF's bytes and `rotation` is extra clockwise degrees.
// Pages from the same source are copied in one pass.
export async function assemblePages(pages) {
  const out = await PDFDocument.create()
  const loaded = new Map()
  for (const { doc, index, rotation = 0 } of pages) {
    if (!loaded.has(doc)) loaded.set(doc, await PDFDocument.load(doc, { ignoreEncryption: true }))
    const [page] = await out.copyPages(loaded.get(doc), [index])
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360))
    out.addPage(page)
  }
  return { bytes: await out.save(), pages: out.getPageCount() }
}

let pdfjsPromise = null

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
  }
  return pdfjsPromise
}

// Opens a PDF with pdf.js. pdf.js takes ownership of the buffer it's given,
// so it gets a copy and the caller's bytes stay usable.
export async function openPdf(bytes) {
  const pdfjs = await loadPdfjs()
  return pdfjs.getDocument({ data: bytes.slice() }).promise
}

// Frees a document opened with openPdf. In pdf.js 6 this lives on the
// loading task; older versions had it on the document.
export function closePdf(pdf) {
  if (!pdf) return
  const task = pdf.loadingTask
  const done = task?.destroy ? task.destroy() : pdf.destroy?.()
  done?.catch?.(() => {})
}

// Renders one page (1-based) to a canvas at the given width in CSS pixels.
export async function renderPage(pdf, pageNumber, { width, scale } = {}) {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: scale ?? width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
  page.cleanup()
  return canvas
}

// A plain-language message for a PDF that pdf.js or pdf-lib refused to open.
export function pdfErrorMessage(err) {
  const name = err?.name || ''
  const msg = String(err?.message || '')
  if (name === 'PasswordException' || name === 'EncryptedPDFError' || /password|encrypt/i.test(msg)) {
    return 'This PDF is password-protected or encrypted. Remove the protection and try again.'
  }
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' || /invalid pdf|no pdf header|failed to parse|unexpected/i.test(msg)) {
    return 'This file looks damaged or isn’t a PDF.'
  }
  return 'Couldn’t read this PDF. It may be damaged.'
}

// Checks that pdf-lib can edit a PDF (encrypted files would come out garbled)
// and returns its page count. Throws an Error with a friendly message.
export async function checkEditable(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    return doc.getPageCount()
  } catch (err) {
    throw new Error(pdfErrorMessage(err), { cause: err })
  }
}

// Like assemblePages, but returns one PDF per page (for "split").
export async function splitPages(pages) {
  const loaded = new Map()
  const results = []
  for (const { doc, index, rotation = 0 } of pages) {
    if (!loaded.has(doc)) loaded.set(doc, await PDFDocument.load(doc, { ignoreEncryption: true }))
    const out = await PDFDocument.create()
    const [page] = await out.copyPages(loaded.get(doc), [index])
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360))
    out.addPage(page)
    results.push(await out.save())
  }
  return results
}

const MAX_PIXELS = 16_000_000

// Rebuilds a PDF from JPEG renders of its pages. `dpi` sets the render
// resolution, `quality` the JPEG quality (0-1). Every page keeps its size in
// points. Text becomes part of the image.
export async function rasterizePdf(bytes, { dpi = 110, quality = 0.65, onProgress } = {}) {
  const pdf = await openPdf(bytes)
  const out = await PDFDocument.create()
  try {
    const total = pdf.numPages
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n)
      const size = page.getViewport({ scale: 1 })
      let scale = dpi / 72
      const pixels = size.width * size.height * scale * scale
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode a page.'))), 'image/jpeg', quality),
      )
      // Free the canvas memory right away; big PDFs otherwise pile up.
      canvas.width = canvas.height = 0
      page.cleanup()
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()))
      const outPage = out.addPage([size.width, size.height])
      outPage.drawImage(jpg, { x: 0, y: 0, width: size.width, height: size.height })
      onProgress?.(n, total)
    }
  } finally {
    closePdf(pdf)
  }
  return { bytes: await out.save(), pages: out.getPageCount() }
}

const normalizeAngle = (a) => (((Math.round(a / 90) * 90) % 360) + 360) % 360

// Maps a rectangle given in fractions of the page as displayed (rotation
// applied, origin top-left) to pdf-lib drawImage options in PDF user space
// (origin bottom-left, unrotated). `box` is the page's crop box.
export function toPdfPlacement({ x, y, w, h }, box, rotation) {
  const r = normalizeAngle(rotation)
  const odd = r === 90 || r === 270
  const dispW = odd ? box.height : box.width
  const dispH = odd ? box.width : box.height
  const W = box.width
  const H = box.height
  // Display point (points, top-left origin) -> unrotated user space.
  const toUser = (dx, dy) => {
    if (r === 90) return [dy, dx]
    if (r === 180) return [W - dx, dy]
    if (r === 270) return [W - dy, H - dx]
    return [dx, H - dy]
  }
  // The image's own bottom-left corner sits at the rect's displayed bottom-left.
  const [ux, uy] = toUser(x * dispW, (y + h) * dispH)
  return { x: box.x + ux, y: box.y + uy, width: w * dispW, height: h * dispH, rotate: degrees(r) }
}

// Draws PNG stamps onto pages. Each stamp is
// `{ page (0-based), x, y, w, h (fractions of the displayed page), png }`,
// where `png` is a Uint8Array. Identical PNGs are embedded once.
export async function stampPdf(bytes, stamps) {
  const doc = await PDFDocument.load(bytes)
  const embedded = new Map()
  for (const s of stamps) {
    if (!embedded.has(s.png)) embedded.set(s.png, await doc.embedPng(s.png))
    const page = doc.getPage(s.page)
    const opts = toPdfPlacement(s, page.getCropBox(), page.getRotation().angle)
    page.drawImage(embedded.get(s.png), opts)
  }
  return { bytes: await doc.save(), pages: doc.getPageCount() }
}

// Parses a page selection like "1-3, 5, 8-" into sorted, unique ranges.
// Returns { ranges: [[from, to]] } (to may be Infinity) or { error }.
// An empty string means every page.
export function parsePageRange(input) {
  const text = String(input || '').trim()
  if (!text) return { ranges: [[1, Infinity]] }
  const ranges = []
  for (const raw of text.split(/[,;]+/)) {
    const part = raw.trim().replace(/[–—]/g, '-')
    if (!part) continue
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/)
    if (m && (m[1] || m[2])) {
      const from = m[1] ? Number(m[1]) : 1
      const to = m[2] ? Number(m[2]) : Infinity
      if (from < 1 || to < 1) return { error: 'Page numbers start at 1.' }
      if (from > to) return { error: `“${part}” goes backwards. Write it as ${to}-${from}.` }
      ranges.push([from, to])
    } else if (/^\d+$/.test(part)) {
      const n = Number(part)
      if (n < 1) return { error: 'Page numbers start at 1.' }
      ranges.push([n, n])
    } else {
      return { error: `“${part}” isn’t a page or range. Use numbers like 1-3, 5.` }
    }
  }
  if (!ranges.length) return { ranges: [[1, Infinity]] }
  return { ranges }
}

// The page numbers (1-based, ascending, unique) a parsed range selects from a
// document with `total` pages.
export function pagesInRange(ranges, total) {
  const set = new Set()
  for (const [from, to] of ranges) for (let n = from; n <= Math.min(to, total); n++) set.add(n)
  return [...set].sort((a, b) => a - b)
}

// Renders a page (1-based) at a resolution in dots per inch onto a white
// canvas, scaled down if needed to stay under `maxPixels` and the browser's
// canvas edge limit. The caller frees the canvas (set width/height to 0).
export async function renderPageAtDpi(pdf, pageNumber, { dpi = 150, maxPixels = 40_000_000, maxEdge = 16_384, background = '#fff' } = {}) {
  const page = await pdf.getPage(pageNumber)
  try {
    const size = page.getViewport({ scale: 1 })
    let scale = dpi / 72
    const pixels = size.width * size.height * scale * scale
    if (pixels > maxPixels) scale *= Math.sqrt(maxPixels / pixels)
    const edge = Math.max(size.width, size.height) * scale
    if (edge > maxEdge) scale *= maxEdge / edge
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const ctx = canvas.getContext('2d')
    if (background) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return { canvas, reduced: scale < dpi / 72 - 1e-6 }
  } finally {
    page.cleanup()
  }
}
