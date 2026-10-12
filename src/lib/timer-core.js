// Duration parsing and clock formatting for the timer tool. Pure, testable in Node.

const MAX_MS = 100 * 3600 * 1000 - 1000

const UNIT_MS = { h: 3600000, m: 60000, s: 1000 }
const UNIT_ALIASES = [
  [/^(h|hr|hrs|hour|hours)$/, 'h'],
  [/^(m|min|mins|minute|minutes)$/, 'm'],
  [/^(s|sec|secs|second|seconds)$/, 's'],
]

// Understands "90" (minutes), "1.5" (minutes), "1:30" (m:ss), "1:02:03" (h:mm:ss),
// "5m30s", "1h 20m", "45 sec", "2 hours". Returns milliseconds or null.
export function parseDuration(input) {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return null
  let ms = null
  if (/^\d+(\.\d+)?$/.test(s)) {
    ms = Number(s) * 60000
  } else if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    const parts = s.split(':').map(Number)
    if (parts.slice(1).some((p) => p >= 60)) return null
    const [h, m, sec] = parts.length === 3 ? parts : [0, ...parts]
    ms = ((h * 60 + m) * 60 + sec) * 1000
  } else {
    const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g
    const rest = s.replace(re, '').replace(/[\s,]|and/g, '')
    if (rest) return null
    ms = 0
    const seen = new Set()
    for (const [, num, word] of s.matchAll(re)) {
      const unit = UNIT_ALIASES.find(([r]) => r.test(word))?.[1]
      if (!unit || seen.has(unit)) return null
      seen.add(unit)
      ms += Number(num) * UNIT_MS[unit]
    }
  }
  ms = Math.round(ms / 1000) * 1000
  if (!(ms > 0) || ms > MAX_MS) return null
  return ms
}

const pad = (n) => String(n).padStart(2, '0')

// Countdown display: whole seconds rounded up, so 4:59.2 left shows 05:00
// and the display reaches 00:00 exactly when the timer ends.
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000 - 1e-6))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// Stopwatch display with centiseconds: "01:23.45" or "1:01:23.45".
export function formatStopwatch(ms) {
  const cs = Math.floor(Math.max(0, ms) / 10)
  const total = Math.floor(cs / 100)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const main = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  return { main, cs: pad(cs % 100), text: `${main}.${pad(cs % 100)}` }
}

// Plain words for screen readers and labels: "1 hour 20 minutes".
export function describeDuration(ms) {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts = []
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`)
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`)
  if (s || !parts.length) parts.push(`${s} second${s === 1 ? '' : 's'}`)
  return parts.join(' ')
}

// Laps are stored as cumulative totals; returns rows with split times and
// which split is fastest and slowest (only marked when there are 3 or more).
export function lapRows(totals) {
  const rows = totals.map((t, i) => ({ n: i + 1, total: t, lap: t - (i ? totals[i - 1] : 0) }))
  if (rows.length >= 3) {
    let fast = 0
    let slow = 0
    rows.forEach((r, i) => {
      if (r.lap < rows[fast].lap) fast = i
      if (r.lap > rows[slow].lap) slow = i
    })
    if (rows[fast].lap !== rows[slow].lap) {
      rows[fast].fastest = true
      rows[slow].slowest = true
    }
  }
  return rows
}

// Which pomodoro phase follows the one that just ended.
export function nextPhase(phase, completedFocus, every) {
  if (phase !== 'focus') return 'focus'
  return completedFocus > 0 && completedFocus % every === 0 ? 'long' : 'short'
}
