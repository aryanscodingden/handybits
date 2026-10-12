// Pure maths for the calculators. Dates are handled as whole days since the
// Unix epoch (UTC midnight), so daylight-saving changes can never shift a
// result by a day.

const DAY = 86400000

/* Percentages */

export const percentOf = (pct, of) => (pct / 100) * of
export const whatPercent = (part, whole) => (whole === 0 ? NaN : (part / whole) * 100)
export const percentChange = (from, to) => (from === 0 ? NaN : ((to - from) / Math.abs(from)) * 100)

/* Dates */

const pad = (n) => String(n).padStart(2, '0')

export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

// month is 1–12
export function daysInMonth(y, month) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

// "2024-02-29" -> day number, or NaN for anything that is not a real date.
export function parseDay(iso) {
  const m = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim())
  if (!m) return NaN
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return NaN
  return fromYMD(y, mo, d)
}

export function fromYMD(y, month, d) {
  const t = new Date(0)
  t.setUTCFullYear(y, month - 1, d)
  return Math.round(t.getTime() / DAY)
}

export function toYMD(day) {
  const t = new Date(day * DAY)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

export function toISO(day) {
  const { y, m, d } = toYMD(day)
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`
}

// Local calendar date of a timestamp, as a day number.
export function localDay(ms = Date.now()) {
  const t = new Date(ms)
  return fromYMD(t.getFullYear(), t.getMonth() + 1, t.getDate())
}

// 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday.
export const weekday = (day) => (((day + 4) % 7) + 7) % 7

// Adds calendar months, clamping the day: Jan 31 + 1 month = Feb 28 (or 29).
export function addMonths(day, n) {
  const { y, m, d } = toYMD(day)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12 + 1
  return fromYMD(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

export function addToDay(day, amount, unit) {
  if (unit === 'days') return day + amount
  if (unit === 'weeks') return day + amount * 7
  if (unit === 'months') return addMonths(day, amount)
  if (unit === 'years') return addMonths(day, amount * 12)
  throw new Error(`unknown unit ${unit}`)
}

// Whole years, months and days from a to b (a <= b). Months are counted the
// same way addMonths moves, so a + result always lands back on b.
export function diffYMD(a, b) {
  if (b < a) return diffYMD(b, a)
  const A = toYMD(a)
  const B = toYMD(b)
  let months = (B.y - A.y) * 12 + (B.m - A.m)
  if (addMonths(a, months) > b) months--
  const days = b - addMonths(a, months)
  return { years: Math.floor(months / 12), months: months % 12, days, totalMonths: months }
}

// Weekdays (Mon–Fri) in [a, b): the start date counts, the end date does not.
export function businessDays(a, b) {
  if (b < a) return -businessDays(b, a)
  const span = b - a
  const weeks = Math.floor(span / 7)
  let count = weeks * 5
  for (let d = a + weeks * 7; d < b; d++) {
    const w = weekday(d)
    if (w !== 0 && w !== 6) count++
  }
  return count
}

export function dateDiff(a, b) {
  const days = b - a
  const abs = Math.abs(days)
  const ymd = diffYMD(a, b)
  return {
    days,
    weeks: Math.floor(abs / 7),
    weekDays: abs % 7,
    years: ymd.years,
    months: ymd.months,
    monthDays: ymd.days,
    totalMonths: ymd.totalMonths,
    business: businessDays(Math.min(a, b), Math.max(a, b)),
  }
}

export function age(birth, today) {
  if (!(birth <= today)) return null
  const { years, months, days } = diffYMD(birth, today)
  // Next birthday: the anniversary on or after today (Feb 29 birthdays fall on Feb 28 in common years).
  let next = addMonths(birth, years * 12)
  let turning = years
  if (next < today) {
    next = addMonths(birth, (years + 1) * 12)
    turning = years + 1
  }
  if (next === today && years === 0 && months === 0 && days === 0) {
    next = addMonths(birth, 12)
    turning = 1
  }
  return {
    years,
    months,
    days,
    totalDays: today - birth,
    totalWeeks: Math.floor((today - birth) / 7),
    nextBirthday: next,
    daysToBirthday: next - today,
    turning,
  }
}

/* Money. Work in cents so sums never pick up float noise. */

const cents = (x) => Math.round(x * 100)

export function tipSplit({ bill, tipPct, people, roundUp }) {
  const n = Math.max(1, Math.floor(people) || 1)
  const billC = cents(bill)
  let tipC = Math.round((billC * tipPct) / 100)
  let totalC = billC + tipC
  let perC = Math.ceil(totalC / n)
  if (roundUp) {
    perC = Math.ceil(totalC / n / 100) * 100
    totalC = perC * n
    tipC = totalC - billC
  }
  return { tip: tipC / 100, total: totalC / 100, perPerson: perC / 100, people: n, effectivePct: billC ? (tipC / billC) * 100 : 0 }
}

export function discountTax({ price, discountPct, taxPct }) {
  const p = cents(price)
  const savingsC = Math.round((p * discountPct) / 100)
  const subtotalC = p - savingsC
  const taxC = Math.round((subtotalC * taxPct) / 100)
  return { savings: savingsC / 100, subtotal: subtotalC / 100, tax: taxC / 100, final: (subtotalC + taxC) / 100 }
}

/* GPA on a 4.0 scale */

export const GRADES = [
  ['A+', 4.0],
  ['A', 4.0],
  ['A-', 3.7],
  ['B+', 3.3],
  ['B', 3.0],
  ['B-', 2.7],
  ['C+', 2.3],
  ['C', 2.0],
  ['C-', 1.7],
  ['D+', 1.3],
  ['D', 1.0],
  ['D-', 0.7],
  ['F', 0],
]

const POINTS = Object.fromEntries(GRADES)

export function gpa(rows) {
  let credits = 0
  let points = 0
  for (const r of rows) {
    const c = Number(r.credits)
    if (!(r.grade in POINTS) || !(c > 0)) continue
    credits += c
    points += POINTS[r.grade] * c
  }
  return { gpa: credits ? points / credits : NaN, credits, points }
}
