// Pure colour math: sRGB, linear light, HSL, OKLab/OKLCH, hex, WCAG contrast.
// Colours are passed around as { r, g, b, a } with r/g/b in 0–255 (floats ok)
// and a in 0–1.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

// ---------- Hex ----------

// Accepts #rgb, #rgba, #rrggbb, #rrggbbaa (with or without #). Returns null if invalid.
export function parseHex(input) {
  if (typeof input !== 'string') return null
  let s = input.trim().replace(/^#/, '')
  if (!/^[0-9a-f]+$/i.test(s)) return null
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('')
  if (s.length !== 6 && s.length !== 8) return null
  const n = (i) => parseInt(s.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 }
}

const h2 = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')

export function toHex({ r, g, b, a = 1 }, withAlpha = a < 1) {
  return `#${h2(r)}${h2(g)}${h2(b)}${withAlpha ? h2(a * 255) : ''}`
}

// ---------- sRGB transfer ----------

export function srgbToLinear(c) {
  // c in 0–1
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

// ---------- HSL ----------

export function rgbToHsl({ r, g, b, a = 1 }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 1e-9) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: s * 100, l: l * 100, a }
}

export function hslToRgb({ h, s, l, a = 1 }) {
  h = (((h % 360) + 360) % 360) / 60
  s = clamp(s / 100)
  l = clamp(l / 100)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a }
}

// ---------- OKLab / OKLCH ----------

export function rgbToOklab({ r, g, b, a = 1 }) {
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: a,
  }
}

// Returns linear-light RGB (may be out of 0–1 for out-of-gamut colours).
export function oklabToLinear({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function oklabToRgb(lab) {
  const lin = oklabToLinear(lab)
  const [r, g, b] = lin.map((c) => clamp(linearToSrgb(clamp(c))) * 255)
  return { r, g, b, a: lab.alpha ?? 1 }
}

export function oklabToOklch({ L, a, b, alpha = 1 }) {
  const C = Math.hypot(a, b)
  let H = (Math.atan2(b, a) * 180) / Math.PI
  if (H < 0) H += 360
  return { L, C, H: C < 1e-4 ? 0 : H, alpha }
}

export function oklchToOklab({ L, C, H, alpha = 1 }) {
  const rad = (H * Math.PI) / 180
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad), alpha }
}

export const rgbToOklch = (rgb) => oklabToOklch(rgbToOklab(rgb))

function inGamut(lin, eps = 1e-5) {
  return lin.every((c) => c >= -eps && c <= 1 + eps)
}

// Map an OKLCH colour into sRGB by reducing chroma (keeps lightness and hue),
// which is the perceptually least surprising way to clamp.
export function oklchToRgb(lch) {
  const L = clamp(lch.L)
  if (L <= 0) return { r: 0, g: 0, b: 0, a: lch.alpha ?? 1 }
  if (L >= 1) return { r: 255, g: 255, b: 255, a: lch.alpha ?? 1 }
  let C = Math.max(0, lch.C)
  const lab = (c) => oklchToOklab({ L, C: c, H: lch.H, alpha: lch.alpha })
  if (!inGamut(oklabToLinear(lab(C)))) {
    let lo = 0
    let hi = C
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklabToLinear(lab(mid)))) lo = mid
      else hi = mid
    }
    C = lo
  }
  return oklabToRgb(lab(C))
}

export function isInSrgbGamut(lch) {
  return inGamut(oklabToLinear(oklchToOklab(lch)), 1e-4)
}

// ---------- WCAG ----------

export function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255)
}

export function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// Flatten a translucent colour over an opaque background.
export function over(fg, bg) {
  const a = fg.a ?? 1
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
}

export function wcagLevels(ratio) {
  return {
    normalAA: ratio >= 4.5,
    normalAAA: ratio >= 7,
    largeAA: ratio >= 3,
    largeAAA: ratio >= 4.5,
    ui: ratio >= 3,
  }
}

// Nudge the text colour's OKLCH lightness (towards whichever end can reach the
// target) until it meets `target` against bg. Returns rgb or null.
export function suggestPassing(fg, bg, target = 4.5) {
  if (contrast(fg, bg) >= target) return { ...fg }
  const lch = rgbToOklch(fg)
  const tryDir = (dir) => {
    const end = dir > 0 ? 1 : 0
    const endRgb = oklchToRgb({ ...lch, L: end })
    if (contrast(endRgb, bg) < target) return null
    // Binary search the smallest change in L that passes.
    let lo = lch.L
    let hi = end
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (contrast(oklchToRgb({ ...lch, L: mid }), bg) >= target) hi = mid
      else lo = mid
    }
    // Round to an integer hex colour that still passes.
    let rgb = oklchToRgb({ ...lch, L: hi })
    let L = hi
    for (let i = 0; i < 50 && contrast(roundRgb(rgb), bg) < target; i++) {
      L += dir * 0.002
      rgb = oklchToRgb({ ...lch, L })
    }
    return { rgb: roundRgb(rgb), delta: Math.abs(L - lch.L) }
  }
  const options = [tryDir(-1), tryDir(1)].filter(Boolean)
  if (!options.length) return null
  options.sort((a, b) => a.delta - b.delta)
  return options[0].rgb
}

