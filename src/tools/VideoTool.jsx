import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowsInSimple, CheckCircle, DownloadSimple, FileVideo, FilmSlate, MusicNotes, Swap, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { downloadBlob, formatBytes } from '../lib/format.js'
import './VideoTool.css'

const MODES = [
  { key: 'audio', label: 'Extract audio', icon: MusicNotes },
  { key: 'compress', label: 'Compress video', icon: ArrowsInSimple },
  { key: 'convert', label: 'Convert to MP4', icon: Swap },
]

const AUDIO_FORMATS = [
  { key: '128', label: '128 kbps' },
  { key: '192', label: '192 kbps' },
  { key: '320', label: '320 kbps' },
  { key: 'm4a', label: 'M4A' },
]

const TARGETS = [
  { mb: 8, label: 'Discord' },
  { mb: 16, label: 'WhatsApp' },
  { mb: 25, label: 'Email' },
  { mb: 50, label: null },
]

const BIG_FILE = 500 * 1024 * 1024
const MIN_VIDEO_KBPS = 150
const ACCEPT = 'video/*,.mkv,.mov,.webm,.avi,.m4v,.flv,.wmv,.3gp,.ts'
const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|3gp|ts|mts|mpe?g)$/i.test(f.name)
const baseName = (name) => name.replace(/\.[^.]+$/, '')

