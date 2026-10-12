// Pure geometry for the Crop & resize tool. No DOM access, so it can be
// tested in Node. Rectangles are { x, y, w, h } in image pixels.

export const PRESETS = [
  { id: 'free', label: 'Free', detail: 'Any shape' },
  { id: 'square', label: 'Square', detail: '1080 × 1080', w: 1080, h: 1080, note: 'Instagram post' },
  { id: 'portrait', label: 'Portrait 4:5', detail: '1080 × 1350', w: 1080, h: 1350, note: 'Instagram portrait' },
  { id: 'story', label: 'Story 9:16', detail: '1080 × 1920', w: 1080, h: 1920, note: 'Stories, Reels, TikTok' },
  { id: 'youtube', label: 'YouTube 16:9', detail: '1280 × 720', w: 1280, h: 720, note: 'YouTube thumbnail' },
  { id: 'x-header', label: 'X header 3:1', detail: '1500 × 500', w: 1500, h: 500, note: 'X (Twitter) header' },
  { id: 'linkedin', label: 'LinkedIn 4:1', detail: '1584 × 396', w: 1584, h: 396, note: 'LinkedIn banner' },
  { id: 'profile', label: 'Profile picture', detail: '400 × 400', w: 400, h: 400, circle: true, note: 'Shown as a circle on most sites' },
  { id: 'passport', label: 'Passport photo', detail: '35 × 45 mm', w: 413, h: 531, dpi: 300, note: '35 × 45 mm at 300 dpi' },
  { id: 'custom', label: 'Custom', detail: 'Your size' },
]

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// The largest rect with `aspect` (w / h) centred in a W × H image, optionally
// scaled down by `fill` (0-1).
export function fitAspect(W, H, aspect, fill = 1) {
  let w = W * fill
  let h = H * fill
  if (aspect) {
    if (w / h > aspect) w = h * aspect
    else h = w / aspect
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

// Moves a rect by (dx, dy), keeping it inside the image.
export function moveRect(r, dx, dy, W, H) {
  return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) }
}

// Resizes `start` by dragging `handle` (n, s, e, w, ne, nw, se, sw) to the
// image point (px, py). The opposite edge or corner stays put. With an
// aspect ratio, the rect keeps its shape. `min` is the smallest side.
export function resizeRect(start, handle, px, py, { W, H, aspect = 0, min = 8 }) {
  const hasW = handle.includes('w')
  const hasE = handle.includes('e')
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')
  const right = start.x + start.w
  const bottom = start.y + start.h

  if (!aspect) {
    let { x, y, w, h } = start
    if (hasW) {
      x = clamp(px, 0, right - min)
      w = right - x
    } else if (hasE) {
      w = clamp(px, start.x + min, W) - start.x
    }
    if (hasN) {
      y = clamp(py, 0, bottom - min)
      h = bottom - y
    } else if (hasS) {
      h = clamp(py, start.y + min, H) - start.y
    }
    return { x, y, w, h }
  }

  const minW = Math.max(min, min * aspect)
  if ((hasW || hasE) && (hasN || hasS)) {
    // Corner: anchor the opposite corner.
    const ax = hasW ? right : start.x
    const ay = hasN ? bottom : start.y
    const maxW = Math.min(hasW ? ax : W - ax, (hasN ? ay : H - ay) * aspect)
    let w = Math.max(Math.abs(px - ax), Math.abs(py - ay) * aspect)
    // Dragging past the anchor collapses to the minimum rather than flipping.
    if ((hasW && px > ax) || (hasE && px < ax)) w = Math.abs(py - ay) * aspect
    w = clamp(w, Math.min(minW, maxW), maxW)
    const h = w / aspect
    return { x: hasW ? ax - w : ax, y: hasN ? ay - h : ay, w, h }
  }

  if (hasW || hasE) {
    // Side edge: width follows the pointer, height grows around the centre.
    const ax = hasW ? right : start.x
    const cy = start.y + start.h / 2
    const maxW = Math.min(hasW ? ax : W - ax, H * aspect)
    const w = clamp(hasW ? ax - px : px - ax, Math.min(minW, maxW), maxW)
    const h = w / aspect
    return { x: hasW ? ax - w : ax, y: clamp(cy - h / 2, 0, H - h), w, h }
  }

  const ay = hasN ? bottom : start.y
  const cx = start.x + start.w / 2
  const maxH = Math.min(hasN ? ay : H - ay, W / aspect)
  const h = clamp(hasN ? ay - py : py - ay, Math.min(minW / aspect, maxH), maxH)
  const w = h * aspect
  return { x: clamp(cx - w / 2, 0, W - w), y: hasN ? ay - h : ay, w, h }
}

// Re-fits a crop to a new aspect ratio, keeping its centre where possible.
export function reshape(r, aspect, W, H) {
  if (!aspect) return r
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const area = r.w * r.h
  let w = Math.sqrt(area * aspect)
  let h = w / aspect
  const s = Math.min(1, W / w, H / h)
  w *= s
  h *= s
  return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h }
}

// Mirrors a rect inside a W × H image.
export const flipRectH = (r, W) => ({ ...r, x: W - r.x - r.w })
export const flipRectV = (r, H) => ({ ...r, y: H - r.y - r.h })

// Rotates a rect 90° with the image (dir = 1 clockwise, -1 counter).
// W, H are the image size before rotating.
export function rotateRect(r, dir, W, H) {
  return dir > 0 ? { x: H - r.y - r.h, y: r.x, w: r.h, h: r.w } : { x: r.y, y: W - r.x - r.w, w: r.h, h: r.w }
}

// How much a W × H image must be enlarged after rotating by `deg` so it
// still covers its original frame (no empty corners).
export function coverScale(W, H, deg) {
  const a = Math.abs((deg * Math.PI) / 180)
  const c = Math.cos(a)
  const s = Math.sin(a)
  return Math.max((W * c + H * s) / W, (W * s + H * c) / H)
}

// The output size for a crop. Presets give an exact size; Free and the crop
// itself give the crop's size. `noUpscale` caps the size at the crop's.
export function outputSize(crop, target, noUpscale) {
  const cw = Math.max(1, Math.round(crop.w))
  const ch = Math.max(1, Math.round(crop.h))
  if (!target) return { width: cw, height: ch, upscale: false }
  const upscale = crop.w < target.w - 0.5 || crop.h < target.h - 0.5
  if (upscale && noUpscale) {
    const s = Math.min(crop.w / target.w, crop.h / target.h)
    return { width: Math.max(1, Math.round(target.w * s)), height: Math.max(1, Math.round(target.h * s)), upscale: false, capped: true }
  }
  return { width: target.w, height: target.h, upscale }
}

// Writes a pixel density into a JPEG's JFIF header (canvas JPEGs say 72/none).
export function setJpegDpi(bytes, dpi) {
  const b = bytes
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff || b[3] !== 0xe0) return b
  if (String.fromCharCode(b[6], b[7], b[8], b[9]) !== 'JFIF' || b[10] !== 0) return b
  b[13] = 1 // dots per inch
  b[14] = dpi >> 8
  b[15] = dpi & 255
  b[16] = dpi >> 8
  b[17] = dpi & 255
  return b
}
