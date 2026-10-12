// Pure helpers for the developer tools. No DOM; crypto via globalThis.crypto.

// ---------- JSON ----------

// Recursively sort object keys (arrays keep their order).
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
    return out
  }
  return v
}

// Line/column (1-based) of a character offset.
export function lineCol(text, offset) {
  let line = 1
  let last = -1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      last = i
    }
  }
  return { line, column: offset - last }
}

// Work out where JSON.parse failed. V8 messages look like
// "Unexpected token } in JSON at position 12" or "... (line 2 column 5)".
export function jsonErrorPosition(text, message) {
  let m = message.match(/line (\d+) column (\d+)/)
  if (m) {
    const line = +m[1]
    const column = +m[2]
    const lines = text.split('\n')
    let offset = 0
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1
    return { line, column, offset: offset + column - 1 }
  }
  m = message.match(/position (\d+)/)
  if (m) {
    const offset = +m[1]
    return { ...lineCol(text, offset), offset }
  }
  if (/end of (JSON|data) input|Unexpected end/i.test(message)) {
    const offset = text.length
    return { ...lineCol(text, offset), offset }
  }
  return null
}

// Browsers disagree on whether JSON.parse errors include a position, so on
// failure we scan the text ourselves to find the first bad character.
export function findJsonError(text) {
  let i = 0
  const n = text.length
  const fail = (message) => {
    throw { message, offset: Math.min(i, n) }
  }
  const ws = () => {
    while (i < n && (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t")) i++
  }
  const desc = () => (i >= n ? "Unexpected end of input" : `Unexpected ${JSON.stringify(text[i])}`)
  const lit = (word) => {
    for (let k = 0; k < word.length; k++, i++) if (text[i] !== word[k]) fail(desc())
  }
  const str = () => {
    i++
    while (i < n) {
      const c = text[i]
      if (c === "\"") {
        i++
        return
      }
      if (c === "\\") {
        i++
        if (text[i] === "u") {
          i++
          for (let k = 0; k < 4; k++, i++) if (!/[0-9a-fA-F]/.test(text[i] || "")) fail("Bad unicode escape in string")
          continue
        }
        if (!"\"\\/bfnrt".includes(text[i] || "x")) fail("Bad escape in string")
        i++
        continue
      }
      if (c < " ") fail(c === "\n" ? "Unterminated string (line break inside quotes)" : "Control character in string")
      i++
    }
    fail("Unterminated string")
  }
  const num = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400))
    if (!m || !m[0] || m[0] === "-") fail(desc())
    i += m[0].length
  }
  const value = (depth) => {
    if (depth > 5000) fail("Nested too deeply")
    ws()
    const c = text[i]
    if (c === "{") {
      i++
      ws()
      if (text[i] === "}") return i++
      for (;;) {
        ws()
        if (text[i] === "\x27") fail("Keys need double quotes, not single quotes")
        if (text[i] !== "\"") fail(text[i] === "}" ? "Trailing comma before }" : `Expected a "quoted" key but found ${i >= n ? "the end" : JSON.stringify(text[i])}`)
        str()
        ws()
        if (text[i] !== ":") fail(`Expected : after the key but found ${i >= n ? "the end" : JSON.stringify(text[i])}`)
        i++
        value(depth + 1)
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "}") return i++
        if (/["[{\dtfn-]/.test(text[i] || "")) fail("Missing , between values")
        fail(i >= n ? "Unexpected end of input, missing }" : `Expected , or } but found ${JSON.stringify(text[i])}`)
      }
    }
    if (c === "[") {
      i++
      ws()
      if (text[i] === "]") return i++
      for (;;) {
        ws()
        if (text[i] === "]") fail("Trailing comma before ]")
        if (text[i] === ",") fail("Unexpected , (missing value)")
        value(depth + 1)
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "]") return i++
        if (/["[{\dtfn-]/.test(text[i] || "")) fail("Missing , between values")
        fail(i >= n ? "Unexpected end of input, missing ]" : `Expected , or ] but found ${JSON.stringify(text[i])}`)
      }
    }
    if (c === "\"") return str()
    if (c === "t") return lit("true")
    if (c === "f") return lit("false")
    if (c === "n") return lit("null")
    if (c === "-" || (c >= "0" && c <= "9")) return num()
    if (c === "\x27") fail("Strings need double quotes, not single quotes")
    fail(desc())
  }
  try {
    value(0)
    ws()
    if (i < n) fail(`Unexpected ${JSON.stringify(text[i])} after the end of the JSON`)
    return null
  } catch (e) {
    if (e instanceof RangeError) return { message: "Nested too deeply", offset: 0 }
    return e
  }
}

// Returns { ok: true, value } or { ok: false, message, line, column, offset }.
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    const found = findJsonError(text)
    if (found) return { ok: false, message: found.message, offset: found.offset, ...lineCol(text, found.offset) }
    const pos = jsonErrorPosition(text, err.message || "")
    return { ok: false, message: err.message || "Invalid JSON", ...(pos || {}) }
  }
}

