// Detects what a file really is by looking at its bytes first, and only
// falls back to the extension when the bytes are ambiguous (zip containers,
// plain text flavours).

export const KINDS = {
  pdf: { label: 'PDF' },
  image: { label: 'Image' },
  svg: { label: 'SVG' },
  docx: { label: 'Word' },
  sheet: { label: 'Spreadsheet' },
  csv: { label: 'CSV' },
  html: { label: 'HTML' },
  markdown: { label: 'Markdown' },
  json: { label: 'JSON' },
  text: { label: 'Text' },
  code: { label: 'Code' },
  unsupported: { label: 'Unsupported' },
}

const CODE_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh',
  'sql', 'css', 'scss', 'less', 'xml', 'yml', 'yaml', 'toml', 'ini', 'lua',
  'r', 'dart', 'scala', 'vue', 'svelte', 'dockerfile', 'makefile', 'env',
])

const UNSUPPORTED_HINTS = {
  doc: 'Legacy .doc files can’t be read in the browser. Save it as .docx and try again.',
  ppt: 'PowerPoint files can’t be rendered in the browser. Export to PDF from PowerPoint.',
  pptx: 'PowerPoint files can’t be rendered in the browser. Export to PDF from PowerPoint.',
  key: 'Keynote files can’t be rendered in the browser. Export to PDF from Keynote.',
  pages: 'Pages files can’t be rendered in the browser. Export to PDF from Pages.',
  odp: 'Presentation files can’t be rendered in the browser.',
  heic: 'This browser can’t decode HEIC photos. Try Safari, or convert to JPEG first.',
  heif: 'This browser can’t decode HEIC photos. Try Safari, or convert to JPEG first.',
  rtf: 'RTF isn’t supported yet. Save it as .docx or .txt and try again.',
}

function ext(name) {
  const base = name.toLowerCase().split('/').pop()
  const dot = base.lastIndexOf('.')
  if (dot === -1) return base === 'dockerfile' || base === 'makefile' ? base : ''
  return base.slice(dot + 1)
}

function startsWith(bytes, sig, offset = 0) {
  return sig.every((b, i) => bytes[offset + i] === b)
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function looksLikeText(bytes, truncated) {
  if (bytes.includes(0)) return false
  try {
    // fatal: true throws on invalid UTF-8. When the sample is only the start
    // of the file, stream mode tolerates a character cut off at the boundary.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated })
    return true
  } catch {
    return false
  }
}

// Office Open XML / OpenDocument are all zip files. Their central directory
// (at the end of the file) lists entry names that tell them apart.
async function sniffZip(file) {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 256 * 1024)).arrayBuffer())
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer())
  const names = new TextDecoder('latin1').decode(tail)
  if (names.includes('word/document')) return 'docx'
  if (names.includes('xl/workbook')) return 'xlsx'
  if (names.includes('ppt/presentation')) return 'pptx'
  const mime = new TextDecoder('latin1').decode(head)
  if (mime.includes('opendocument.spreadsheet')) return 'ods'
  if (mime.includes('opendocument.text')) return 'odt'
  if (mime.includes('opendocument.presentation')) return 'odp'
  if (mime.includes('application/vnd.apple')) return 'iwork'
  return 'zip'
}

function result(kind, format, note) {
  return { kind, format, label: KINDS[kind].label, note }
}

export async function detectType(file) {
  const e = ext(file.name)
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer())

  if (file.size === 0) return result('unsupported', e || 'empty', 'This file is empty.')

  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return result('pdf', 'pdf')
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return result('image', 'png')
  if (startsWith(head, [0xff, 0xd8, 0xff])) return result('image', 'jpeg')
  if (ascii(head, 0, 4) === 'GIF8') return result('image', 'gif')
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return result('image', 'webp')
  if (startsWith(head, [0x42, 0x4d]) && (e === 'bmp' || e === '')) return result('image', 'bmp')
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00]) && e === 'ico') return result('image', 'ico')

  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12)
    if (brand.startsWith('avi')) return result('image', 'avif')
    if (['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(brand)) {
      // Safari can decode HEIC natively; other browsers will fail at convert time.
      return result('image', 'heic', 'May only work in Safari.')
    }
    return result('unsupported', e || 'video', 'Video and audio files can’t be converted to PDF.')
  }

  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const z = await sniffZip(file)
    if (z === 'docx') return result('docx', 'docx')
    if (z === 'xlsx' || z === 'ods') return result('sheet', z)
    if (z === 'pptx' || z === 'odp') return result('unsupported', z, UNSUPPORTED_HINTS.pptx)
    if (z === 'odt') return result('unsupported', 'odt', 'OpenDocument text isn’t supported yet. Save it as .docx and try again.')
    if (z === 'iwork') return result('unsupported', e, UNSUPPORTED_HINTS[e] || 'Apple iWork files can’t be read in the browser.')
    return result('unsupported', 'zip', 'Zip archives can’t be converted. Extract the files first.')
  }

  // Legacy Office (OLE compound file): SheetJS can read old .xls, nothing else.
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) {
    if (e === 'xls') return result('sheet', 'xls')
    return result('unsupported', e || 'ole', UNSUPPORTED_HINTS[e] || 'Legacy Office files aren’t supported. Re-save in a modern format.')
  }

  if (looksLikeText(head, file.size > head.length)) {
    const sample = new TextDecoder().decode(head).trimStart().slice(0, 512).toLowerCase()
    if (sample.startsWith('{\\rtf')) return result('unsupported', 'rtf', UNSUPPORTED_HINTS.rtf)
    // A known binary format that happens to contain text is still that format.
    if (UNSUPPORTED_HINTS[e]) return result('unsupported', e, UNSUPPORTED_HINTS[e])
    if (e === 'svg' || (sample.includes('<svg') && !sample.includes('<html'))) return result('svg', 'svg')
    if (['html', 'htm', 'xhtml'].includes(e) || sample.startsWith('<!doctype html') || sample.startsWith('<html')) {
      return result('html', 'html')
    }
    if (['md', 'markdown', 'mdx'].includes(e)) return result('markdown', 'md')
    if (e === 'csv' || e === 'tsv') return result('csv', e)
    if (e === 'json' || e === 'geojson') return result('json', 'json')
    if (CODE_EXT.has(e)) return result('code', e)
    return result('text', e || 'txt')
  }

  if (UNSUPPORTED_HINTS[e]) return result('unsupported', e, UNSUPPORTED_HINTS[e])
  return result('unsupported', e || 'bin', 'This file type can’t be converted to PDF.')
}
