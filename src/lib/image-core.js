// Pure helpers for the image compressor. No DOM access here, so they can be
// tested in Node.

export const FORMATS = {
  jpeg: { label: 'JPG', mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
  png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false, alpha: true },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
  avif: { label: 'AVIF', mime: 'image/avif', ext: 'avif', lossy: true, alpha: true },
}

const EXT_TO_FORMAT = { jpg: 'jpeg', jpeg: 'jpeg', jfif: 'jpeg', png: 'png', webp: 'webp', avif: 'avif' }

export function extOf(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function baseOf(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function isHeic(file) {
  const type = (file.type || '').toLowerCase()
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence') return true
  const ext = extOf(file.name || '')
  return ext === 'heic' || ext === 'heif'
}

export function isImageFile(file) {
  if (isHeic(file)) return true
  if ((file.type || '').startsWith('image/')) return true
  return ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'avif', 'gif', 'bmp'].includes(extOf(file.name || ''))
}

// The format key an original file maps to when "Same as original" is chosen.
// GIF, BMP and HEIC have no browser encoder, so they fall back: GIF/BMP keep
// transparency as PNG, HEIC photos become JPG.
export function sameFormat(file) {
  if (isHeic(file)) return 'jpeg'
  const type = (file.type || '').toLowerCase()
  const fromMime = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[type]
  if (fromMime) return fromMime
  const fromExt = EXT_TO_FORMAT[extOf(file.name || '')]
  if (fromExt) return fromExt
  return 'png'
}

// Fit (w, h) inside a max edge, never upscaling. Returns integers >= 1.
export function fitWithin(w, h, maxEdge) {
  if (!maxEdge || maxEdge <= 0 || (w <= maxEdge && h <= maxEdge)) return { width: w, height: h }
  const scale = maxEdge / Math.max(w, h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

// Give every output a unique name: photo.jpg, photo-2.jpg, photo-3.jpg …
// Comparison is case-insensitive since most file systems are.
export function dedupeNames(names) {
  const taken = new Set()
  return names.map((name) => {
    const base = baseOf(name)
    const suffix = name.slice(base.length)
    let candidate = name
    let n = 2
    while (taken.has(candidate.toLowerCase())) candidate = `${base}-${n++}${suffix}`
    taken.add(candidate.toLowerCase())
    return candidate
  })
}

export function outputName(original, formatKey) {
  return `${baseOf(original)}.${FORMATS[formatKey].ext}`
}

// Rounded percentage change from before to after; negative means smaller.
export function percentChange(before, after) {
  if (!before) return 0
  return Math.round(((after - before) / before) * 100)
}
