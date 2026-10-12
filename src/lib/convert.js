// All conversion runs locally in the browser. Rich documents (Word, sheets,
// Markdown, HTML) are rendered inside a sandboxed iframe whose Content
// Security Policy blocks every network request, then captured page by page.

import { jsPDF } from 'jspdf'
import { PDFDocument } from 'pdf-lib'
import html2canvas from 'html2canvas'
import DOMPurify from 'dompurify'
import { PAGE_SIZES } from './pages.js'


const MARGIN = 15 // mm
const PX_PER_MM = 96 / 25.4
const MAX_RENDER_WIDTH = 3000
const MAX_CANVAS_HEIGHT = 14000
// ~144 dpi page images: sharp text at a reasonable file size.
const RENDER_SCALE = 1.5
const JPEG_QUALITY = 0.85

const CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:"

function pageGeometry(sizeKey, landscape) {
  const s = PAGE_SIZES[sizeKey] || PAGE_SIZES.a4
  const w = landscape ? s.h : s.w
  const h = landscape ? s.w : s.h
  return { w, h, cw: w - MARGIN * 2, ch: h - MARGIN * 2, format: [s.w, s.h] }
}

function newDoc(sizeKey, landscape) {
  const g = pageGeometry(sizeKey, landscape)
  return new jsPDF({ unit: 'mm', format: g.format, orientation: landscape ? 'landscape' : 'portrait', compress: true })
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function readText(file) {
  return file.text().then((t) => t.replace(/^﻿/, '').replace(/\r\n?/g, '\n'))
}

// ---------- Images ----------

async function decodeImage(file, format) {
  if (format === 'svg') {
    const url = URL.createObjectURL(new Blob([await file.text()], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      // SVGs without intrinsic size report 0; render them at a sensible default.
      const w = img.naturalWidth || 1200
      const h = img.naturalHeight || 900
      return { source: img, width: w, height: h, scale: Math.min(4, 2400 / Math.max(w, h)) }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bmp, width: bmp.width, height: bmp.height, scale: 1 }
  } catch {
    // Some formats (e.g. HEIC in Safari) decode via <img> but not createImageBitmap.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, scale: 1 }
    } catch {
      throw new Error(
        format === 'heic'
          ? 'This browser can’t decode HEIC photos. Try Safari, or convert to JPEG first.'
          : 'This image couldn’t be decoded. It may be corrupted.',
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

async function imageToCanvas(file, format) {
  const { source, width, height, scale } = await decodeImage(file, format)
  // Cap very large images so we don't exhaust memory.
  const s = Math.min(scale, 6000 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * s))
  canvas.height = Math.max(1, Math.round(height * s))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  source.close?.()
  return canvas
}

// Flat graphics stay lossless; photos are stored as JPEG to keep PDFs small.
const LOSSLESS = new Set(['png', 'gif', 'svg', 'ico', 'bmp'])

// One image per page, page orientation following the image, centered.
async function imageToPdf(file, type, opts) {
  const canvas = await imageToCanvas(file, type.format)
  const landscape = canvas.width > canvas.height
  const g = pageGeometry(opts.pageSize, landscape)
  const doc = newDoc(opts.pageSize, landscape)
  const ratio = Math.min(g.cw / canvas.width, g.ch / canvas.height)
  const w = canvas.width * ratio
  const h = canvas.height * ratio
  const lossless = LOSSLESS.has(type.format)
  const data = canvas.toDataURL(lossless ? 'image/png' : 'image/jpeg', 0.92)
  doc.addImage(data, lossless ? 'PNG' : 'JPEG', (g.w - w) / 2, (g.h - h) / 2, w, h, undefined, 'FAST')
  return doc
}

// ---------- Plain text / code ----------

const WIN_ANSI_SAFE = /^[\n\t\x20-\x7e\xa0-\xff]*$/

async function textToPdf(file, type, opts) {
  let text = await readText(file)
  if (type.kind === 'json') {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      // Not valid JSON; print it as-is.
    }
  }
  text = text.replace(/\t/g, '    ')
  const mono = type.kind !== 'text'

  // jsPDF's built-in fonts only cover Latin-1. For anything else (CJK,
  // Cyrillic, emoji…) render through the browser so every glyph shows up.
  if (!WIN_ANSI_SAFE.test(text)) {
    const body = text
      .split('\n')
      .map((l) => `<div class="line">${l ? escapeHtml(l) : '&nbsp;'}</div>`)
      .join('')
    return htmlToPdf(`<div class="${mono ? 'mono' : 'prose'} text">${body}</div>`, opts)
  }

  const doc = newDoc(opts.pageSize, false)
  const g = pageGeometry(opts.pageSize, false)
  const size = mono ? 9 : 11
  const lineH = size * 0.3528 * (mono ? 1.45 : 1.5)
  doc.setFont(mono ? 'courier' : 'helvetica', 'normal')
  doc.setFontSize(size)

  let y = MARGIN
  for (const raw of text.split('\n')) {
    const lines = raw === '' ? [''] : doc.splitTextToSize(raw, g.cw)
    for (const line of lines) {
      if (y + lineH > g.h - MARGIN) {
        doc.addPage()
        y = MARGIN
      }
      if (line) doc.text(line, MARGIN, y, { baseline: 'top' })
      y += lineH
    }
  }
  return doc
}

// ---------- HTML-rendered documents ----------

const BASE_CSS = `
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, "Noto Sans", sans-serif; overflow-wrap: break-word; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; }
  h1 { font-size: 26px; } h2 { font-size: 21px; } h3 { font-size: 17px; }
  p, ul, ol, blockquote, pre, table, figure { margin: 0 0 0.9em; }
  img, svg { max-width: 100%; height: auto; }
  /* html2canvas draws collapsed borders twice, so build single lines by hand. */
  table { border-collapse: separate; border-spacing: 0; border-top: 1px solid #999; border-left: 1px solid #999; }
  th, td { border: 0; border-right: 1px solid #999; border-bottom: 1px solid #999; padding: 4px 8px; vertical-align: top; text-align: left; }
  td > p:last-child, th > p:last-child { margin-bottom: 0; }
  li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.2em; }
  th { font-weight: 600; }
  blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #000; color: #333; }
  code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", monospace; font-size: 12px; }
  pre { white-space: pre-wrap; padding: 10px 12px; border: 1px solid #ddd; }
  hr { border: 0; border-top: 1px solid #000; }
  .text .line { white-space: pre-wrap; min-height: 1em; }
  .mono .line { line-height: 1.45; }
  .sheet-title { font-size: 16px; margin: 0 0 10px; }
  .sheet { margin-bottom: 28px; }
  .sheet table { font-size: 11px; }
  .sheet td, .sheet th { white-space: nowrap; padding: 3px 6px; }
  .note { color: #666; font-size: 12px; }
`

// Drop references to remote resources before rendering, so the browser never
// even attempts a request (the iframe's CSP would block it anyway).
const RESOURCE_ATTRS = new Set(['src', 'srcset', 'poster', 'background', 'xlink:href'])
const REMOTE_URL = /(^|[\s,])(https?:)?\/\//i
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (RESOURCE_ATTRS.has(data.attrName) && REMOTE_URL.test(data.attrValue)) data.keepAttr = false
})

function sanitize(html) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'],
    ADD_TAGS: ['style'],
  })
}

