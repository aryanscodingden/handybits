// Time zone math using Intl only (no tz database bundled). Handles half-hour
// and 45-minute offsets and daylight saving, because Intl knows the rules.
// Pure, so it can be tested in Node.

const partsFmt = new Map()

function partsFormatter(tz) {
  let f = partsFmt.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    })
    partsFmt.set(tz, f)
  }
  return f
}

// Wall-clock fields of an instant in a zone.
export function wallParts(ms, tz) {
  const out = {}
  for (const p of partsFormatter(tz).formatToParts(ms)) out[p.type] = p.value
  return {
    year: +out.year,
    month: +out.month,
    day: +out.day,
    hour: +out.hour % 24,
    minute: +out.minute,
    second: +out.second,
    weekday: out.weekday,
  }
}

// Offset from UTC in minutes at that instant (e.g. +330 for India).
export function offsetMinutes(tz, ms) {
  const w = wallParts(ms, tz)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}

// The instant at which a zone's clocks show the given wall time. In a DST gap
// (e.g. 2:30 on spring-forward day) this lands an hour later, like most
// calendars do; in an overlap it picks the first occurrence.
export function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const shows = (ms) => {
    const w = wallParts(ms, tz)
    return w.day === day && w.hour === hour && w.minute === minute
  }
  const g1 = wall - offsetMinutes(tz, wall) * 60000
  const g2 = wall - offsetMinutes(tz, g1) * 60000
  const hit = shows(g2) ? g2 : shows(g1) ? g1 : null
  // Gap: the wall time never happens; the larger candidate is "an hour later".
  if (hit === null) return Math.max(g1, g2)
  // Overlap: prefer the earlier instant if it shows the same wall time.
  for (const back of [3600000, 1800000]) if (shows(hit - back)) return hit - back
  return hit
}

export function formatOffset(mins) {
  const sign = mins < 0 ? '−' : '+'
  const a = Math.abs(mins)
  const h = Math.floor(a / 60)
  const m = a % 60
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
}

export function abbreviation(tz, ms, locale) {
  try {
    const p = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(ms)
      .find((x) => x.type === 'timeZoneName')
    return p ? p.value : ''
  } catch {
    return ''
  }
}

// "America/Argentina/Buenos_Aires" -> "Buenos Aires"
export function cityName(tz) {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC'
  return tz.split('/').pop().replace(/_/g, ' ')
}

export function regionName(tz) {
  if (tz === 'UTC') return 'Coordinated Universal Time'
  const parts = tz.split('/')
  return parts.slice(0, -1).join(' / ').replace(/_/g, ' ')
}

// Cities people search for that aren't the zone's own name.
export const ALIASES = {
  'Asia/Kolkata': 'India Delhi New Delhi Mumbai Bangalore Bengaluru Chennai Hyderabad Pune IST',
  'America/New_York': 'Boston Washington DC Miami Atlanta Philadelphia Toronto Eastern EST EDT',
  'America/Los_Angeles': 'San Francisco Seattle San Diego Portland Las Vegas Silicon Valley Pacific PST PDT',
  'America/Chicago': 'Dallas Houston Austin Minneapolis New Orleans Central CST CDT',
  'America/Denver': 'Salt Lake City Albuquerque Mountain MST MDT Boulder',
  'America/Phoenix': 'Arizona',
  'America/Toronto': 'Ottawa Montreal',
  'America/Vancouver': 'British Columbia',
  'America/Sao_Paulo': 'Brazil Rio de Janeiro',
  'America/Mexico_City': 'Mexico',
  'Europe/London': 'United Kingdom UK England Britain Manchester Edinburgh GMT BST',
  'Europe/Dublin': 'Ireland',
  'Europe/Paris': 'France',
  'Europe/Berlin': 'Germany Munich Frankfurt Hamburg CET CEST',
  'Europe/Madrid': 'Spain Barcelona',
  'Europe/Rome': 'Italy Milan',
  'Europe/Amsterdam': 'Netherlands Holland',
  'Europe/Zurich': 'Switzerland Geneva',
  'Europe/Stockholm': 'Sweden',
  'Europe/Kyiv': 'Ukraine Kiev',
  'Europe/Kiev': 'Ukraine Kyiv',
  'Europe/Istanbul': 'Turkey Ankara',
  'Europe/Moscow': 'Russia Saint Petersburg',
  'Asia/Shanghai': 'China Beijing Shenzhen Guangzhou',
  'Asia/Hong_Kong': 'HK',
  'Asia/Tokyo': 'Japan Osaka Kyoto JST',
  'Asia/Seoul': 'Korea',
  'Asia/Singapore': 'SG',
  'Asia/Dubai': 'UAE Abu Dhabi Emirates',
  'Asia/Karachi': 'Pakistan Lahore Islamabad',
  'Asia/Dhaka': 'Bangladesh',
  'Asia/Kathmandu': 'Nepal',
  'Asia/Jakarta': 'Indonesia',
  'Asia/Manila': 'Philippines',
  'Asia/Bangkok': 'Thailand',
  'Asia/Ho_Chi_Minh': 'Vietnam Saigon Hanoi',
  'Asia/Jerusalem': 'Israel Tel Aviv',
  'Asia/Riyadh': 'Saudi Arabia',
  'Asia/Tehran': 'Iran',
  'Australia/Sydney': 'Australia Canberra AEST AEDT',
  'Australia/Melbourne': 'Victoria',
  'Australia/Adelaide': 'South Australia',
  'Pacific/Auckland': 'New Zealand Wellington',
  'Pacific/Honolulu': 'Hawaii',
  'Africa/Lagos': 'Nigeria',
  'Africa/Johannesburg': 'South Africa Cape Town',
  'Africa/Cairo': 'Egypt',
  'Africa/Nairobi': 'Kenya',
  UTC: 'GMT Universal Zulu Coordinated',
}

