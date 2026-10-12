// Unit tables and number formatting for the unit converter.
// Every linear unit is stored as its size in the category's SI base unit,
// so a conversion is value * from.factor / to.factor. Temperature is affine
// and uses explicit functions instead.

const u = (id, label, short, factor) => ({ id, label, short, factor })

// Exact definitions wherever a legal one exists (inch = 25.4 mm, pound = 0.45359237 kg,
// US gallon = 231 in³, imperial gallon = 4.54609 l).
const IN3 = 0.0254 ** 3
const US_GAL = 231 * IN3
const US_CUP = US_GAL / 16
const US_FLOZ = US_GAL / 128
const US_TBSP = US_FLOZ / 2
const US_TSP = US_TBSP / 3

export const CATEGORIES = {
  length: {
    label: 'Length',
    base: 'm',
    defaults: ['km', 'mi'],
    units: [
      u('mm', 'Millimetres', 'mm', 0.001),
      u('cm', 'Centimetres', 'cm', 0.01),
      u('m', 'Metres', 'm', 1),
      u('km', 'Kilometres', 'km', 1000),
      u('in', 'Inches', 'in', 0.0254),
      u('ft', 'Feet', 'ft', 0.3048),
      u('yd', 'Yards', 'yd', 0.9144),
      u('mi', 'Miles', 'mi', 1609.344),
      u('nmi', 'Nautical miles', 'nmi', 1852),
      u('um', 'Micrometres', 'µm', 1e-6),
    ],
  },
  weight: {
    label: 'Weight',
    base: 'kg',
    defaults: ['kg', 'lb'],
    units: [
      u('mg', 'Milligrams', 'mg', 1e-6),
      u('g', 'Grams', 'g', 0.001),
      u('kg', 'Kilograms', 'kg', 1),
      u('t', 'Tonnes', 't', 1000),
      u('oz', 'Ounces', 'oz', 0.028349523125),
      u('lb', 'Pounds', 'lb', 0.45359237),
      u('st', 'Stone', 'st', 6.35029318),
      u('ston', 'Short tons (US)', 'US ton', 907.18474),
      u('lton', 'Long tons (UK)', 'UK ton', 1016.0469088),
    ],
  },
  temperature: {
    label: 'Temperature',
    base: 'K',
    defaults: ['c', 'f'],
    units: [
      { id: 'c', label: 'Celsius', short: '°C', toBase: (v) => v + 273.15, fromBase: (k) => k - 273.15 },
      { id: 'f', label: 'Fahrenheit', short: '°F', toBase: (v) => ((v - 32) * 5) / 9 + 273.15, fromBase: (k) => ((k - 273.15) * 9) / 5 + 32 },
      { id: 'k', label: 'Kelvin', short: 'K', toBase: (v) => v, fromBase: (k) => k },
    ],
  },
  volume: {
    label: 'Volume',
    base: 'm³',
    defaults: ['l', 'galus'],
    units: [
      u('ml', 'Millilitres', 'ml', 1e-6),
      u('l', 'Litres', 'l', 0.001),
      u('m3', 'Cubic metres', 'm³', 1),
      u('cm3', 'Cubic centimetres', 'cm³', 1e-6),
      u('in3', 'Cubic inches', 'in³', IN3),
      u('ft3', 'Cubic feet', 'ft³', 0.3048 ** 3),
      u('flozus', 'Fluid ounces (US)', 'fl oz', US_FLOZ),
      u('cupus', 'Cups (US)', 'cup', US_CUP),
      u('ptus', 'Pints (US)', 'pt', US_GAL / 8),
      u('qtus', 'Quarts (US)', 'qt', US_GAL / 4),
      u('galus', 'Gallons (US)', 'gal', US_GAL),
      u('ptuk', 'Pints (UK)', 'UK pt', 0.00454609 / 8),
      u('galuk', 'Gallons (UK)', 'UK gal', 0.00454609),
    ],
  },
  area: {
    label: 'Area',
    base: 'm²',
    defaults: ['m2', 'ft2'],
    units: [
      u('mm2', 'Square millimetres', 'mm²', 1e-6),
      u('cm2', 'Square centimetres', 'cm²', 1e-4),
      u('m2', 'Square metres', 'm²', 1),
      u('ha', 'Hectares', 'ha', 1e4),
      u('km2', 'Square kilometres', 'km²', 1e6),
      u('in2', 'Square inches', 'in²', 0.0254 ** 2),
      u('ft2', 'Square feet', 'ft²', 0.3048 ** 2),
      u('yd2', 'Square yards', 'yd²', 0.9144 ** 2),
      u('ac', 'Acres', 'ac', 4046.8564224),
      u('mi2', 'Square miles', 'mi²', 1609.344 ** 2),
    ],
  },
  speed: {
    label: 'Speed',
    base: 'm/s',
    defaults: ['kmh', 'mph'],
    units: [
      u('ms', 'Metres per second', 'm/s', 1),
      u('kmh', 'Kilometres per hour', 'km/h', 1 / 3.6),
      u('mph', 'Miles per hour', 'mph', 0.44704),
      u('kn', 'Knots', 'kn', 1852 / 3600),
      u('fts', 'Feet per second', 'ft/s', 0.3048),
    ],
  },
  time: {
    label: 'Time',
    base: 's',
    defaults: ['h', 'min'],
    units: [
      u('msec', 'Milliseconds', 'ms', 0.001),
      u('s', 'Seconds', 's', 1),
      u('min', 'Minutes', 'min', 60),
      u('h', 'Hours', 'h', 3600),
      u('d', 'Days', 'd', 86400),
      u('wk', 'Weeks', 'wk', 604800),
      // Gregorian averages: 365.2425 days a year, a twelfth of that a month.
      u('mo', 'Months (average)', 'mo', 2629746),
      u('yr', 'Years (average)', 'yr', 31556952),
    ],
  },
  data: {
    label: 'Data',
    base: 'B',
    defaults: ['gb', 'gib'],
    units: [
      u('bit', 'Bits', 'bit', 1 / 8),
      u('B', 'Bytes', 'B', 1),
      u('kb', 'Kilobytes', 'kB', 1e3),
      u('mb', 'Megabytes', 'MB', 1e6),
      u('gb', 'Gigabytes', 'GB', 1e9),
      u('tb', 'Terabytes', 'TB', 1e12),
      u('pb', 'Petabytes', 'PB', 1e15),
      u('kib', 'Kibibytes', 'KiB', 2 ** 10),
      u('mib', 'Mebibytes', 'MiB', 2 ** 20),
      u('gib', 'Gibibytes', 'GiB', 2 ** 30),
      u('tib', 'Tebibytes', 'TiB', 2 ** 40),
      u('mbit', 'Megabits', 'Mbit', 1e6 / 8),
      u('gbit', 'Gigabits', 'Gbit', 1e9 / 8),
    ],
  },
  cooking: {
    label: 'Cooking',
    base: 'ml',
    defaults: ['cup', 'ml'],
    units: [
      u('tsp', 'Teaspoons (US)', 'tsp', US_TSP * 1e6),
      u('tbsp', 'Tablespoons (US)', 'tbsp', US_TBSP * 1e6),
      u('floz', 'Fluid ounces (US)', 'fl oz', US_FLOZ * 1e6),
      u('cup', 'Cups (US)', 'cup', US_CUP * 1e6),
      u('ml', 'Millilitres', 'ml', 1),
      u('l', 'Litres', 'l', 1000),
    ],
  },
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES)