function buildDocument({ head = '', body, htmlAttrs = '', bodyAttrs = '', baseCss = true }) {
  return `<!doctype html><html ${htmlAttrs}><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>${baseCss ? BASE_CSS : 'html,body{background:#fff}'}</style>${head}</head>
<body ${bodyAttrs}>${body}</body></html>`
}

function attrs(el) {
  return [...el.attributes]
    .filter((a) => ['class', 'style', 'dir', 'lang'].includes(a.name))
    .map((a) => `${a.name}="${escapeHtml(a.value)}"`)
    .join(' ')
}

// For user-provided HTML: keep their <style> blocks and body markup, drop
// scripts and anything that could reach the network.
function prepareUserHtml(source) {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const styles = [...parsed.querySelectorAll('style')].map((s) => `<style>${s.textContent}</style>`).join('')
  return buildDocument({
    head: styles,
    body: sanitize(parsed.body.innerHTML),
    htmlAttrs: attrs(parsed.documentElement),
    bodyAttrs: attrs(parsed.body),
    baseCss: false,
  })
}

async function mountFrame(html, width) {
  const iframe = document.createElement('iframe')
  // No allow-scripts: nothing inside the document can execute.
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = `position:fixed;left:-${width + 10000}px;top:0;width:${width}px;height:800px;border:0;`
  const loaded = new Promise((resolve) => (iframe.onload = resolve))
  iframe.srcdoc = html
  document.body.appendChild(iframe)
  await loaded
  const doc = iframe.contentDocument
  await Promise.all([...doc.images].map((img) => img.decode().catch(() => {})))
  await doc.fonts?.ready
  return { iframe, doc }
}

