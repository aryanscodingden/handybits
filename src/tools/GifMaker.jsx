import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, DownloadSimple, FileVideo, FilmStrip, Gif, Images, Play, Stop, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { downloadBlob, formatBytes } from '../lib/format.js'
import { baseName, clamp, formatClock, friendlyError, loadEngine, parseClock } from '../lib/media-utils.js'
import { estimateGifBytes, finalDelay, gifFilter, imagesConcatList, renderFrame } from '../lib/gif-encode.js'
import './GifMaker.css'

const SOURCES = [
  { key: 'video', label: 'From video', icon: FileVideo },
  { key: 'images', label: 'From images', icon: Images },
]
const FPS = [8, 10, 12, 15, 20]
const WIDTHS = [
  { key: 320, label: '320' },
  { key: 480, label: '480' },
  { key: 640, label: '640' },
  { key: 'orig', label: 'Original' },
]
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const MAX_ORIGINAL = 800
const BIG_GIF = 15 * 1024 * 1024
// split + palettegen keeps every frame in memory until the palette is ready.
const MAX_FRAME_BYTES = 520 * 1024 * 1024
const VIDEO_ACCEPT = 'video/*,.mkv,.mov,.webm,.avi,.m4v'
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp'
const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|mkv|webm|avi)$/i.test(f.name)
const isImage = (f) => f.type.startsWith('image/') && !/svg|heic|heif/.test(f.type)

let nextId = 1

