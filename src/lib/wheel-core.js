// Randomness and geometry for the wheel and random pickers.
// All picks use rejection sampling on crypto.getRandomValues (via randomInt),
// so every outcome is exactly equally likely.
import { randomInt } from './password-gen.js'

export { randomInt }

const TAU = Math.PI * 2

export const mod = (a, n) => ((a % n) + n) % n

// Entries from a textarea: one per line, trimmed, blanks dropped, duplicates kept.
export function parseEntries(text, max = 200) {
  return String(text)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
}

/* Wheel geometry
   The wheel turns clockwise by `rotation` radians. Segment i covers the
   wheel-frame angles [i·s, (i+1)·s) measured clockwise from 12 o'clock, where
   s = 2π/n. The pointer sits at 12 o'clock, so the wheel-frame angle under it
   is −rotation (mod 2π). */

export function indexAtRotation(rotation, n) {
  const s = TAU / n
  return Math.min(n - 1, Math.floor(mod(-rotation, TAU) / s))
}

// Final rotation that puts `index` under the pointer, at `frac` (0–1) of the
// way through the segment, after at least `turns` whole extra turns.
export function targetRotation(current, index, n, turns, frac) {
  const s = TAU / n
  const want = mod(-(index + frac) * s, TAU)
  const delta = mod(want - mod(current, TAU), TAU)
  return current + turns * TAU + delta
}

export const easeOutCubic = (t) => 1 - (1 - t) ** 3

// Picks the winner first, then plans an animation that lands inside it.
export function planSpin(current, n, { reduced = false, rand = randomInt } = {}) {
  const index = rand(n)
  // Land somewhere in the middle 70% of the segment, never on a border.
  const frac = 0.15 + (rand(1000) / 1000) * 0.7
  const turns = reduced ? 1 : 4 + rand(3)
  const duration = reduced ? 900 : 4200 + rand(1600)
  return { index, from: current, to: targetRotation(current, index, n, turns, frac), duration }
}

/* Other pickers */

export function shuffle(list, rand = randomInt) {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const flipCoin = (rand = randomInt) => (rand(2) ? 'heads' : 'tails')

export function rollDice(count, sides, rand = randomInt) {
  return Array.from({ length: count }, () => 1 + rand(sides))
}

// count integers in [min, max] inclusive. With unique, no repeats (count must fit the range).
export function pickNumbers(min, max, count, unique, rand = randomInt) {
  const lo = Math.ceil(Math.min(min, max))
  const hi = Math.floor(Math.max(min, max))
  const size = hi - lo + 1
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || size < 1) throw new RangeError('Enter a whole-number range.')
  if (size > 2 ** 32) throw new RangeError('The range can span at most about 4.29 billion numbers.')
  if (unique && count > size) throw new RangeError(`Only ${size} different numbers fit in that range.`)
  if (!unique) return Array.from({ length: count }, () => lo + rand(size))
  // Sparse partial Fisher–Yates: uniform without building the whole range.
  const swapped = new Map()
  const out = []
  for (let i = 0; i < count; i++) {
    const j = i + rand(size - i)
    const vj = swapped.has(j) ? swapped.get(j) : j
    const vi = swapped.has(i) ? swapped.get(i) : i
    swapped.set(j, vi)
    out.push(lo + vj)
  }
  return out
}

// Shuffles names and deals them round-robin, so team sizes differ by at most one.
// mode 'teams': n teams; mode 'size': n people per team (last teams may have one fewer).
export function splitTeams(names, mode, n, rand = randomInt) {
  const k = Math.max(1, mode === 'size' ? Math.ceil(names.length / Math.max(1, n)) : Math.min(n, names.length || 1))
  const teams = Array.from({ length: k }, () => [])
  shuffle(names, rand).forEach((name, i) => teams[i % k].push(name))
  return teams
}