// ICU still reports some zones by their old names. Show the current ones,
// as long as this browser accepts them.
const RENAMED = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
}

export function isValidZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function modernName(tz) {
  const next = RENAMED[tz]
  return next && isValidZone(next) ? next : tz
}

let zoneCache = null

export function allZones() {
  if (zoneCache) return zoneCache
  let list = []
  try {
    list = Intl.supportedValuesOf('timeZone')
  } catch {
    list = Object.keys(ALIASES).filter((z) => z !== 'UTC')
  }
  list = [...new Set(list.map(modernName))]
  zoneCache = list.includes('UTC') ? list : ['UTC', ...list]
  return zoneCache
}

export function searchZones(query, zones, exclude = []) {
  const q = query.trim().toLowerCase().replace(/[_/]/g, ' ')
  if (!q) return []
  const scored = []
  for (const tz of zones) {
    if (exclude.includes(tz)) continue
    const city = cityName(tz).toLowerCase()
    const hay = `${tz.replace(/[_/]/g, ' ')} ${ALIASES[tz] || ''}`.toLowerCase()
    let score = -1
    if (city === q) score = 0
    else if (city.startsWith(q)) score = 1
    else if (hay.split(/\s+/).some((w) => w.startsWith(q))) score = 2
    else if (hay.includes(q)) score = 3
    if (score >= 0) scored.push([score, tz])
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map((x) => x[1])
}

export function localZone() {
  try {
    return modernName(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  } catch {
    return 'UTC'
  }
}

// Local zone, UTC, and one big business hub that isn't the local one.
export function defaultZones(local = localZone()) {
  const hub = local.startsWith('America/') ? 'Europe/London' : 'America/New_York'
  return [...new Set([local, 'UTC', hub])]
}

// 24 hourly instants starting at midnight of the reference zone's date.
export function dayColumns(refTz, ms) {
  const w = wallParts(ms, refTz)
  const start = zonedToUtc({ year: w.year, month: w.month, day: w.day, hour: 0, minute: 0 }, refTz)
  return Array.from({ length: 24 }, (_, i) => start + i * 3600000)
}

// "work" 9–17, "edge" 7–9 and 17–22, otherwise "night". Uses fractional hours
// so a 9:30 column (India vs a whole-hour reference) counts as working.
export function hourKind(hour, minute = 0) {
  const h = hour + minute / 60
  if (h >= 9 && h < 17) return 'work'
  if ((h >= 7 && h < 9) || (h >= 17 && h < 22)) return 'edge'
  return 'night'
}

export function sameDay(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

// Difference in calendar days between two wall dates (-1, 0, +1 typically).
export function dayDiff(a, b) {
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86400000)
}
