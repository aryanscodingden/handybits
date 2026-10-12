// Image preparation for OCR. Light enough to load with the tool; the OCR
// engine itself lives in ocr-engine.js and loads only when recognition runs.

// Languages offered. English ships with the site; the rest are fetched from
// jsDelivr on first use (sizes are the gzipped LSTM data, in MB).
export const LANGUAGES = [
  { code: 'eng', label: 'English', local: true },
  { code: 'spa', label: 'Spanish', mb: 2.1 },
  { code: 'fra', label: 'French', mb: 0.7 },
  { code: 'deu', label: 'German', mb: 1.3 },
  { code: 'por', label: 'Portuguese', mb: 1.4 },
  { code: 'ita', label: 'Italian', mb: 1.7 },
  { code: 'hin', label: 'Hindi', mb: 1.4 },
  { code: 'chi_sim', label: 'Chinese (simplified)', mb: 1.7 },
  { code: 'jpn', label: 'Japanese', mb: 2.0 },
  { code: 'ara', label: 'Arabic', mb: 1.7 },
  { code: 'rus', label: 'Russian', mb: 2.7 },
]

const MAX_PIXELS = 24_000_000

export const toBlob = (canvas, type = 'image/png', quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode the image.'))), type, quality))

// Decodes an image file (EXIF orientation applied) onto a canvas.
export async function imageToCanvas(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  let { width, height } = bitmap
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // Transparent screenshots read better on white.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return canvas
}

// Tesseract does best with text around 30px tall. Small images (screenshots
// of a few lines, thumbnails) are upscaled, then converted to grayscale with
// the contrast stretched. Returns a new canvas, or the input if unchanged.
export function enhance(canvas) {
  const long = Math.max(canvas.width, canvas.height)
  const factor = long < 1000 ? Math.min(3, 2000 / long) : 1
  const w = Math.round(canvas.width * factor)
  const h = Math.round(canvas.height * factor)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    d[i] = y
    hist[d[i]]++
  }
  // Stretch between the 1st and 99th percentiles.
  const total = w * h
  let lo = 0
  let hi = 255
  let acc = hist[0]
  while (lo < 255 && acc < total * 0.01) acc += hist[++lo]
  acc = hist[255]
  while (hi > 0 && acc < total * 0.01) acc += hist[--hi]
  const range = hi - lo > 24 ? hi - lo : 0
  for (let i = 0; i < d.length; i += 4) {
    const v = range ? Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range)) : d[i]
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return out
}

// Joins page texts and works out where each recognised word sits in the
// joined text, so a box on the image can select its word and back.
export function joinPages(pages) {
  const multi = pages.length > 1
  let text = ''
  const words = []
  pages.forEach((p, pi) => {
    if (multi) text += `${pi ? '\n\n' : ''}--- Page ${p.n} ---\n`
    const body = (p.text || '').replace(/\s+$/, '')
    const offset = text.length
    let cursor = 0
    p.words.forEach((w, wi) => {
      const at = body.indexOf(w.text, cursor)
      if (at === -1) return
      cursor = at + w.text.length
      words.push({ page: pi, index: wi, start: offset + at, end: offset + cursor })
    })
    text += body
  })
  return { text, words }
}

// Mean word confidence (0-100) and the number of doubtful words.
export function confidenceOf(pages) {
  const all = pages.flatMap((p) => p.words)
  if (!all.length) return { mean: 0, low: 0, words: 0 }
  const mean = all.reduce((n, w) => n + w.confidence, 0) / all.length
  return { mean: Math.round(mean), low: all.filter((w) => w.confidence < 60).length, words: all.length }
}