export const roundRgb = ({ r, g, b, a = 1 }) => ({ r: Math.round(r), g: Math.round(g), b: Math.round(b), a })

// ---------- Formatting & parsing ----------

const r1 = (v, d = 1) => {
  const p = 10 ** d
  return Math.round(v * p) / p
}

export function formatRgb(c) {
  const { r, g, b, a = 1 } = roundRgb(c)
  return a < 1 ? `rgb(${r} ${g} ${b} / ${r1(a, 2)})` : `rgb(${r} ${g} ${b})`
}

export function formatHsl(c) {
  const { h, s, l, a } = rgbToHsl(c)
  return a < 1 ? `hsl(${r1(h)} ${r1(s)}% ${r1(l)}% / ${r1(a, 2)})` : `hsl(${r1(h)} ${r1(s)}% ${r1(l)}%)`
}

export function formatOklch(c) {
  const { L, C, H, alpha } = rgbToOklch(c)
  const base = `oklch(${r1(L * 100, 1)}% ${r1(C, 3)} ${r1(H, 1)}`
  return alpha < 1 ? `${base} / ${r1(alpha, 2)})` : `${base})`
}

function num(s, pctScale) {
  s = s.trim()
  if (s.endsWith('%')) return (parseFloat(s) / 100) * pctScale
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : NaN
}

function splitArgs(inner) {
  // Supports "a b c / d", "a, b, c", "a, b, c, d"
  const [main, alphaPart] = inner.split('/')
  const parts = main.split(/[\s,]+/).filter(Boolean)
  if (alphaPart !== undefined) parts.push(alphaPart.trim())
  return parts
}

// Parse any of: hex, rgb()/rgba(), hsl()/hsla(), oklch(). Returns rgb or null.
export function parseColor(input) {
  if (typeof input !== 'string') return null
  const s = input.trim().toLowerCase()
  if (!s) return null
  const hex = parseHex(s)
  if (hex) return hex
  const m = s.match(/^(rgba?|hsla?|oklch)\(\s*(.*?)\s*\)$/)
  if (!m) return null
  const parts = splitArgs(m[2])
  if (parts.length < 3 || parts.length > 4) return null
  const alpha = parts[3] !== undefined ? clamp(num(parts[3], 1)) : 1
  if (Number.isNaN(alpha)) return null
  let out
  if (m[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255))
    out = { r, g, b, a: alpha }
  } else if (m[1].startsWith('hsl')) {
    const h = parseFloat(parts[0])
    const sat = parseFloat(parts[1])
    const l = parseFloat(parts[2])
    out = hslToRgb({ h, s: sat, l, a: alpha })
  } else {
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0])
    const C = num(parts[1], 0.4)
    const H = parseFloat(parts[2])
    if ([L, C, H].some((v) => !Number.isFinite(v))) return null
    out = oklchToRgb({ L, C, H, alpha })
  }
  if ([out.r, out.g, out.b].some((v) => !Number.isFinite(v))) return null
  return { r: clamp(out.r, 0, 255), g: clamp(out.g, 0, 255), b: clamp(out.b, 0, 255), a: out.a }
}

// ---------- Scales & harmonies ----------

// 11 steps from near-white to near-black at the colour's hue, in OKLCH. The
// chroma follows the base colour, eased down towards the extremes.
export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
export function tintsAndShades(rgb) {
  const { C, H } = rgbToOklch(rgb)
  const Ls = [0.975, 0.94, 0.88, 0.8, 0.71, 0.62, 0.53, 0.45, 0.37, 0.29, 0.22]
  return Ls.map((L, i) => {
    const t = Math.abs(L - 0.6) / 0.4
    const c = C * (1 - 0.7 * t * t)
    return { step: SCALE_STEPS[i], rgb: roundRgb(oklchToRgb({ L, C: c, H })) }
  })
}

export function rotateHue(rgb, deg) {
  const lch = rgbToOklch(rgb)
  return roundRgb(oklchToRgb({ ...lch, H: (lch.H + deg + 360) % 360 }))
}

export function harmonies(rgb) {
  return [
    { name: 'Complementary', colors: [rgb, rotateHue(rgb, 180)] },
    { name: 'Analogous', colors: [rotateHue(rgb, -30), rgb, rotateHue(rgb, 30)] },
    { name: 'Triadic', colors: [rgb, rotateHue(rgb, 120), rotateHue(rgb, 240)] },
  ]
}

// Pick a readable text colour (near-black or white) for a swatch.
export function textOn(rgb) {
  return contrast(rgb, { r: 255, g: 255, b: 255 }) >= contrast(rgb, { r: 27, g: 26, b: 23 }) ? '#ffffff' : '#1b1a17'
}
