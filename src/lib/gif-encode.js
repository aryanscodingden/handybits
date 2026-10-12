// Helpers for the GIF maker: the ffmpeg filter graph, frame rendering for the
// images source, and a rough size estimate.

// One pass, two stages: build a palette, then map every frame onto it.
// `pre` runs first (fps, scale, speed). Video uses stats_mode=diff, which
// favours the moving parts; slideshows use full, because diff can leave a
// whole slide's colour out of the palette (a yellow slide came out red).
export function gifFilter({ pre, stats = 'diff' }) {
  return `[0:v]${pre},split[a][b];[a]palettegen=stats_mode=${stats}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
}

// ffmpeg concat-demuxer list with a duration per frame. `framerate 100`
// keeps timestamps in centiseconds (GIF's unit); the default 25 fps would
// round 500 ms to 520. The last frame's delay is set with -final_delay.
export function imagesConcatList(names, delaysMs) {
  const lines = ['ffconcat version 1.0']
  names.forEach((name, i) => {
    lines.push(`file '${name}'`, 'option framerate 100', `duration ${(Math.max(20, delaysMs[i]) / 1000).toFixed(2)}`)
  })
  return lines.join('\n') + '\n'
}

export const finalDelay = (delaysMs) => String(Math.round(Math.max(20, delaysMs[delaysMs.length - 1]) / 10))

// Draws an image at width x height. 'fit' letterboxes on white, 'fill' crops.
export async function renderFrame(url, width, height, mode) {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  const scale = mode === 'fill' ? Math.max(width / img.naturalWidth, height / img.naturalHeight) : Math.min(width / img.naturalWidth, height / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

// Very rough: GIF frames after rectangle diffing land around 0.2-0.45 bytes
// per pixel for camera footage; slideshows are mostly full, distinct frames.
export function estimateGifBytes({ width, height, frames, motion }) {
  const perPixel = motion === 'video' ? 0.32 : 0.55
  return Math.round(width * height * frames * perPixel + 800)
}
