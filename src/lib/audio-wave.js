// Waveform drawing and fade scheduling for the audio cutter.

// Draws min/max peaks for [from, to] seconds of `buffer` onto `canvas`, one
// device pixel column at a time, so it stays sharp on high-DPI screens.
export function drawWaveform(canvas, buffer, from, to, color) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  if (!buffer || W < 2) return
  const rate = buffer.sampleRate
  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  const first = Math.max(0, Math.floor(from * rate))
  const last = Math.min(buffer.length, Math.ceil(to * rate))
  const perPx = (last - first) / W
  // Long files: look at up to ~1500 samples per column. Peaks stay accurate
  // enough to the eye and redraws stay quick.
  const stride = Math.max(1, Math.floor(perPx / 1500))
  const mid = H / 2
  const amp = (H / 2) * 0.94
  ctx.fillStyle = color
  // Faint centre line, so silence still reads as a waveform.
  ctx.globalAlpha = 0.35
  ctx.fillRect(0, Math.floor(mid), W, 1)
  ctx.globalAlpha = 1
  for (let x = 0; x < W; x++) {
    const s0 = first + Math.floor(x * perPx)
    const s1 = Math.max(s0 + 1, first + Math.floor((x + 1) * perPx))
    let min = 1
    let max = -1
    for (const data of channels) {
      for (let i = s0; i < s1 && i < last; i += stride) {
        const v = data[i]
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (max < min) continue
    const top = mid - max * amp
    const h = Math.max(1, (max - min) * amp)
    ctx.fillRect(x, top, 1, h)
  }
}

// Linear fade-in from `start`, fade-out ending at `end`, like ffmpeg's afade.
export function gainAt(t, { start, end, fadeIn, fadeOut }) {
  let g = 1
  if (fadeIn > 0) g = Math.min(g, (t - start) / fadeIn)
  if (fadeOut > 0) g = Math.min(g, (end - t) / fadeOut)
  return Math.min(1, Math.max(0, g))
}

// Schedules the same fades on a GainNode for playback starting at `from`.
export function scheduleFades(param, when, from, sel) {
  const points = [sel.start + sel.fadeIn, sel.end - sel.fadeOut, sel.end].filter((t) => t > from).sort((a, b) => a - b)
  param.cancelScheduledValues(when)
  param.setValueAtTime(gainAt(from, sel), when)
  for (const t of points) param.linearRampToValueAtTime(gainAt(t, sel), when + (t - from))
}