export function formatJson(value, indent, sorted = false) {
  const v = sorted ? sortKeys(value) : value
  return JSON.stringify(v, null, indent === 'tab' ? '\t' : indent === 0 ? undefined : indent)
}

// ---------- Base64 (UTF-8 safe) ----------

export function bytesToBase64(bytes, urlSafe = false) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  const b64 = btoa(bin)
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64
}

// Accepts standard or URL-safe, with or without padding/whitespace. Throws on bad input.
export function base64ToBytes(input) {
  let s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error('Contains characters that aren’t Base64')
  s = s.replace(/=+$/, '')
  if (s.length % 4 === 1) throw new Error('The length isn’t valid for Base64')
  s += '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const encodeBase64Text = (text, urlSafe = false) => bytesToBase64(new TextEncoder().encode(text), urlSafe)

// Returns { text, valid } where valid is false if the bytes aren't UTF-8.
export function decodeBase64Text(b64) {
  const bytes = base64ToBytes(b64)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), valid: true, bytes }
  } catch {
    return { text: new TextDecoder().decode(bytes), valid: false, bytes }
  }
}

// Split "data:image/png;base64,AAAA" into { mime, data }.
export function splitDataUrl(s) {
  const m = s.trim().match(/^data:([^;,]*)(;[^,]*)?,(.*)$/s)
  if (!m) return { mime: '', data: s }
  return { mime: m[1] || 'application/octet-stream', data: m[3], base64: /;base64/i.test(m[2] || '') }
}

