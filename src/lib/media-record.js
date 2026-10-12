// Recording helpers for the screen recorder and device test.

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

// Best container the browser can record, preferring MP4 so the file plays
// everywhere without converting.
export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      // Some browsers throw on unknown strings.
    }
  }
  return ''
}

export function pickAudioMime() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      // Ignore.
    }
  }
  return ''
}

export const extensionFor = (mime) => (/mp4/.test(mime) ? 'mp4' : /ogg/.test(mime) ? 'ogg' : 'webm')

// A timer that keeps ticking in background tabs, where requestAnimationFrame
// stops and setInterval slows to once a second. Returns a stop function.
export function backgroundTicker(fps, onTick) {
  const src = `let t=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=()=>clearInterval(t)`
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  let worker
  try {
    worker = new Worker(url)
    worker.onmessage = onTick
  } catch {
    const id = setInterval(onTick, 1000 / fps)
    URL.revokeObjectURL(url)
    return () => clearInterval(id)
  }
  return () => {
    worker.postMessage(0)
    worker.terminate()
    URL.revokeObjectURL(url)
  }
}

// Draws the screen with a round webcam bubble onto a canvas, frame by frame.
// Uses requestAnimationFrame while the tab is visible and a worker timer when
// it isn't, so recordings don't freeze when you switch to another tab.
export function startCompositor({ canvas, screen, camera, corner, size, mirror = true, fps = 30 }) {
  const ctx = canvas.getContext('2d', { alpha: false })
  let raf = 0
  let last = 0
  let running = true
  const frameMs = 1000 / fps

  const draw = () => {
    const now = performance.now()
    if (now - last < frameMs * 0.6) return
    last = now
    const W = canvas.width
    const H = canvas.height
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    if (screen.readyState >= 2) {
      // Letterbox if the shared surface changes shape mid-recording.
      const s = Math.min(W / screen.videoWidth, H / screen.videoHeight)
      const w = screen.videoWidth * s
      const h = screen.videoHeight * s
      ctx.drawImage(screen, (W - w) / 2, (H - h) / 2, w, h)
    }
    if (camera && camera.readyState >= 2) {
      const d = Math.round(Math.min(W, H) * size)
      const m = Math.round(Math.min(W, H) * 0.035)
      const x = corner.includes('l') ? m : W - m - d
      const y = corner.includes('t') ? m : H - m - d
      const cw = camera.videoWidth
      const ch = camera.videoHeight
      const side = Math.min(cw, ch)
      ctx.save()
      ctx.beginPath()
      ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = d * 0.08
      ctx.fillStyle = '#222'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.clip()
      if (mirror) {
        ctx.translate(x + d, y)
        ctx.scale(-1, 1)
        ctx.drawImage(camera, (cw - side) / 2, (ch - side) / 2, side, side, 0, 0, d, d)
      } else ctx.drawImage(camera, (cw - side) / 2, (ch - side) / 2, side, side, x, y, d, d)
      ctx.restore()
      ctx.beginPath()
      ctx.arc(x + d / 2, y + d / 2, d / 2 - 1, 0, Math.PI * 2)
      ctx.lineWidth = Math.max(2, d * 0.02)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.stroke()
    }
  }

  const loop = () => {
    if (!running) return
    draw()
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  const stopTicker = backgroundTicker(fps, () => document.hidden && running && draw())
  return () => {
    running = false
    cancelAnimationFrame(raf)
    stopTicker()
  }
}

// MediaRecorder WebM files have no duration in their header, so the
// <video> reports Infinity until it has seen the end. Seeking far forward
// makes it work it out.
export function fixInfiniteDuration(video) {
  if (Number.isFinite(video.duration)) return
  const onTime = () => {
    video.removeEventListener('timeupdate', onTime)
    video.currentTime = 0
  }
  video.addEventListener('timeupdate', onTime)
  video.currentTime = 1e101
}
