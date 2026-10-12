// ffmpeg.wasm wrapper for the video tool. Imported dynamically, only when the
// user starts a job. Uses the single-threaded core so it works without
// cross-origin isolation (COOP/COEP) headers, and serves the core from our
// own origin (Vite ?url imports) so nothing loads from a CDN.

import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg'
import coreAsset from '@ffmpeg/core?url'
import wasmAsset from '@ffmpeg/core/wasm?url'

let ffmpeg = null
let loading = null
let wasmBlobUrl = null
const listeners = new Set()

// Download the ~31 MB wasm ourselves so we can report progress. The blob URL
// is kept for the session, so reloading after a cancel is instant.
async function fetchWasm(onProgress) {
  if (wasmBlobUrl) return wasmBlobUrl
  const res = await fetch(new URL(wasmAsset, location.href))
  if (!res.ok) throw new Error(`Couldn’t load the video engine (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body || !total) {
    wasmBlobUrl = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/wasm' }))
    return wasmBlobUrl
  }
  const reader = res.body.getReader()
  const chunks = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.(loaded, total)
  }
  wasmBlobUrl = URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }))
  return wasmBlobUrl
}

export function isLoaded() {
  return !!ffmpeg
}

export async function load(onProgress) {
  if (ffmpeg) return ffmpeg
  if (loading) return loading
  loading = (async () => {
    const instance = new FFmpeg()
    instance.on('log', ({ message }) => listeners.forEach((fn) => fn(message)))
    const wasmURL = await fetchWasm(onProgress)
    await instance.load({ coreURL: new URL(coreAsset, location.href).href, wasmURL })
    ffmpeg = instance
    return instance
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

// Stops whatever is running. The next job reloads the engine.
export function cancel() {
  if (ffmpeg) {
    try {
      ffmpeg.terminate()
    } catch {
      // Already gone.
    }
  }
  ffmpeg = null
  loading = null
}

function parseTime(str) {
  const m = /(-?\d+):(\d+):(\d+(?:\.\d+)?)/.exec(str)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

// Mount the file read-only (WORKERFS), so large videos aren't copied into
// wasm memory, then run `fn(inputPath)`. Logs are collected for errors.
async function withInput(file, fn) {
  const engine = ffmpeg
  const dir = `/in-${Date.now()}`
  await engine.createDir(dir)
  await engine.mount(FFFSType.WORKERFS, { files: [file] }, dir)
  try {
    return await fn(engine, `${dir}/${file.name}`)
  } finally {
    if (ffmpeg === engine) {
      await engine.unmount(dir).catch(() => {})
      await engine.deleteDir(dir).catch(() => {})
    }
  }
}

// Reads duration, size and codecs from ffmpeg's own banner. Works for
// formats the browser can't play (MKV, AVI, …).
export async function probe(file) {
  const lines = []
  const onLog = (msg) => lines.push(msg)
  listeners.add(onLog)
  try {
    await withInput(file, (engine, input) => engine.exec(['-hide_banner', '-i', input]))
  } finally {
    listeners.delete(onLog)
  }
  const log = lines.join('\n')
  const duration = parseTime(/Duration:\s*([\d:.]+)/.exec(log)?.[1] || '')
  const video = /Stream #[^\n]*?Video:\s*([a-z0-9_]+)[^\n]*?(\d{2,5})x(\d{2,5})/i.exec(log)
  const audio = /Stream #[^\n]*?Audio:\s*([a-z0-9_]+)/i.exec(log)
  return {
    duration,
    videoCodec: video?.[1]?.toLowerCase() || null,
    width: video ? Number(video[2]) : null,
    height: video ? Number(video[3]) : null,
    audioCodec: audio?.[1]?.toLowerCase() || null,
  }
}

// Runs one ffmpeg job. `build(input, output)` returns the argument list.
// Calls onProgress(0..1) as ffmpeg reports its position.
export async function run(file, { output, build, duration, onProgress }) {
  const lines = []
  const onLog = (msg) => {
    lines.push(msg)
    if (lines.length > 60) lines.shift()
    const t = /time=\s*(-?[\d:.]+)/.exec(msg)
    if (t && duration) {
      const s = parseTime(t[1])
      if (s !== null && s >= 0) onProgress?.(Math.min(1, s / duration))
    }
  }
  listeners.add(onLog)
  try {
    return await withInput(file, async (engine, input) => {
      const out = `/${output}`
      try {
        const code = await engine.exec(build(input, out))
        if (code !== 0) {
          const err = new Error(explain(lines))
          err.log = lines.join('\n')
          throw err
        }
        const data = await engine.readFile(out)
        return data
      } finally {
        if (ffmpeg === engine) await engine.deleteFile(out).catch(() => {})
      }
    })
  } finally {
    listeners.delete(onLog)
  }
}

function explain(lines) {
  const log = lines.join('\n')
  if (/matches no streams|does not contain any stream|Output file .* does not contain/i.test(log)) return 'This file has no audio track to extract.'
  if (/Invalid data found|could not find codec parameters|moov atom not found/i.test(log)) return 'This file looks damaged or isn’t a supported video.'
  if (/out of memory|Cannot allocate|memory access out of bounds/i.test(log)) return 'Your browser ran out of memory. Try a shorter or smaller video.'
  const last = lines.filter((l) => l.trim() && !/^\s*(frame=|size=)/.test(l)).pop()
  return last ? `ffmpeg couldn’t process this file: ${last.trim()}` : 'ffmpeg couldn’t process this file.'
}
