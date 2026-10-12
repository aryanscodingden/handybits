// Password and passphrase generation using the platform CSPRNG.
// Pure apart from crypto.getRandomValues, so it can be tested in Node.

const MAX = 2 ** 32

// Uniform integer in [0, n). Rejection sampling: values in the incomplete
// final bucket are discarded so every result is equally likely (no modulo bias).
export function randomInt(n, getRandom = (a) => crypto.getRandomValues(a)) {
  if (!Number.isInteger(n) || n <= 0 || n > MAX) throw new RangeError('n out of range')
  const limit = MAX - (MAX % n)
  const buf = new Uint32Array(1)
  for (;;) {
    getRandom(buf)
    if (buf[0] < limit) return buf[0] % n
  }
}

export const CLASSES = {
  lower: { label: 'a–z', chars: 'abcdefghijklmnopqrstuvwxyz' },
  upper: { label: 'A–Z', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  digits: { label: '0–9', chars: '0123456789' },
  symbols: { label: 'Symbols', chars: '!@#$%^&*()-_=+[]{};:,.<>/?~' },
}

const LOOK_ALIKES = /[Il1O0o|`'"]/g

export function charsets(opts) {
  return Object.keys(CLASSES)
    .filter((k) => opts[k])
    .map((k) => (opts.avoidSimilar ? CLASSES[k].chars.replace(LOOK_ALIKES, '') : CLASSES[k].chars))
}

// One character from each chosen class, the rest from the full pool, then a
// Fisher–Yates shuffle so the guaranteed characters don't sit at the front.
export function generatePassword(opts, rand = randomInt) {
  const sets = charsets(opts)
  if (!sets.length) return ''
  const pool = sets.join('')
  const length = Math.max(opts.length, sets.length)
  const out = sets.map((s) => s[rand(s.length)])
  while (out.length < length) out.push(pool[rand(pool.length)])
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

// Entropy of a password drawn uniformly from the pool. Requiring one of each
// class removes a small number of possibilities; we subtract that exactly via
// inclusion–exclusion so the meter never overstates strength.
export function passwordEntropy(opts) {
  const sets = charsets(opts)
  if (!sets.length) return 0
  const sizes = sets.map((s) => s.length)
  const length = Math.max(opts.length, sets.length)
  const k = sizes.length
  // count = sum over subsets S of (-1)^|S| * (pool - |S chars|)^length
  const terms = []
  for (let mask = 0; mask < 1 << k; mask++) {
    let removed = 0
    let bits = 0
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) {
        removed += sizes[i]
        bits++
      }
    }
    const base = sizes.reduce((a, b) => a + b, 0) - removed
    if (base <= 0) continue
    terms.push({ sign: bits % 2 ? -1 : 1, log: length * Math.log2(base) })
  }
  // Sum in log space relative to the largest term to stay finite at length 64.
  const top = Math.max(...terms.map((t) => t.log))
  const ratio = terms.reduce((acc, t) => acc + t.sign * 2 ** (t.log - top), 0)
  return top + Math.log2(ratio)
}

export function generatePassphrase({ words: count, separator, capitalise, number }, list, rand = randomInt) {
  const picked = Array.from({ length: count }, () => list[rand(list.length)])
  const ws = capitalise ? picked.map((w) => w[0].toUpperCase() + w.slice(1)) : picked
  if (number) {
    const at = rand(ws.length)
    ws[at] = ws[at] + rand(10)
  }
  return ws.join(separator)
}

export function passphraseEntropy({ words: count, number }, listSize) {
  let bits = count * Math.log2(listSize)
  if (number) bits += Math.log2(10) + Math.log2(count)
  return bits
}

export function strength(bits) {
  if (bits < 50) return { level: 0, label: 'Weak' }
  if (bits < 70) return { level: 1, label: 'Fair' }
  if (bits < 100) return { level: 2, label: 'Strong' }
  return { level: 3, label: 'Excellent' }
}

const GUESSES_PER_SEC = 1e10
const UNITS = [
  ['second', 1],
  ['minute', 60],
  ['hour', 3600],
  ['day', 86400],
  ['month', 2629800],
  ['year', 31557600],
]

// Average time to find it (half the space) at ten billion guesses a second.
export function crackTime(bits) {
  const log10Secs = (bits - 1) * Math.log10(2) - Math.log10(GUESSES_PER_SEC)
  if (log10Secs < 0) return 'Instantly'
  const secs = 10 ** log10Secs
  if (secs >= 31557600 * 1000) {
    const years = log10Secs - Math.log10(31557600)
    if (years < 6) return 'Thousands of years'
    if (years < 9) return 'Millions of years'
    if (years < 12) return 'Billions of years'
    return 'Longer than the universe has existed'
  }
  if (secs >= 31557600 * 100) return 'Centuries'
  for (let i = UNITS.length - 1; i >= 0; i--) {
    const [name, size] = UNITS[i]
    if (secs >= size) {
      const n = Math.round(secs / size)
      return `About ${n} ${name}${n === 1 ? '' : 's'}`
    }
  }
  return 'Instantly'
}
