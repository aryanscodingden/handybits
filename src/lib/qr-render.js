// Draw a QR matrix (from QRCode.create) to a canvas or an SVG string. Both
// share the same geometry so the PNG and SVG downloads look identical.

export const LOGO_RATIO = 0.22 // logo backing, as a share of the full width

// Finder patterns are the three big squares in the corners. In "dots" style
// they're drawn as rounded squares, since round finders scan poorly.
function inFinder(r, c, n) {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
}

function finderOrigins(n) {
  return [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]
}

export function geometry(qr, margin) {
  const n = qr.modules.size
  return { n, total: n + margin * 2 }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

export function drawQr(ctx, qr, { size, margin, fg, bg, style = 'square', logo = null }) {
  const { n, total } = geometry(qr, margin)
  const scale = size / total
  const px = (m) => Math.round(m * scale)

  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = fg

  const dots = style === 'dots'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue
      if (dots && inFinder(r, c, n)) continue
      const x = margin + c
      const y = margin + r
      if (dots) {
        ctx.beginPath()
        ctx.arc((x + 0.5) * scale, (y + 0.5) * scale, scale * 0.42, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // Snap to whole pixels so neighbouring modules don't leave seams.
        ctx.fillRect(px(x), px(y), px(x + 1) - px(x), px(y + 1) - px(y))
      }
    }
  }

  if (dots) {
    for (const [r, c] of finderOrigins(n)) {
      const x = (margin + c) * scale
      const y = (margin + r) * scale
      ctx.fillStyle = fg
      roundRect(ctx, x, y, 7 * scale, 7 * scale, 2 * scale)
      ctx.fill()
      ctx.fillStyle = bg
      roundRect(ctx, x + scale, y + scale, 5 * scale, 5 * scale, 1.4 * scale)
      ctx.fill()
      ctx.fillStyle = fg
      roundRect(ctx, x + 2 * scale, y + 2 * scale, 3 * scale, 3 * scale, 0.9 * scale)
      ctx.fill()
    }
  }

  if (logo) {
    const box = size * LOGO_RATIO
    const pad = box * 0.12
    const x = (size - box) / 2
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, x, x, box, box, box * 0.2)
    ctx.fill()
    const inner = box - pad * 2
    const ratio = Math.min(inner / logo.width, inner / logo.height)
    const w = logo.width * ratio
    const h = logo.height * ratio
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(logo, (size - w) / 2, (size - h) / 2, w, h)
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// SVG in module units. `logo` is { dataUrl, width, height } or null.
export function qrToSvg(qr, { size, margin, fg, bg, style = 'square', logo = null }) {
  const { n, total } = geometry(qr, margin)
  const dots = style === 'dots'
  let path = ''
  let circles = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue
      if (dots && inFinder(r, c, n)) continue
      const x = margin + c
      const y = margin + r
      if (dots) circles += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.42"/>`
      else path += `M${x} ${y}h1v1h-1z`
    }
  }
  let finders = ''
  if (dots) {
    for (const [r, c] of finderOrigins(n)) {
      const x = margin + c
      const y = margin + r
      finders +=
        `<rect x="${x}" y="${y}" width="7" height="7" rx="2" fill="${esc(fg)}"/>` +
        `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.4" fill="${esc(bg)}"/>` +
        `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${esc(fg)}"/>`
    }
  }
  let logoSvg = ''
  if (logo) {
    const box = total * LOGO_RATIO
    const pad = box * 0.12
    const x = (total - box) / 2
    const inner = box - pad * 2
    const ratio = Math.min(inner / logo.width, inner / logo.height)
    const w = logo.width * ratio
    const h = logo.height * ratio
    logoSvg =
      `<rect x="${x}" y="${x}" width="${box}" height="${box}" rx="${box * 0.2}" fill="#ffffff"/>` +
      `<image href="${esc(logo.dataUrl)}" x="${(total - w) / 2}" y="${(total - h) / 2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}"${dots ? '' : ' shape-rendering="crispEdges"'}>` +
    `<rect width="${total}" height="${total}" fill="${esc(bg)}"/>` +
    (dots ? `<g fill="${esc(fg)}">${circles}</g>${finders}` : `<path fill="${esc(fg)}" d="${path}"/>`) +
    logoSvg +
    `</svg>`
  )
}
