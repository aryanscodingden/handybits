// Small helpers shared by the media tools (GIF maker, audio cutter, screen
// recorder, device test). No React, no heavy imports.

// 83.45 -> "1:23.4" (or "1:23" with digits = 0).
export function formatClock(s, digits = 1) {
  if (!Number.isFinite(s)) return '–'
  s = Math.max(0, s)
  const scale = 10 ** digits
  const total = Math.round(s * scale) / scale
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total - h * 3600 - m * 60
  const secStr = digits ? sec.toFixed(digits).padStart(digits + 3, '0') : String(Math.floor(sec)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${secStr}` : `${m}:${secStr}`
}

// "1:23.4", "83.4", "1:02:03" -> seconds, or null if it can't be read.
export function parseClock(str) {
  const parts = String(str).trim().split(':')
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d*(?:[.,]\d*)?$/.test(p) || p === '')) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p.replace(',', '.')), 0)
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'file'

// "recording-2026-10-12-1430"
export function stampName(prefix, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${prefix}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`
}

// Loads the ffmpeg engine on demand. Returns the module so callers can cancel.
export async function loadEngine(onProgress) {
  const lib = await import('./video-engine.js')
  await lib.load(onProgress)
  return lib
}

export function friendlyError(err) {
  const msg = String(err?.message || err || '')
  if (/memory|alloc|RangeError/i.test(msg)) return 'Your browser ran out of memory. Try a shorter clip or a smaller size, or close other tabs.'
  return msg || 'Something went wrong.'
}

// Stops every track in a stream (or array of streams); ignores nulls.
export function stopStreams(...streams) {
  for (const s of streams.flat()) s?.getTracks?.().forEach((t) => t.stop())
}

// Human help for getUserMedia / getDisplayMedia errors.
export function mediaErrorKind(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
  return 'other'
}
