// Builders for the strings encoded into QR codes. Pure, so they can be tested
// in Node.

// WIFI: spec (ZXing): backslash, semicolon, comma, colon and double quote
// must be escaped with a backslash.
export function escapeWifi(value) {
  return String(value ?? '').replace(/([\\;,:"])/g, '\\$1')
}

export function buildWifi({ ssid = '', password = '', security = 'WPA', hidden = false }) {
  if (!ssid) return ''
  const type = security === 'none' ? 'nopass' : security
  let out = `WIFI:T:${type};S:${escapeWifi(ssid)};`
  if (security !== 'none' && password) out += `P:${escapeWifi(password)};`
  if (hidden) out += 'H:true;'
  return `${out};`
}

// vCard 3.0 text values escape backslash, comma, semicolon and newlines.
export function escapeVcard(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/([,;])/g, '\\$1')
}

export function buildVcard({ name = '', phone = '', email = '', company = '', website = '' }) {
  const fullName = name.trim()
  if (!fullName && !phone.trim() && !email.trim()) return ''
  const parts = fullName.split(/\s+/).filter(Boolean)
  const last = parts.length > 1 ? parts.pop() : ''
  const first = parts.join(' ')
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  lines.push(`N:${escapeVcard(last)};${escapeVcard(first)};;;`)
  lines.push(`FN:${escapeVcard(fullName || phone.trim() || email.trim())}`)
  if (company.trim()) lines.push(`ORG:${escapeVcard(company.trim())}`)
  if (phone.trim()) lines.push(`TEL;TYPE=CELL:${escapeVcard(phone.trim())}`)
  if (email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(email.trim())}`)
  if (website.trim()) lines.push(`URL:${escapeVcard(normalizeUrl(website.trim()))}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

export function buildMailto({ to = '', subject = '', body = '' }) {
  if (!to.trim()) return ''
  const params = []
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body) params.push(`body=${encodeURIComponent(body)}`)
  return `mailto:${to.trim()}${params.length ? `?${params.join('&')}` : ''}`
}

export function cleanPhone(phone) {
  return String(phone ?? '').replace(/[^\d+*#]/g, '')
}

export function buildPhone({ phone = '', mode = 'call', message = '' }) {
  const number = cleanPhone(phone)
  if (!number) return ''
  if (mode === 'sms') return message ? `SMSTO:${number}:${message}` : `SMSTO:${number}`
  return `tel:${number}`
}

// Add https:// when someone types "example.com".
export function normalizeUrl(value) {
  const v = String(value ?? '').trim()
  if (!v) return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(v)) return v
  return `https://${v}`
}

export function buildPayload(type, data) {
  switch (type) {
    case 'link':
      return normalizeUrl(data.url)
    case 'text':
      return data.text || ''
    case 'wifi':
      return buildWifi(data)
    case 'contact':
      return buildVcard(data)
    case 'email':
      return buildMailto(data)
    case 'phone':
      return buildPhone(data)
    default:
      return ''
  }
}

// WCAG relative luminance contrast between two #rrggbb colours.
function luminance(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function isDarker(a, b) {
  return luminance(a) < luminance(b)
}