const BREAK_TARGETS = 'p,h1,h2,h3,h4,h5,h6,li,tr,img,svg,figure,blockquote,pre,dt,dd,caption,.line,.sheet-title'

// Choose page cut positions that avoid slicing through lines, rows or images.
function paginate(doc, totalHeight, pageHeight) {
  const blocks = [...doc.querySelectorAll(BREAK_TARGETS)].map((el) => {
    const r = el.getBoundingClientRect()
    // Treat headings as taller so they stay with the content that follows.
    const keepWithNext = /^H[1-6]$/.test(el.tagName) || el.classList.contains('sheet-title')
    return { top: r.top, bottom: r.bottom + (keepWithNext ? 48 : 0) }
  })

  const cuts = []
  let start = 0
  while (start < totalHeight - 1) {
    const end = start + pageHeight
    if (end >= totalHeight) {
      cuts.push([start, totalHeight])
      break
    }
    let cut = end
    for (const b of blocks) {
      if (b.top > start + 1 && b.top < cut && b.bottom > end && b.bottom - b.top <= pageHeight) cut = b.top
    }
    // Don't leave a mostly-empty page just to keep one block together.
    if (cut - start < pageHeight * 0.3) cut = end
    cuts.push([start, cut])
    start = cut
  }
  return cuts
}

async function htmlToPdf(bodyHtml, opts, { fullDocument = false, preferLandscape = false } = {}) {
  const html = fullDocument ? bodyHtml : buildDocument({ body: bodyHtml })
  let landscape = preferLandscape
  let g = pageGeometry(opts.pageSize, landscape)
  let width = Math.round(g.cw * PX_PER_MM)
  const { iframe, doc } = await mountFrame(html, width)

  try {
    const root = doc.documentElement
    // Wide content (big tables, fixed layouts): try landscape, then scale down.
    if (root.scrollWidth > width + 2 && !landscape) {
      landscape = true
      g = pageGeometry(opts.pageSize, true)
      width = Math.round(g.cw * PX_PER_MM)
      iframe.style.width = `${width}px`
    }
    if (root.scrollWidth > width + 2) {
      width = Math.min(root.scrollWidth, MAX_RENDER_WIDTH)
      iframe.style.width = `${width}px`
    }

    const total = Math.max(root.scrollHeight, 1)
    iframe.style.height = `${total}px`
    const pxPerMm = width / g.cw
    const pageHeight = Math.floor(g.ch * pxPerMm)
    const pages = paginate(doc, total, pageHeight)
    const scale = Math.min(RENDER_SCALE, 2000 / width)

    const pdf = newDoc(opts.pageSize, landscape)

    // Render several pages per html2canvas call (each call clones the whole
    // document), staying under browser canvas size limits.
    let i = 0
    while (i < pages.length) {
      let j = i
      while (j + 1 < pages.length && (pages[j + 1][1] - pages[i][0]) * scale <= MAX_CANVAS_HEIGHT) j++
      const top = pages[i][0]
      const chunk = await html2canvas(root, {
        y: top,
        height: pages[j][1] - top,
        width,
        windowWidth: width,
        windowHeight: total,
        scale,
        backgroundColor: '#ffffff',
        logging: false,
      })
      for (let k = i; k <= j; k++) {
        const [s, e] = pages[k]
        const slice = document.createElement('canvas')
        slice.width = chunk.width
        slice.height = Math.max(1, Math.round((e - s) * scale))
        const ctx = slice.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, slice.width, slice.height)
        ctx.drawImage(chunk, 0, Math.round((s - top) * scale), slice.width, slice.height, 0, 0, slice.width, slice.height)
        if (k > 0) pdf.addPage(g.format, landscape ? 'landscape' : 'portrait')
        pdf.addImage(slice.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', MARGIN, MARGIN, g.cw, (e - s) / pxPerMm, undefined, 'FAST')
      }
      i = j + 1
    }
    return pdf
  } finally {
    iframe.remove()
  }
}