function formatDuration(s) {
  if (!Number.isFinite(s)) return null
  s = Math.max(0, Math.round(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// Bitrate plan for hitting a target size. Sizes are in decimal MB, with a 5%
// margin for container overhead and encoder overshoot.
function planCompress(targetMb, duration, width, height) {
  if (!duration || !targetMb) return null
  const budget = (targetMb * 1e6 * 8 * 0.95) / duration / 1000 // kbps for audio + video
  const audio = budget < 300 ? 48 : budget < 800 ? 96 : 128
  const ideal = Math.floor(budget - audio)
  const video = Math.max(MIN_VIDEO_KBPS, ideal)
  // Capped at 720p: single-threaded ffmpeg.wasm encodes 1080p painfully
  // slowly, and size-limited sharing rarely benefits from more.
  const maxShort = video < 500 ? 480 : 720
  const short = width && height ? Math.min(width, height) : null
  let scale = null
  if (maxShort && (!short || short > maxShort)) scale = width && height && width < height ? `scale=${maxShort}:-2` : `scale=-2:${maxShort}`
  return {
    video,
    audio,
    resolution: maxShort && (!short || short > maxShort) ? `${maxShort}p` : null,
    scale,
    fits: ideal >= MIN_VIDEO_KBPS,
    quality: video < 300 ? 'poor' : video < 700 ? 'low' : 'good',
    estimate: ((video + audio) * 1000 * duration) / 8,
  }
}

function friendlyError(err) {
  const msg = String(err?.message || err || '')
  if (/memory|alloc|RangeError/i.test(msg)) return 'Your browser ran out of memory. Try a shorter or smaller video, or close other tabs.'
  return msg || 'Something went wrong.'
}

export default function VideoTool() {
  const [mode, setMode] = useState('audio')
  const [file, setFile] = useState(null)
  const [meta, setMeta] = useState(null) // { duration, width, height } from the browser, if it can read the file
  const [audioFormat, setAudioFormat] = useState('192')
  const [target, setTarget] = useState(8)
  const [customMb, setCustomMb] = useState('10')
  const [status, setStatus] = useState('idle') // idle | loading | probing | running | done | error
  const [loadProgress, setLoadProgress] = useState(null)
  const [progress, setProgress] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const cancelled = useRef(false)
  const engine = useRef(null)

  const busy = status === 'loading' || status === 'probing' || status === 'running'
  const targetMb = target === 'custom' ? Number(customMb) : target

  // Read duration and size from the file's metadata with a hidden <video>.
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () =>
      setMeta({ duration: Number.isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null })
    v.onerror = () => setMeta({ duration: null, width: null, height: null })
    v.src = url
    return () => {
      v.removeAttribute('src')
      v.load()
      URL.revokeObjectURL(url)
    }
  }, [file])

  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [busy])

  useEffect(() => () => result && URL.revokeObjectURL(result.url), [result])

  // Stop ffmpeg if the user leaves the tool mid-job.
  useEffect(
    () => () => {
      if (engine.current) {
        cancelled.current = true
        engine.current.cancel()
      }
    },
    [],
  )

  const pick = useCallback((files) => {
    const f = files.find(isVideo)
    if (!f) {
      setError('That doesn’t look like a video file.')
      return
    }
    setFile(f)
    setMeta(null)
    setResult(null)
    setError(null)
    setNotice(null)
    setStatus('idle')
  }, [])

  function reset() {
    setFile(null)
    setMeta(null)
    setResult(null)
    setError(null)
    setNotice(null)
    setStatus('idle')
  }

  async function start() {
    if (!file || busy) return
    cancelled.current = false
    setError(null)
    setNotice(null)
    setResult(null)
    setProgress(0)
    setLoadProgress(null)
    setStartedAt(Date.now())
    setNow(Date.now())

    try {
      setStatus('loading')
      const lib = await import('../lib/video-engine.js')
      engine.current = lib
      await lib.load((loaded, total) => setLoadProgress({ loaded, total }))
      if (cancelled.current) return

      setStatus('probing')
      const info = await lib.probe(file)
      if (cancelled.current) return
      const duration = meta?.duration || info.duration
      const width = info.width || meta?.width
      const height = info.height || meta?.height

      let output
      let type
      let build
      const base = baseName(file.name)

      if (mode === 'audio') {
        if (!info.audioCodec) throw new Error('This video has no audio track to extract.')
        if (audioFormat === 'm4a') {
          output = `${base}.m4a`
          type = 'audio/mp4'
          const codec = info.audioCodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']
          build = (i, o) => ['-i', i, '-vn', '-map', '0:a:0', ...codec, '-movflags', '+faststart', o]
        } else {
          output = `${base}.mp3`
          type = 'audio/mpeg'
          build = (i, o) => ['-i', i, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', `${audioFormat}k`, o]
        }
      } else if (mode === 'compress') {
        if (!duration) throw new Error('Couldn’t read how long this video is, so the target size can’t be calculated.')
        const plan = planCompress(targetMb, duration, width, height)
        output = `${base}-${targetMb}mb.mp4`
        type = 'video/mp4'
        const vf = plan.scale || 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
        const audio = info.audioCodec ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', `${plan.audio}k`, '-ac', '2'] : []
        build = (i, o) => [
          '-i', i,
          '-map', '0:v:0',
          '-c:v', 'libx264', '-preset', 'veryfast',
          '-b:v', `${plan.video}k`, '-maxrate', `${Math.round(plan.video * 1.4)}k`, '-bufsize', `${plan.video * 2}k`,
          '-vf', vf, '-pix_fmt', 'yuv420p',
          ...audio,
          '-movflags', '+faststart', o,
        ]
      } else {
        const copyVideo = ['h264', 'hevc', 'mpeg4'].includes(info.videoCodec)
        const copyAudio = !info.audioCodec || ['aac', 'mp3'].includes(info.audioCodec)
        output = /\.mp4$/i.test(file.name) ? `${base}-converted.mp4` : `${base}.mp4`
        type = 'video/mp4'
        const audioMap = info.audioCodec ? ['-map', '0:a:0'] : []
        if (copyVideo && copyAudio) {
          // Same codecs, new container: fast and lossless.
          const tag = info.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []
          build = (i, o) => ['-i', i, '-map', '0:v:0', ...audioMap, '-c', 'copy', ...tag, '-movflags', '+faststart', o]
        } else {
          const audio = info.audioCodec ? (copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']) : []
          build = (i, o) => [
            '-i', i,
            '-map', '0:v:0', ...audioMap,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
            ...audio,
            '-movflags', '+faststart', o,
          ]
        }
      }

      setStatus('running')
      setStartedAt(Date.now())
      const data = await lib.run(file, { output, build, duration, onProgress: setProgress })
      if (cancelled.current) return
      const blob = new Blob([data], { type })
      setResult({ blob, url: URL.createObjectURL(blob), name: output, type, kind: mode })
      if (mode === 'compress' && blob.size > targetMb * 1e6) setNotice(`The result is a little over ${targetMb} MB. Try a smaller target if it has to fit.`)
      setStatus('done')
    } catch (err) {
      if (cancelled.current) return
      console.error(err)
      setError(friendlyError(err))
      setStatus('error')
    }
  }

  function cancel() {
    cancelled.current = true
    engine.current?.cancel()
    setStatus('idle')
    setProgress(0)
    setNotice('Cancelled.')
  }

  const plan = mode === 'compress' && meta ? planCompress(targetMb, meta.duration, meta.width, meta.height) : null
  const elapsed = busy ? Math.max(0, now - startedAt) / 1000 : 0
  const remaining = status === 'running' && progress > 0.04 && elapsed > 3 ? (elapsed / progress) * (1 - progress) : null
  const validTarget = target !== 'custom' || (Number(customMb) >= 1 && Number(customMb) <= 4000)
  const verb = { audio: 'Extracting audio', compress: 'Compressing', convert: 'Converting' }[mode]
  const startLabel = {
    audio: audioFormat === 'm4a' ? 'Extract M4A' : 'Extract MP3',
    compress: validTarget ? `Compress to ${targetMb} MB` : 'Compress',
    convert: 'Convert to MP4',
  }[mode]

  return (
    <div className="tool">
      <header className="header">
        <h1 className="title">Video to MP3</h1>
        <p className="lede">Pull the audio out of a video, shrink a video to fit a size limit, or convert it to MP4. It all runs in your browser, so your files are never uploaded.</p>
      </header>

      <div className="vid-modes">
        <div className="choice" role="radiogroup" aria-label="What to do">
          {MODES.map((m) => {
            const Icon = m.icon
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={mode === m.key}
                className={mode === m.key ? 'on' : ''}
                onClick={() => {
                  setMode(m.key)
                  setResult(null)
                  setNotice(null)
                  if (status !== 'idle' && !busy) setStatus('idle')
                }}
                disabled={busy}
              >
                <Icon size={16} />
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {!file ? (
        <DropZone
          onFiles={pick}
          accept={ACCEPT}
          multiple={false}
          title="Drop a video here or click to browse"
          sub="MP4, MOV, WebM, MKV, AVI and most other formats. Shorter videos work best; very long ones can take a while."
          button="Choose a video"
        />
      ) : (
        <ul className="rows">
          <li className="row vid-row">
            <span className="file-icon" aria-hidden="true">
              <FileVideo size={20} weight="duotone" />
            </span>
            <div className="row-main">
              <span className="name">{file.name}</span>
              <span className="meta">
                {formatBytes(file.size)}
                {meta?.duration ? ` · ${formatDuration(meta.duration)}` : ''}
                {meta?.width ? ` · ${meta.width} × ${meta.height}` : ''}
              </span>
            </div>
            <div className="row-actions">
              <button type="button" className="icon" aria-label={`Remove ${file.name}`} title="Remove" onClick={reset} disabled={busy}>
                <X size={16} />
              </button>
            </div>
          </li>
        </ul>
      )}

      {error && (
        <p className="notice error vid-notice" role="alert">
          <WarningCircle size={16} weight="fill" />
          {error}
        </p>
      )}

      {file && file.size > BIG_FILE && (
        <p className="notice error vid-notice">
          <WarningCircle size={16} weight="fill" />
          This is a large file ({formatBytes(file.size)}). Processing in the browser may be slow or run out of memory. A shorter clip is more reliable.
        </p>
      )}

      {file && (
        <section className="section vid-options" aria-label="Options">
          {mode === 'audio' && (
            <div className="vid-field">
              <span className="field-label" id="vid-audio-label">
                Quality
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="vid-audio-label">
                {AUDIO_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="radio"
                    aria-checked={audioFormat === f.key}
                    className={audioFormat === f.key ? 'on' : ''}
                    onClick={() => setAudioFormat(f.key)}
                    disabled={busy}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="vid-help">
                {audioFormat === 'm4a'
                  ? 'Keeps the original AAC audio without re-encoding when possible, so there’s no quality loss.'
                  : audioFormat === '320'
                    ? 'Highest MP3 quality. Larger files.'
                    : audioFormat === '128'
                      ? 'Smaller files, fine for speech and podcasts.'
                      : 'A good balance for music.'}
              </p>
            </div>
          )}

          {mode === 'compress' && (
            <div className="vid-field">
              <span className="field-label" id="vid-target-label">
                Target size
              </span>
              <div className="vid-targets" role="radiogroup" aria-labelledby="vid-target-label">
                {TARGETS.map((t) => (
                  <button
                    key={t.mb}
                    type="button"
                    role="radio"
                    aria-checked={target === t.mb}
                    className={`vid-target${target === t.mb ? ' on' : ''}`}
                    onClick={() => setTarget(t.mb)}
                    disabled={busy}
                  >
                    <span className="vid-target-size">{t.mb} MB</span>
                    {t.label && <span className="vid-target-label">{t.label}</span>}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={target === 'custom'}
                  className={`vid-target${target === 'custom' ? ' on' : ''}`}
                  onClick={() => setTarget('custom')}
                  disabled={busy}
                >
                  <span className="vid-target-size">Custom</span>
                  <span className="vid-target-label">Any size</span>
                </button>
              </div>
              {target === 'custom' && (
                <label className="vid-custom">
                  <span className="field-label">Size in MB</span>
                  <input
                    className="input vid-input"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max="4000"
                    step="1"
                    value={customMb}
                    onChange={(e) => setCustomMb(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              {plan && validTarget && (
                <p className="vid-help">
                  About {plan.video.toLocaleString()} kbps video and {plan.audio} kbps audio
                  {plan.resolution ? `, scaled down to ${plan.resolution}` : ''}. H.264 MP4.
                </p>
              )}
              {plan && validTarget && file.size <= targetMb * 1e6 && (
                <p className="notice ok vid-inline">
                  <CheckCircle size={16} weight="fill" />
                  This video is already under {targetMb} MB. Compressing it anyway may not make it much smaller.
                </p>
              )}
              {plan && validTarget && file.size > targetMb * 1e6 && !plan.fits && (
                <p className="notice error vid-inline">
                  <WarningCircle size={16} weight="fill" />
                  This video is too long to fit in {targetMb} MB at watchable quality. It will come out at about {formatBytes(plan.estimate)} and look rough. Try a
                  larger target or trim the video first.
                </p>
              )}
              {plan && validTarget && plan.fits && plan.quality === 'poor' && file.size > targetMb * 1e6 && (
                <p className="notice error vid-inline">
                  <WarningCircle size={16} weight="fill" />
                  That’s a low bitrate for this length, so expect visible blockiness. A larger target will look better.
                </p>
              )}
              {meta && !meta.duration && <p className="vid-help">The bitrate is worked out once the video engine has read the file.</p>}
            </div>
          )}

          {mode === 'convert' && (
            <p className="vid-help vid-help-solo">
              If the video already uses MP4-friendly codecs (H.264 or HEVC with AAC or MP3 audio), it’s repackaged without re-encoding, which is fast and
              lossless. Otherwise it’s re-encoded to H.264, which takes longer.
            </p>
          )}
        </section>
      )}

      {file && (
        <div className="controls">
          <span className="meta">{busy ? null : status === 'done' ? 'Done. Change the options to run again.' : ''}</span>
          <div className="actions">
            {busy ? (
              <button type="button" className="btn" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={reset}>
                Clear
              </button>
            )}
            <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={start} disabled={busy || !validTarget}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? 'Working…' : startLabel}
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="vid-progress-wrap" role="status" aria-live="polite">
          <div className="vid-progress-text">
            <span>
              {status === 'loading' &&
                (loadProgress
                  ? `Loading video engine · ${(loadProgress.loaded / 1048576).toFixed(1)} of ${(loadProgress.total / 1048576).toFixed(1)} MB`
                  : 'Loading video engine (~30 MB, one-time)')}
              {status === 'probing' && 'Reading video…'}
              {status === 'running' && `${verb}… ${Math.round(progress * 100)}%`}
            </span>
            <span className="vid-progress-note">
              {formatDuration(elapsed)} elapsed
              {remaining !== null ? ` · about ${formatDuration(remaining)} left` : ''}
            </span>
          </div>
          <div
            className={`vid-progress${status === 'probing' || (status === 'loading' && !loadProgress) || (status === 'running' && !progress) ? ' indeterminate' : ''}`}
            role="progressbar"
            aria-label={status === 'loading' ? 'Loading video engine' : verb}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              status === 'running' ? Math.round(progress * 100) : status === 'loading' && loadProgress ? Math.round((loadProgress.loaded / loadProgress.total) * 100) : undefined
            }
          >
            <span
              style={{
                width:
                  status === 'running' && progress
                    ? `${progress * 100}%`
                    : status === 'loading' && loadProgress
                      ? `${(loadProgress.loaded / loadProgress.total) * 100}%`
                      : undefined,
              }}
            />
          </div>
          {status === 'loading' && <p className="vid-progress-sub">One-time download, cached by your browser.</p>}
        </div>
      )}

      {notice && !busy && (
        <p className={`notice vid-notice ${notice === 'Cancelled.' ? '' : 'error'}`}>
          {notice !== 'Cancelled.' && <WarningCircle size={16} weight="fill" />}
          {notice}
        </p>
      )}

      {result && (
        <section className="section" aria-label="Result">
          <div className="section-head">
            <h2>Result</h2>
          </div>
          <div className="panel vid-result">
            {result.type.startsWith('audio/') ? (
              <audio className="vid-preview-audio" src={result.url} controls preload="metadata" />
            ) : (
              <video className="vid-preview" src={result.url} controls preload="metadata" playsInline />
            )}
            <div className="vid-result-row">
              <span className="file-icon pdf" aria-hidden="true">
                {result.type.startsWith('audio/') ? <MusicNotes size={20} weight="duotone" /> : <FilmSlate size={20} weight="duotone" />}
              </span>
              <div className="row-main">
                <span className="name">{result.name}</span>
                <span className="meta">
                  {formatBytes(result.blob.size)}
                  {file && result.kind !== 'audio' && (
                    <>
                      {' · '}
                      {result.blob.size < file.size
                        ? `${Math.round((1 - result.blob.size / file.size) * 100)}% smaller than the original`
                        : `original was ${formatBytes(file.size)}`}
                    </>
                  )}
                </span>
              </div>
              <button type="button" className="btn primary" onClick={() => downloadBlob(result.blob, result.name)}>
                <DownloadSimple size={16} weight="bold" />
                Download
              </button>
            </div>
          </div>
        </section>
      )}

      <footer className="footer">
        Runs entirely in your browser with ffmpeg.wasm, so nothing is uploaded. Extracting audio and repackaging are quick. Compressing and re-encoding
        are much slower than a desktop app: expect several times the length of the video. Compressed videos are capped at 720p to keep that bearable.
      </footer>
    </div>
  )
}
