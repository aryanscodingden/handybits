// Canvas drawing for the Crop & resize tool. The "working image" is the
// source after quarter turns, flips and straightening; crops are measured in
// its pixels. Everything is drawn from the original bitmap in one pass, so
// exports never lose quality to intermediate resampling.

import { coverScale, setJpegDpi } from './crop-core.js'

// Size of the working image for a source of sw × sh.
export const workingSize = (sw, sh, rot) => (rot % 180 ? { W: sh, H: sw } : { W: sw, H: sh })

// Draws the working image into ctx, whose transform maps working pixels.
function drawWorking(ctx, bitmap, { rot, flipH, flipV, angle }) {
  const sw = bitmap.width
  const sh = bitmap.height
  const { W, H } = workingSize(sw, sh, rot)
  ctx.translate(W / 2, H / 2)
  if (angle) {
    ctx.rotate((angle * Math.PI) / 180)
    const s = coverScale(W, H, angle)
    ctx.scale(s, s)
  }
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(bitmap, -sw / 2, -sh / 2)
}

// A downscaled copy of the working image for the on-screen stage.
export function renderPreview(bitmap, t, maxEdge = 1800) {
  const { W, H } = workingSize(bitmap.width, bitmap.height, t.rot)
  const s = Math.min(1, maxEdge / Math.max(W, H))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W * s))
  canvas.height = Math.max(1, Math.round(H * s))
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.scale(canvas.width / W, canvas.height / H)
  drawWorking(ctx, bitmap, t)
  return canvas
}

// Large reductions look better done in halving steps than in one jump.
function stepDown(bitmap, t, crop, width, height) {
  const ratio = Math.min(crop.w / width, crop.h / height)
  if (ratio <= 2.5) return null
  // Render the crop at twice the target size first.
  const mid = document.createElement('canvas')
  mid.width = Math.round(width * 2)
  mid.height = Math.round(height * 2)
  const ctx = mid.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.scale(mid.width / crop.w, mid.height / crop.h)
  ctx.translate(-crop.x, -crop.y)
  drawWorking(ctx, bitmap, t)
  return mid
}

// Renders the crop at width × height and encodes it.
export async function exportCrop(bitmap, t, crop, { width, height, mime = 'image/jpeg', quality = 0.9, circle = false, dpi = 0 }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  if (circle) {
    ctx.beginPath()
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    ctx.clip()
  }
  const mid = stepDown(bitmap, t, crop, width, height)
  if (mid) {
    ctx.drawImage(mid, 0, 0, width, height)
    mid.width = mid.height = 0
  } else {
    ctx.save()
    ctx.scale(width / crop.w, height / crop.h)
    ctx.translate(-crop.x, -crop.y)
    drawWorking(ctx, bitmap, t)
    ctx.restore()
  }
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode the image.'))), mime, mime === 'image/png' ? undefined : quality),
  )
  canvas.width = canvas.height = 0
  if (dpi && mime === 'image/jpeg') {
    const bytes = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), dpi)
    return new Blob([bytes], { type: mime })
  }
  return blob
}