export default function GifMaker() {
  const [source, setSource] = useState('video')
  // Video source
  const [video, setVideo] = useState(null) // { file, url, duration, width, height }
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [fps, setFps] = useState(12)
  const [speed, setSpeed] = useState(1)
  // Images source
  const [frames, setFrames] = useState([]) // { id, file, url, width, height, delay }
  const [defaultDelay, setDefaultDelay] = useState(500)
  const [fit, setFit] = useState('fit')
  // Shared
  const [width, setWidth] = useState(480)
  const [loop, setLoop] = useState(true)
  const [status, setStatus] = useState('idle') // idle | loading | preparing | running | done
  const [loadProgress, setLoadProgress] = useState(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const cancelled = useRef(false)
  const engine = useRef(null)
  const player = useRef(null)
  const previewStop = useRef(null)
  const [previewing, setPreviewing] = useState(false)

  const busy = status === 'loading' || status === 'preparing' || status === 'running'

  useEffect(() => () => video && URL.revokeObjectURL(video.url), [video])
  useEffect(() => () => result && URL.revokeObjectURL(result.url), [result])
  const framesRef = useRef(frames)
  useEffect(() => {
    framesRef.current = frames
  }, [frames])
  useEffect(() => () => framesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), [])
  useEffect(
    () => () => {
      if (engine.current) {
        cancelled.current = true
        engine.current.cancel()
      }
    },
    [],
  )

  const clearResult = () => {
    setResult(null)
    setNotice(null)
    if (status === 'done') setStatus('idle')
  }

  const pickVideo = useCallback((files) => {
    const f = files.find(isVideo)
    if (!f) {
      setError('That doesn’t look like a video file.')
      return
    }
    setError(null)
    setResult(null)
    setNotice(null)
    setStatus('idle')
    const url = URL.createObjectURL(f)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => {
      const duration = Number.isFinite(v.duration) ? v.duration : 0
      setVideo({ file: f, url, duration, width: v.videoWidth, height: v.videoHeight })
      setStart(0)
      setEnd(Math.min(duration, 5))
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      setError('Your browser can’t play this video, so it can’t be previewed or trimmed here. Try converting it to MP4 first.')
    }
    v.src = url
  }, [])

  const addImages = useCallback(
    async (files) => {
      const imgs = files.filter(isImage)
      if (!imgs.length) {
        setError('Those don’t look like images (PNG, JPG, WebP or GIF).')
        return
      }
      setError(null)
      const loaded = await Promise.all(
        imgs.map(
          (file) =>
            new Promise((resolve) => {
              const url = URL.createObjectURL(file)
              const img = new Image()
              img.onload = () => resolve({ id: nextId++, file, url, width: img.naturalWidth, height: img.naturalHeight, delay: defaultDelay })
              img.onerror = () => {
                URL.revokeObjectURL(url)
                resolve(null)
              }
              img.src = url
            }),
        ),
      )
      const ok = loaded.filter(Boolean)
      if (ok.length < imgs.length) setError(`${imgs.length - ok.length} image${imgs.length - ok.length > 1 ? 's' : ''} couldn’t be read and ${imgs.length - ok.length > 1 ? 'were' : 'was'} skipped.`)
      setFrames((prev) => [...prev, ...ok])
      setResult(null)
      setNotice(null)
      setStatus('idle')
    },
    [defaultDelay],
  )

  function move(i, dir) {
    setFrames((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    clearResult()
  }

  function removeFrame(id) {
    setFrames((prev) => {
      const f = prev.find((x) => x.id === id)
      if (f) URL.revokeObjectURL(f.url)
      return prev.filter((x) => x.id !== id)
    })
    clearResult()
  }

  function removeVideo() {
    stopPreview()
    setVideo(null)
    setResult(null)
    setNotice(null)
    setError(null)
    setStatus('idle')
  }

  // Output size
  const srcW = source === 'video' ? video?.width : frames[0]?.width
  const srcH = source === 'video' ? video?.height : frames[0]?.height
  const cap = width === 'orig' ? MAX_ORIGINAL : width
  // Video is never upscaled; images are scaled to the chosen width either way.
  const outW = srcW ? (source === 'video' || width === 'orig' ? Math.min(cap, srcW) : cap) : null
  const outH = srcW && srcH ? Math.max(2, Math.round((outW * srcH) / srcW)) : null
  const clip = Math.max(0, end - start)
  const frameCount = source === 'video' ? Math.max(1, Math.round((clip / speed) * fps)) : frames.length
  const playSeconds = source === 'video' ? clip / speed : frames.reduce((s, f) => s + f.delay / 1000, 0)
  const estimate = outW && outH ? estimateGifBytes({ width: outW, height: outH, frames: frameCount, motion: source === 'video' ? 'video' : 'slides' }) : null
  const tooHeavy = outW && outH ? frameCount * outW * outH * 4 > MAX_FRAME_BYTES : false
  const ready = source === 'video' ? !!video && clip >= 0.1 && !tooHeavy : frames.length >= 1 && !tooHeavy && frames.every((f) => f.delay >= 20)

  // Preview the trimmed clip at the chosen speed.
  function stopPreview() {
    const v = player.current
    if (previewStop.current) previewStop.current()
    previewStop.current = null
    if (v) v.pause()
    setPreviewing(false)
  }

  function previewClip() {
    const v = player.current
    if (!v) return
    if (previewing) {
      stopPreview()
      return
    }
    v.currentTime = start
    v.playbackRate = speed
    const onTime = () => {
      if (v.currentTime >= end) {
        if (loop) v.currentTime = start
        else stopPreview()
      }
    }
    v.addEventListener('timeupdate', onTime)
    previewStop.current = () => {
      v.removeEventListener('timeupdate', onTime)
      v.playbackRate = 1
    }
    v.play().catch(() => {})
    setPreviewing(true)
  }

  function setTrim(which, value) {
    const d = video?.duration || 0
    if (which === 'start') {
      const s = clamp(value, 0, Math.max(0, end - 0.1))
      setStart(s)
      if (player.current && !previewing) player.current.currentTime = s
    } else {
      const e = clamp(value, start + 0.1, d)
      setEnd(e)
      if (player.current && !previewing) player.current.currentTime = e
    }
    clearResult()
  }

  async function encode() {
    if (!ready || busy) return
    stopPreview()
    cancelled.current = false
    setError(null)
    setNotice(null)
    setResult(null)
    setProgress(0)
    setLoadProgress(null)
    try {
      setStatus('loading')
      const lib = await loadEngine((loaded, total) => setLoadProgress({ loaded, total }))
      engine.current = lib
      if (cancelled.current) return
      const loopArgs = ['-loop', loop ? '0' : '-1']
      let data
      let name
      if (source === 'video') {
        name = `${baseName(video.file.name)}.gif`
        const filter = gifFilter({ pre: `setpts=PTS/${speed},fps=${fps},scale=${outW}:-1:flags=lanczos` })
        setStatus('running')
        data = await lib.run(video.file, {
          output: 'out.gif',
          duration: clip / speed,
          onProgress: setProgress,
          build: (i, o) => ['-ss', start.toFixed(3), '-t', clip.toFixed(3), '-i', i, '-an', '-filter_complex', filter, ...loopArgs, o],
        })
      } else {
        name = `${baseName(frames[0].file.name)}-animated.gif`
        setStatus('preparing')
        const files = {}
        for (let i = 0; i < frames.length; i++) {
          files[`f${String(i).padStart(4, '0')}.png`] = await renderFrame(frames[i].url, outW, outH, fit)
          if (cancelled.current) return
          setProgress((i + 1) / frames.length)
        }
        files['list.txt'] = imagesConcatList(Object.keys(files), frames.map((f) => f.delay))
        setProgress(0)
        setStatus('running')
        data = await lib.runFiles({
          data: files,
          output: 'out.gif',
          duration: playSeconds,
          onProgress: setProgress,
          build: ({ data: d }, o) => ['-f', 'concat', '-safe', '0', '-i', d['list.txt'], '-filter_complex', gifFilter({ pre: 'null', stats: 'full' }), '-vsync', 'vfr', '-final_delay', finalDelay(frames.map((f) => f.delay)), ...loopArgs, o],
        })
      }
      if (cancelled.current) return
      const blob = new Blob([data], { type: 'image/gif' })
      setResult({ blob, url: URL.createObjectURL(blob), name, width: outW, height: outH, frames: frameCount })
      setStatus('done')
    } catch (err) {
      if (cancelled.current) return
      console.error(err)
      setError(friendlyError(err))
      setStatus('idle')
    }
  }

  function cancel() {
    cancelled.current = true
    engine.current?.cancel()
    setStatus('idle')
    setProgress(0)
    setNotice('Cancelled.')
  }

  const hasInput = source === 'video' ? !!video : frames.length > 0

  return (
    <div className="tool gif">
      <header className="header">
        <h1 className="title">GIF maker</h1>
        <p className="lede">Turn a video clip or a handful of images into an animated GIF. Everything runs in your browser, so nothing is uploaded.</p>
      </header>

      <div className="gif-source">
        <div className="choice" role="radiogroup" aria-label="Make a GIF from">
          {SOURCES.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={source === s.key}
                className={source === s.key ? 'on' : ''}
                disabled={busy}
                onClick={() => {
                  stopPreview()
                  setSource(s.key)
                  setResult(null)
                  setError(null)
                  setNotice(null)
                  setStatus('idle')
                }}
              >
                <Icon size={16} />
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {source === 'video' &&
        (!video ? (
          <DropZone
            onFiles={pickVideo}
            accept={VIDEO_ACCEPT}
            multiple={false}
            title="Drop a video here or click to browse"
            sub="MP4, MOV or WebM. You’ll pick the part to turn into a GIF next."
            button="Choose a video"
          />
        ) : (
          <div className="panel gif-video">
            <video ref={player} className="gif-player" src={video.url} controls playsInline muted preload="auto" onPause={() => previewing && stopPreview()} />
            <div className="gif-file">
              <FileVideo size={18} weight="duotone" aria-hidden="true" />
              <span className="name">{video.file.name}</span>
              <span className="meta">
                {video.width} × {video.height}
              </span>
              <button type="button" className="icon" aria-label="Remove video" title="Remove" onClick={removeVideo} disabled={busy}>
                <X size={16} />
              </button>
            </div>
            <div className="gif-trim-head">
              <span className="field-label">Clip</span>
              <span className="gif-trim-len">
                {formatClock(clip, 1)} of {formatClock(video.duration, 1)}
              </span>
            </div>
            <TrimTrack duration={video.duration} start={start} end={end} onChange={setTrim} disabled={busy} />
            <div className="gif-trim-fields">
              <TimeField label="Start" value={start} onCommit={(v) => setTrim('start', v)} disabled={busy} onUseCurrent={() => player.current && setTrim('start', player.current.currentTime)} />
              <TimeField label="End" value={end} onCommit={(v) => setTrim('end', v)} disabled={busy} onUseCurrent={() => player.current && setTrim('end', player.current.currentTime)} />
              <button type="button" className="btn small gif-preview-btn" onClick={previewClip} disabled={busy}>
                {previewing ? <Stop size={14} weight="fill" /> : <Play size={14} weight="fill" />}
                {previewing ? 'Stop' : 'Preview clip'}
              </button>
            </div>
          </div>
        ))}

      {source === 'images' && (
        <>
          {frames.length === 0 ? (
            <DropZone
              onFiles={addImages}
              accept={IMAGE_ACCEPT}
              title="Drop images here or click to browse"
              sub="PNG, JPG, WebP or GIF. Add two or more; you can reorder them next."
              button="Choose images"
            />
          ) : (
            <>
              <ol className="rows gif-frames" aria-label="Frames">
                {frames.map((f, i) => (
                  <li key={f.id} className="row gif-frame">
                    <span className="gif-frame-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <img className="gif-thumb" src={f.url} alt="" />
                    <div className="row-main">
                      <span className="name">{f.file.name}</span>
                      <span className="meta">
                        {f.width} × {f.height}
                      </span>
                    </div>
                    <label className="gif-delay">
                      <span className="sr-only">Delay for frame {i + 1}, in milliseconds</span>
                      <input
                        className="input gif-num"
                        type="number"
                        min="20"
                        max="10000"
                        step="10"
                        value={f.delay}
                        disabled={busy}
                        onChange={(e) => {
                          const delay = Number(e.target.value)
                          setFrames((prev) => prev.map((x) => (x.id === f.id ? { ...x, delay } : x)))
                          clearResult()
                        }}
                      />
                      <span className="gif-unit">ms</span>
                    </label>
                    <div className="gif-frame-actions">
                      <button type="button" className="icon" aria-label={`Move frame ${i + 1} up`} title="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp size={16} />
                      </button>
                      <button type="button" className="icon" aria-label={`Move frame ${i + 1} down`} title="Move down" disabled={busy || i === frames.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown size={16} />
                      </button>
                      <button type="button" className="icon danger" aria-label={`Remove frame ${i + 1}`} title="Remove" disabled={busy} onClick={() => removeFrame(f.id)}>
                        <X size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="gif-add">
                <DropZone onFiles={addImages} accept={IMAGE_ACCEPT} compact title="Add more images" />
              </div>
            </>
          )}
        </>
      )}

      {error && (
        <p className="notice error gif-notice" role="alert">
          <WarningCircle size={16} weight="fill" />
          {error}
        </p>
      )}

      {hasInput && (
        <section className="gif-options" aria-label="Options">
          {source === 'video' && (
            <>
              <Segmented label="Frame rate" value={fps} options={FPS.map((f) => ({ key: f, label: `${f} fps` }))} onChange={(v) => (setFps(v), clearResult())} disabled={busy} />
              <div className="gif-field">
                <label className="field-label" htmlFor="gif-speed">
                  Speed <span className="gif-value">{speed}×</span>
                </label>
                <input
                  id="gif-speed"
                  className="gif-range"
                  type="range"
                  min="0"
                  max={SPEEDS.length - 1}
                  step="1"
                  value={SPEEDS.indexOf(speed)}
                  aria-valuetext={`${speed} times`}
                  onChange={(e) => {
                    setSpeed(SPEEDS[Number(e.target.value)])
                    clearResult()
                  }}
                  disabled={busy}
                />
              </div>
            </>
          )}
          {source === 'images' && (
            <>
              <div className="gif-field">
                <span className="field-label" id="gif-delay-all">
                  Delay for every frame
                </span>
                <div className="gif-inline">
                  <input
                    className="input gif-num"
                    type="number"
                    min="20"
                    max="10000"
                    step="10"
                    value={defaultDelay}
                    aria-labelledby="gif-delay-all"
                    onChange={(e) => setDefaultDelay(Number(e.target.value))}
                    disabled={busy}
                  />
                  <span className="gif-unit">ms</span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy || defaultDelay < 20}
                    onClick={() => {
                      setFrames((prev) => prev.map((f) => ({ ...f, delay: defaultDelay })))
                      clearResult()
                    }}
                  >
                    Apply to all
                  </button>
                </div>
              </div>
              <Segmented
                label="Different sizes"
                value={fit}
                options={[
                  { key: 'fit', label: 'Fit' },
                  { key: 'fill', label: 'Fill' },
                ]}
                onChange={(v) => (setFit(v), clearResult())}
                disabled={busy}
                help={fit === 'fit' ? 'Whole image visible, with white bars where shapes differ.' : 'Fills the frame, cropping the edges where shapes differ.'}
              />
            </>
          )}
          <Segmented
            label="Width"
            value={width}
            options={WIDTHS.map((w) => ({ ...w, label: w.key === 'orig' ? 'Original' : `${w.label} px` }))}
            onChange={(v) => (setWidth(v), clearResult())}
            disabled={busy}
            help={width === 'orig' ? `Up to ${MAX_ORIGINAL} px wide.` : null}
          />
          <Segmented
            label="Playback"
            value={loop}
            options={[
              { key: true, label: 'Loop forever' },
              { key: false, label: 'Play once' },
            ]}
            onChange={(v) => (setLoop(v), clearResult())}
            disabled={busy}
          />
        </section>
      )}

      {hasInput && (
        <div className="controls">
          <span className="meta gif-estimate">
            {outW && outH && (
              <>
                {outW} × {outH} · {frameCount} frame{frameCount === 1 ? '' : 's'}
                {playSeconds ? ` · ${formatClock(playSeconds, 1)}` : ''}
                {estimate ? ` · about ${formatBytes(estimate)}` : ''}
              </>
            )}
          </span>
          <div className="actions">
            {busy && (
              <button type="button" className="btn" onClick={cancel}>
                Cancel
              </button>
            )}
            <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={encode} disabled={busy || !ready}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <Gif size={16} weight="bold" />}
              {busy ? 'Working…' : 'Make GIF'}
            </button>
          </div>
        </div>
      )}

      {tooHeavy && (
        <p className="notice error gif-notice">
          <WarningCircle size={16} weight="fill" />
          That’s too many frames at this size for your browser to hold in memory. Shorten the clip, or lower the width or frame rate.
        </p>
      )}
      {!busy && !tooHeavy && estimate > BIG_GIF && (
        <p className="notice error gif-notice">
          <WarningCircle size={16} weight="fill" />
          This will probably be over 15 MB, too big for most chats. Lower the width or frame rate, or shorten the clip.
        </p>
      )}
      {source === 'images' && frames.some((f) => f.delay < 20) && (
        <p className="notice error gif-notice">
          <WarningCircle size={16} weight="fill" />
          Each frame needs a delay of at least 20 ms.
        </p>
      )}

      {busy && (
        <div className="gif-progress-wrap" role="status" aria-live="polite">
          <div className="gif-progress-text">
            {status === 'loading' &&
              (loadProgress
                ? `Loading the GIF encoder · ${(loadProgress.loaded / 1048576).toFixed(1)} of ${(loadProgress.total / 1048576).toFixed(1)} MB`
                : 'Loading the GIF encoder (~30 MB, one-time)')}
            {status === 'preparing' && `Preparing frames… ${Math.round(progress * 100)}%`}
            {status === 'running' && `Encoding… ${Math.round(progress * 100)}%`}
          </div>
          <Progress value={status === 'loading' ? (loadProgress ? loadProgress.loaded / loadProgress.total : null) : progress || null} />
        </div>
      )}

      {notice && !busy && <p className="notice gif-notice">{notice}</p>}

      {result && (
        <section className="section" aria-label="Result">
          <div className="section-head">
            <h2>Your GIF</h2>
          </div>
          <div className="panel gif-result">
            <div className="gif-result-frame">
              <img src={result.url} alt="Preview of the GIF" width={result.width} height={result.height} />
            </div>
            <div className="gif-result-row">
              <span className="file-icon pdf" aria-hidden="true">
                <FilmStrip size={20} weight="duotone" />
              </span>
              <div className="row-main">
                <span className="name">{result.name}</span>
                <span className="meta">
                  {formatBytes(result.blob.size)} · {result.width} × {result.height} · {result.frames} frames
                </span>
              </div>
              <button type="button" className="btn primary" onClick={() => downloadBlob(result.blob, result.name)}>
                <DownloadSimple size={16} weight="bold" />
                Download
              </button>
            </div>
            {result.blob.size > BIG_GIF && (
              <p className="notice error gif-inline">
                <WarningCircle size={16} weight="fill" />
                At {formatBytes(result.blob.size)} this is too big for most chats; lower the width or fps.
              </p>
            )}
          </div>
        </section>
      )}

      {source === 'images' && frames.length > 0 && !busy && (
        <p className="gif-hint">
          Frames play top to bottom. Use the arrows to reorder them.
        </p>
      )}

      <footer className="footer">
        Encoded in your browser with ffmpeg.wasm, using a palette built from your clip so colours stay clean. The encoder is a one-time ~30 MB download
        that loads only when you press Make GIF. Short clips at 480 px and 10–12 fps make GIFs that are easy to share.
      </footer>
    </div>
  )
}

function Segmented({ label, value, options, onChange, disabled, help }) {
  const id = `gif-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="gif-field">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button key={String(o.key)} type="button" role="radio" aria-checked={value === o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)} disabled={disabled}>
            {o.label}
          </button>
        ))}
      </div>
      {help && <p className="gif-help">{help}</p>}
    </div>
  )
}

function Progress({ value }) {
  return (
    <div className={`gif-progress${value == null ? ' indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value * 100)}>
      <span style={{ width: value == null ? undefined : `${value * 100}%` }} />
    </div>
  )
}

function TimeField({ label, value, onCommit, onUseCurrent, disabled }) {
  const [draft, setDraft] = useState(null)
  const id = `gif-time-${label.toLowerCase()}`
  const commit = () => {
    if (draft === null) return
    const v = parseClock(draft)
    if (v !== null) onCommit(v)
    setDraft(null)
  }
  return (
    <div className="gif-time">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="gif-inline">
        <input
          id={id}
          className="input gif-num gif-clock"
          inputMode="decimal"
          value={draft ?? formatClock(value, 1)}
          disabled={disabled}
          aria-describedby="gif-time-help"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              setDraft(null)
              onCommit(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1))
            } else if (e.key === 'Escape') setDraft(null)
          }}
        />
        <button type="button" className="btn small ghost" onClick={onUseCurrent} disabled={disabled} title={`Set ${label.toLowerCase()} to the player’s current time`}>
          Use current time
        </button>
      </div>
      <span id="gif-time-help" className="sr-only">
        Minutes and seconds. Arrow keys nudge by a tenth of a second, with Shift by one second.
      </span>
    </div>
  )
}

// A track with two handles. Drag a handle, or use arrow keys when it's focused.
function TrimTrack({ duration, start, end, onChange, disabled }) {
  const track = useRef(null)
  const drag = useRef(null)
  const pct = (t) => (duration ? (t / duration) * 100 : 0)
  const timeAt = (clientX) => {
    const r = track.current.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1) * duration
  }
  const onDown = (e) => {
    if (disabled || !duration) return
    const t = timeAt(e.clientX)
    const which = e.target.dataset.handle || (Math.abs(t - start) < Math.abs(t - end) ? 'start' : 'end')
    drag.current = which
    track.current.setPointerCapture(e.pointerId)
    onChange(which, t)
    e.preventDefault()
    track.current.querySelector(`[data-handle="${which}"]`)?.focus()
  }
  const onMove = (e) => drag.current && onChange(drag.current, timeAt(e.clientX))
  const onUp = () => (drag.current = null)
  const key = (which, value) => (e) => {
    const step = e.shiftKey ? 1 : 0.1
    const map = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -5, PageUp: 5 }
    if (e.key in map) onChange(which, value + map[e.key])
    else if (e.key === 'Home') onChange(which, 0)
    else if (e.key === 'End') onChange(which, duration)
    else return
    e.preventDefault()
  }
  return (
    <div className={`gif-track${disabled ? ' disabled' : ''}`} ref={track} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="gif-track-rail" />
      <div className="gif-track-sel" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />
      {[
        ['start', start, 'Clip start'],
        ['end', end, 'Clip end'],
      ].map(([which, value, label]) => (
        <div
          key={which}
          data-handle={which}
          className={`gif-handle ${which}`}
          style={{ left: `${pct(value)}%` }}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={Math.round(value * 10) / 10}
          aria-valuetext={formatClock(value, 1)}
          aria-disabled={disabled || undefined}
          onKeyDown={disabled ? undefined : key(which, value)}
        />
      ))}
    </div>
  )
}