async function docxToPdf(file, opts) {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  if (!value.trim()) throw new Error('This Word document appears to be empty.')
  return htmlToPdf(sanitize(value), opts)
}

const MAX_SHEET_ROWS = 5000

async function sheetToPdf(file, type, opts) {
  const XLSX = await import('xlsx')
  const wb =
    type.kind === 'csv'
      ? XLSX.read(await readText(file), { type: 'string', raw: true })
      : XLSX.read(await file.arrayBuffer(), { type: 'array' })

  const parts = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws['!ref']) continue
    const range = XLSX.utils.decode_range(ws['!ref'])
    let note = ''
    if (range.e.r - range.s.r + 1 > MAX_SHEET_ROWS) {
      range.e.r = range.s.r + MAX_SHEET_ROWS - 1
      ws['!ref'] = XLSX.utils.encode_range(range)
      note = `<p class="note">Showing the first ${MAX_SHEET_ROWS.toLocaleString()} rows.</p>`
    }
    const table = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' })
    const title = wb.SheetNames.length > 1 ? `<h2 class="sheet-title">${escapeHtml(name)}</h2>` : ''
    parts.push(`<section class="sheet">${title}${table}${note}</section>`)
  }
  if (!parts.length) throw new Error('This spreadsheet has no data.')
  return htmlToPdf(sanitize(parts.join('')), opts)
}

async function markdownToPdf(file, opts) {
  const { marked } = await import('marked')
  const html = await marked.parse(await readText(file), { gfm: true })
  return htmlToPdf(sanitize(html), opts)
}

async function userHtmlToPdf(file, opts) {
  return htmlToPdf(prepareUserHtml(await readText(file)), opts, { fullDocument: true })
}

// ---------- PDFs ----------

async function countPdfPages(bytes) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return pdf.getPageCount()
}

// ---------- Public API ----------

function finish(doc) {
  const bytes = new Uint8Array(doc.output('arraybuffer'))
  return { bytes, pages: doc.getNumberOfPages() }
}

export async function convertToPdf(file, type, opts) {
  switch (type.kind) {
    case 'pdf': {
      const bytes = new Uint8Array(await file.arrayBuffer())
      try {
        return { bytes, pages: await countPdfPages(bytes) }
      } catch {
        throw new Error('This PDF is damaged and couldn’t be opened.')
      }
    }
    case 'image':
    case 'svg':
      return finish(await imageToPdf(file, type, opts))
    case 'text':
    case 'code':
    case 'json':
      return finish(await textToPdf(file, type, opts))
    case 'markdown':
      return finish(await markdownToPdf(file, opts))
    case 'html':
      return finish(await userHtmlToPdf(file, opts))
    case 'docx':
      return finish(await docxToPdf(file, opts))
    case 'sheet':
    case 'csv':
      return finish(await sheetToPdf(file, type, opts))
    default:
      throw new Error(type.note || 'This file type can’t be converted to PDF.')
  }
}

export { mergePdfs } from './pdf.js'
