// Dominant colours from pixel data: k-means in OKLab with k-means++ seeding.
// Pure: takes RGBA bytes, returns [{ rgb, share }] sorted by share.
import { oklabToRgb, roundRgb, srgbToLinear } from './color.js'

// Small deterministic PRNG so the same image always gives the same palette.
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fast sRGB byte -> OKLab using a lookup for the transfer curve.
const LIN = new Float64Array(256)
for (let i = 0; i < 256; i++) LIN[i] = srgbToLinear(i / 255)

function toLab(r, g, b) {
  const lr = LIN[r]
  const lg = LIN[g]
  const lb = LIN[b]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

export function extractPalette(data, k = 6, { iterations = 16, seed = 1, minDistance = 0.04 } = {}) {
  const rng = mulberry32(seed)
  // Collect opaque pixels as OKLab.
  const n = data.length / 4
  const L = new Float64Array(n)
  const A = new Float64Array(n)
  const B = new Float64Array(n)
  let count = 0
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue
    const lab = toLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    L[count] = lab[0]
    A[count] = lab[1]
    B[count] = lab[2]
    count++
  }
  if (!count) return []
  k = Math.max(1, Math.min(k, count))

  // k-means++ seeding.
  const first = Math.floor(rng() * count)
  const cL = [L[first]]
  const cA = [A[first]]
  const cB = [B[first]]
  const d2 = new Float64Array(count).fill(Infinity)
  while (cL.length < k) {
    const c = cL.length - 1
    let sum = 0
    for (let i = 0; i < count; i++) {
      const d = (L[i] - cL[c]) ** 2 + (A[i] - cA[c]) ** 2 + (B[i] - cB[c]) ** 2
      if (d < d2[i]) d2[i] = d
      sum += d2[i]
    }
    if (sum === 0) break // fewer distinct colours than k
    let r = rng() * sum
    let pick = count - 1
    for (let i = 0; i < count; i++) {
      r -= d2[i]
      if (r <= 0) {
        pick = i
        break
      }
    }
    cL.push(L[pick])
    cA.push(A[pick])
    cB.push(B[pick])
  }
  const K = cL.length

  // Lloyd iterations.
  const assign = new Int32Array(count)
  const sizes = new Float64Array(K)
  for (let it = 0; it < iterations; it++) {
    const sL = new Float64Array(K)
    const sA = new Float64Array(K)
    const sB = new Float64Array(K)
    sizes.fill(0)
    let moved = 0
    for (let i = 0; i < count; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < K; c++) {
        const d = (L[i] - cL[c]) ** 2 + (A[i] - cA[c]) ** 2 + (B[i] - cB[c]) ** 2
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assign[i] !== best) moved++
      assign[i] = best
      sizes[best]++
      sL[best] += L[i]
      sA[best] += A[i]
      sB[best] += B[i]
    }
    for (let c = 0; c < K; c++) {
      if (sizes[c]) {
        cL[c] = sL[c] / sizes[c]
        cA[c] = sA[c] / sizes[c]
        cB[c] = sB[c] / sizes[c]
      }
    }
    if (it > 0 && moved === 0) break
  }

  // Merge near-identical clusters so a flat image doesn't give duplicates.
  let clusters = []
  for (let c = 0; c < K; c++) if (sizes[c]) clusters.push({ L: cL[c], a: cA[c], b: cB[c], n: sizes[c] })
  for (let merged = true; merged; ) {
    merged = false
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const p = clusters[i]
        const q = clusters[j]
        if (Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) < minDistance) {
          const n = p.n + q.n
          clusters[i] = { L: (p.L * p.n + q.L * q.n) / n, a: (p.a * p.n + q.a * q.n) / n, b: (p.b * p.n + q.b * q.n) / n, n }
          clusters = clusters.filter((_, k2) => k2 !== j)
          merged = true
          break outer
        }
      }
    }
  }
  return clusters
    .map((c) => ({ rgb: roundRgb(oklabToRgb({ L: c.L, a: c.a, b: c.b })), share: c.n / count }))
    .sort((a, b) => b.share - a.share)
}

// Size to fit within max×max, keeping aspect ratio.
export function fitWithin(w, h, max = 200) {
  const s = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