export function findUnit(cat, id) {
  return CATEGORIES[cat]?.units.find((x) => x.id === id)
}

export function toBase(value, unit) {
  return unit.toBase ? unit.toBase(value) : value * unit.factor
}

export function fromBase(value, unit) {
  return unit.fromBase ? unit.fromBase(value) : value / unit.factor
}

export function convert(value, cat, fromId, toId) {
  const from = findUnit(cat, fromId)
  const to = findUnit(cat, toId)
  if (!from || !to || !Number.isFinite(value)) return NaN
  if (fromId === toId) return value
  return fromBase(toBase(value, from), to)
}

// Millilitres in the cooking table weigh a gram each for water.
export const waterGrams = (ml) => ml

// Accepts "1,234.5", " 12 ", "1e3", "-4", ".5" and a unicode minus. Empty or junk gives NaN.
export function parseNumber(text) {
  const s = String(text).trim().replace(/[\s,_]/g, '').replace(/^−/, '-')
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN
  return Number(s)
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }
const grouped = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 })
const groupedInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// Clean up float noise (0.1 + 0.2) before deciding how to show a number.
const clean = (x) => Number(x.toPrecision(12))

const tooSmall = (a) => a !== 0 && a < 1e-6
const tooBig = (a) => a >= 1e15

// For display: up to 6 significant digits, thousands separators, scientific
// notation with superscript exponents for very large or very small values.
export function formatNumber(x) {
  if (!Number.isFinite(x)) return '–'
  const v = clean(x)
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (tooSmall(a) || tooBig(a)) {
    const [m, e] = v.toExponential(5).split('e')
    const mant = m.replace(/\.?0+$/, '')
    const exp = String(Number(e)).replace(/./g, (c) => SUP[c])
    return `${mant} × 10${exp}`
  }
  // Large values keep their whole part rather than being rounded to 6 digits.
  if (a >= 1e6) return groupedInt.format(v)
  return grouped.format(v)
}

// For an editable field: same precision rules but no separators, and a
// plain e-notation that parseNumber reads back.
export function formatPlain(x) {
  if (!Number.isFinite(x)) return ''
  const v = clean(x)
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (tooSmall(a) || tooBig(a)) {
    const [m, e] = v.toExponential(5).split('e')
    return `${m.replace(/\.?0+$/, '')}e${Number(e)}`
  }
  if (a >= 1e6) return String(Math.round(v))
  return String(Number(v.toPrecision(6)))
}
