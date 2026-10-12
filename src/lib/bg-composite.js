// Canvas helpers for the background remover. No dependencies.

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function toBlob(c, type, quality) {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('This image is too large for your browser to export.'))), type, quality),
  )
}

// Scale the model's low-resolution mask up to the original size and use it as
// the alpha channel. Returns a full-resolution transparent PNG.
export async function cutOut(file, mask, mw, mh) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const { width, height } = bitmap

  const small = canvas(mw, mh)
  const data = new ImageData(mw, mh)
  for (let i = 0; i < mask.length; i++) data.data[i * 4 + 3] = mask[i]
  small.getContext('2d').putImageData(data, 0, 0)

  const out = canvas(width, height)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('This image is too large for your browser to process.')
  ctx.drawImage(bitmap, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, 0, 0, width, height)
  bitmap.close()

  const blob = await toBlob(out, 'image/png')
  out.width = out.height = 0
  return { blob, width, height }
}

// Cheap, universally supported blur: shrink, then scale back up twice.
function blurred(bitmap, width, height) {
  const factor = Math.max(24, Math.round(Math.max(width, height) / 48))
  const w = Math.max(1, Math.round(width / factor))
  const h = Math.max(1, Math.round(height / factor))
  const tiny = canvas(w, h)
  const tctx = tiny.getContext('2d')
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(bitmap, 0, 0, w, h)
  const mid = canvas(w * 4, h * 4)
  const mctx = mid.getContext('2d')
  mctx.imageSmoothingQuality = 'high'
  mctx.drawImage(tiny, 0, 0, mid.width, mid.height)
  return mid
}

// Flatten the cut-out onto a background. `bg` is { kind: 'transparent' |
// 'color' | 'blur', color }. Returns a PNG, or a JPG when `type` asks for one.
export async function compose({ file, cutout, width, height }, bg, type = 'image/png') {
  if (bg.kind === 'transparent' && type === 'image/png') return cutout

  const out = canvas(width, height)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('This image is too large for your browser to process.')
  ctx.imageSmoothingQuality = 'high'

  if (bg.kind === 'blur') {
    const original = await createImageBitmap(file, { imageOrientation: 'from-image' })
    ctx.drawImage(blurred(original, width, height), 0, 0, width, height)
    original.close()
  } else if (bg.kind === 'color' || type === 'image/jpeg') {
    ctx.fillStyle = bg.kind === 'color' ? bg.color : '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }

  const fg = await createImageBitmap(cutout)
  ctx.drawImage(fg, 0, 0)
  fg.close()

  const blob = await toBlob(out, type, type === 'image/jpeg' ? 0.92 : undefined)
  out.width = out.height = 0
  return blob
}