// Guess a file type from magic bytes so decoded downloads get a sensible name.
export function sniffType(bytes) {
  const b = bytes
  const starts = (...sig) => sig.every((v, i) => b[i] === v)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', ext: 'png' }
  if (starts(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg' }
  if (starts(0x47, 0x49, 0x46, 0x38)) return { mime: 'image/gif', ext: 'gif' }
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return { mime: 'image/webp', ext: 'webp' }
  if (starts(0x25, 0x50, 0x44, 0x46)) return { mime: 'application/pdf', ext: 'pdf' }
  if (starts(0x50, 0x4b, 0x03, 0x04)) return { mime: 'application/zip', ext: 'zip' }
  if (starts(0x1f, 0x8b)) return { mime: 'application/gzip', ext: 'gz' }
  return null
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'application/json': 'json', 'text/plain': 'txt', 'application/zip': 'zip' }
export const extForMime = (mime) => EXT[mime] || 'bin'

// ---------- URL ----------

export function parseUrl(input) {
  const url = new URL(input.trim())
  return {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    params: [...url.searchParams.entries()],
  }
}

// ---------- UUID ----------

function hex(bytes) {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

function dashed(h) {
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function uuidv4() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  return dashed(hex(b))
}

// RFC 9562 UUIDv7: 48-bit Unix ms timestamp, version, 12 bits of rand_a used as
// a monotonic counter within the same millisecond, variant, 62 random bits.
let lastMs = -1
let seq = 0
export function uuidv7(now = Date.now()) {
  const b = crypto.getRandomValues(new Uint8Array(16))
  let ms = now
  if (ms <= lastMs) {
    ms = lastMs
    seq++
    if (seq > 0xfff) {
      // Counter overflow: borrow the next millisecond to stay ordered.
      ms = ++lastMs
      seq = 0
    }
  } else {
    // Random start in the lower half so there is room to count up.
    seq = ((b[6] & 0x07) << 8) | b[7]
  }
  lastMs = ms
  b[0] = Math.floor(ms / 2 ** 40) & 0xff
  b[1] = Math.floor(ms / 2 ** 32) & 0xff
  b[2] = Math.floor(ms / 2 ** 24) & 0xff
  b[3] = Math.floor(ms / 2 ** 16) & 0xff
  b[4] = Math.floor(ms / 2 ** 8) & 0xff
  b[5] = ms & 0xff
  b[6] = 0x70 | ((seq >> 8) & 0x0f)
  b[7] = seq & 0xff
  b[8] = (b[8] & 0x3f) | 0x80
  return dashed(hex(b))
}

// Read the timestamp back out of a v7 UUID.
export function uuidv7Time(u) {
  const h = u.replace(/-/g, '').slice(0, 12)
  return parseInt(h, 16)
}

// ---------- Hash ----------

export const HASHES = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']

export async function digest(algo, data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return new Uint8Array(await crypto.subtle.digest(algo, buf))
}

export const toHexString = hex

// Normalise a pasted hash (hex any case, or base64) so it can be compared.
export function normaliseHash(s) {
  return s.trim().replace(/\s+/g, '')
}

export function hashesMatch(expected, bytes) {
  const e = normaliseHash(expected)
  if (!e) return null
  if (/^[0-9a-f]+$/i.test(e)) return e.toLowerCase() === hex(bytes)
  try {
    const eb = base64ToBytes(e)
    return eb.length === bytes.length && eb.every((v, i) => v === bytes[i])
  } catch {
    return false
  }
}

// ---------- JWT ----------

function decodePart(part, name) {
  let text
  try {
    text = decodeBase64Text(part).text
  } catch {
    throw new Error(`The ${name} isn’t valid Base64URL`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`The ${name} isn’t valid JSON`)
  }
}

export function decodeJwt(token) {
  const t = token.trim().replace(/^Bearer\s+/i, '')
  const parts = t.split('.')
  if (parts.length !== 3) throw new Error(parts.length === 5 ? 'This looks like an encrypted token (JWE), which can’t be decoded without the key' : 'A JWT has three parts separated by dots')
  return { header: decodePart(parts[0], 'header'), payload: decodePart(parts[1], 'payload'), signature: parts[2] }
}

// ---------- Time ----------

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null
const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

// relativeTime(target, now) -> "3 days ago", "in 2 hours", "now"
export function relativeTime(targetMs, nowMs = Date.now()) {
  const diff = (targetMs - nowMs) / 1000
  const abs = Math.abs(diff)
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === 'second') {
      const v = Math.round(diff / secs)
      return rtf ? rtf.format(v, unit) : `${v} ${unit}s`
    }
  }
  return ''
}

// Interpret a number as seconds, milliseconds, microseconds or nanoseconds by size.
export function detectEpoch(input) {
  const s = String(input).trim()
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  const abs = Math.abs(n)
  if (abs < 1e11) return { ms: n * 1000, unit: 'seconds' }
  if (abs < 1e14) return { ms: n, unit: 'milliseconds' }
  if (abs < 1e17) return { ms: n / 1000, unit: 'microseconds' }
  return { ms: n / 1e6, unit: 'nanoseconds' }
}

// Parse a timestamp field: epoch number or any date string Date understands.
export function parseTimestamp(input) {
  const s = String(input).trim()
  if (!s) return null
  const e = detectEpoch(s)
  if (e) return Number.isFinite(e.ms) && Math.abs(e.ms) <= 8.64e15 ? e : null
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? { ms, unit: 'date' } : null
}

export function formatLocal(ms, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone }).format(new Date(ms))
}
