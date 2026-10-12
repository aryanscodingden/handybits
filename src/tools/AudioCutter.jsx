import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DownloadSimple, FileAudio, MagnifyingGlassMinus, MagnifyingGlassPlus, MusicNotes, Play, Repeat, Scissors, Stop, WarningCircle, X } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import { downloadBlob, formatBytes } from '../lib/format.js'
import { baseName, clamp, formatClock, friendlyError, loadEngine, parseClock } from '../lib/media-utils.js'
import { drawWaveform, scheduleFades } from '../lib/audio-wave.js'
import './AudioCutter.css'

const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.wav,.ogg,.oga,.flac,.opus,.aac,.webm,.mp4,.mov'
const isMedia = (f) => /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|m4r|wav|ogg|oga|flac|opus|aac|webm|mp4|mov|m4v)$/i.test(f.name)
const FORMATS = [
  { key: 'mp3', label: 'MP3' },
  { key: 'm4a', label: 'M4A (AAC)' },
  { key: 'm4r', label: 'iPhone ringtone (M4R)' },
]
const BITRATES = [128, 192, 320]
const RINGTONE_MAX = 40
const ZOOMS = [1, 2, 4, 8, 16, 32]
const MIN_SEL = 0.1
const BIG_FILE = 300 * 1024 * 1024

export default function AudioCutter() {
  const [file, setFile] = useState(null)
  const [buffer, setBuffer] = useState(null)
  const [decoding, setDecoding] = useState(false)
  const [sel, setSel] = useState({ start: 0, end: 0 })
  const [zoom, setZoom] = useState(1)
  const [viewStart, setViewStart] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(null)
  const [loop, setLoop] = useState(false)
  const [fadeIn, setFadeIn] = useState(0)
  const [fadeOut, setFadeOut] = useState(0)
  const [format, setFormat] = useState('mp3')
  const [bitrate, setBitrate] = useState(192)
  const [status, setStatus] = useState('idle') // idle | loading | running | done
  const [loadProgress, setLoadProgress] = useState(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const ctxRef = useRef(null)
  const playRef = useRef(null) // { src, gain, from, at }
  const raf = useRef(0)
  const engine = useRef(null)
  const cancelled = useRef(false)
  const stateRef = useRef({})
  const playFn = useRef(null)

  const duration = buffer?.duration || 0
  const span = duration / zoom
  const view = { start: clamp(viewStart, 0, Math.max(0, duration - span)), end: 0 }
  view.end = view.start + span
  const len = Math.max(0, sel.end - sel.start)
  const fi = Math.min(fadeIn, len)
  const fo = Math.min(fadeOut, Math.max(0, len - fi))
  const busy = status === 'loading' || status === 'running'
  useLayoutEffect(() => {
    stateRef.current = { sel, fi, fo, loop, buffer }
  })

  const getCtx = () => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  const stop = useCallback(() => {
    const p = playRef.current
    playRef.current = null
    if (p) {
      p.src.onended = null
      try {
        p.src.stop()
      } catch {
        // Not started.
      }
      p.src.disconnect()
      p.gain.disconnect()
    }
    cancelAnimationFrame(raf.current)
    setPlaying(false)
  }, [])

  // Free audio on unmount.
  useEffect(
    () => () => {
      stop()
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
      if (engine.current) {
        cancelled.current = true
        engine.current.cancel()
      }
    },
    [stop],
  )
  useEffect(() => () => result && URL.revokeObjectURL(result.url), [result])

  const play = useCallback(
    (from) => {
      const { sel, fi, fo, buffer } = stateRef.current
      if (!buffer) return
      stop()
      const ctx = getCtx()
      ctx.resume().catch(() => {})
      if (!(from >= sel.start && from < sel.end - 0.05)) from = sel.start
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const gain = ctx.createGain()
      src.connect(gain).connect(ctx.destination)
      const at = ctx.currentTime + 0.03
      scheduleFades(gain.gain, at, from, { start: sel.start, end: sel.end, fadeIn: fi, fadeOut: fo })
      src.start(at, from, sel.end - from)
      const p = { src, gain, from, at }
      playRef.current = p
      src.onended = () => {
        if (playRef.current !== p) return
        if (stateRef.current.loop) playFn.current(stateRef.current.sel.start)
        else {
          stop()
          setPlayhead(null)
        }
      }
      setPlaying(true)
      const tick = () => {
        if (playRef.current !== p) return
        setPlayhead(Math.min(sel.end, p.from + Math.max(0, ctx.currentTime - p.at)))
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    },
    [stop],
  )
  useEffect(() => {
    playFn.current = play
  }, [play])

  const pick = useCallback(
    async (files) => {
      const f = files.find(isMedia)
      if (!f) {
        setError('That doesn’t look like an audio or video file.')
        return
      }
      stop()
      setError(null)
      setNotice(null)
      setResult(null)
      setStatus('idle')
      setBuffer(null)
      setFile(f)
      setDecoding(true)
      try {
        const data = await f.arrayBuffer()
        const buf = await getCtx().decodeAudioData(data)
        setBuffer(buf)
        setSel({ start: 0, end: buf.duration })
        setZoom(1)
        setViewStart(0)
        setPlayhead(null)
      } catch (err) {
        console.error(err)
        setFile(null)
        setError(
          /memory|RangeError/i.test(String(err))
            ? 'This file is too long to load in your browser. Try a shorter one.'
            : 'Couldn’t read any audio from this file. It may be damaged, have no sound, or use a format your browser can’t decode.',
        )
      } finally {
        setDecoding(false)
      }
    },
    [stop],
  )

  function clear() {
    stop()
    setFile(null)
    setBuffer(null)
    setResult(null)
    setNotice(null)
    setError(null)
    setStatus('idle')
    setPlayhead(null)
  }

  const changed = () => {
    setResult(null)
    if (status === 'done') setStatus('idle')
  }

  function updateSel(next) {
    let { start, end } = { ...sel, ...next }
    start = clamp(start, 0, duration)
    end = clamp(end, 0, duration)
    if (end - start < MIN_SEL) {
      if ('start' in next && !('end' in next)) start = Math.max(0, end - MIN_SEL)
      else end = Math.min(duration, start + MIN_SEL)
    }
    setSel({ start, end })
    if (playing) stop()
    changed()
  }

  function zoomTo(level) {
    const z = clamp(level, 1, ZOOMS[ZOOMS.length - 1])
    const center = (sel.start + sel.end) / 2
    setZoom(z)
    setViewStart(Math.max(0, center - duration / z / 2))
  }

  async function exportCut() {
    if (!buffer || busy) return
    stop()
    let { start, end } = sel
    if (format === 'm4r' && end - start > RINGTONE_MAX) {
      end = start + RINGTONE_MAX
      setSel({ start, end })
      setNotice(`Ringtones can be up to ${RINGTONE_MAX} seconds, so the selection was shortened to ${formatClock(start)}–${formatClock(end)}.`)
    } else setNotice(null)
    const dur = end - start
    const fIn = Math.min(fadeIn, dur)
    const fOut = Math.min(fadeOut, Math.max(0, dur - fIn))
    const filters = []
    if (fIn > 0) filters.push(`afade=t=in:st=0:d=${fIn.toFixed(2)}`)
    if (fOut > 0) filters.push(`afade=t=out:st=${(dur - fOut).toFixed(3)}:d=${fOut.toFixed(2)}`)
    const af = filters.length ? ['-af', filters.join(',')] : []
    const base = baseName(file.name)
    const spec = {
      mp3: { ext: 'mp3', type: 'audio/mpeg', codec: ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`] },
      m4a: { ext: 'm4a', type: 'audio/mp4', codec: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] },
      m4r: { ext: 'm4r', type: 'audio/mp4', codec: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'ipod'] },
    }[format]
    cancelled.current = false
    setError(null)
    setResult(null)
    setProgress(0)
    setLoadProgress(null)
    try {
      setStatus('loading')
      const lib = await loadEngine((loaded, total) => setLoadProgress({ loaded, total }))
      engine.current = lib
      if (cancelled.current) return
      setStatus('running')
      const data = await lib.run(file, {
        output: `cut.${spec.ext}`,
        duration: dur,
        onProgress: setProgress,
        build: (i, o) => ['-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', i, '-vn', '-map', '0:a:0', ...af, ...spec.codec, o],
      })
      if (cancelled.current) return
      const blob = new Blob([data], { type: spec.type })
      setResult({ blob, url: URL.createObjectURL(blob), name: `${base}-cut.${spec.ext}`, format, duration: dur })
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
    setNotice('Cancelled.')
  }

  return (
    <div className="tool ac">
      <header className="header">
        <h1 className="title">Audio cutter</h1>
        <p className="lede">Trim a song, voice note or video soundtrack, add a fade, and save it as MP3, M4A or an iPhone ringtone. Your file never leaves your browser.</p>
      </header>

      {!file ? (
        <DropZone
          onFiles={pick}
          accept={ACCEPT}
          multiple={false}
          title="Drop an audio file here or click to browse"
          sub="MP3, M4A, WAV, OGG, FLAC or Opus. Videos work too; their soundtrack is used."
          button="Choose a file"
        />
      ) : (
        <ul className="rows">
          <li className="row ac-row">
            <span className="file-icon" aria-hidden="true">
              <FileAudio size={20} weight="duotone" />
            </span>
            <div className="row-main">
              <span className="name">{file.name}</span>
              <span className="meta">
                {formatBytes(file.size)}
                {buffer ? ` · ${formatClock(buffer.duration, 1)} · ${buffer.numberOfChannels === 1 ? 'mono' : 'stereo'}` : decoding ? ' · reading audio…' : ''}
              </span>
            </div>
            <div className="row-actions">
              <button type="button" className="icon" aria-label={`Remove ${file.name}`} title="Remove" onClick={clear} disabled={busy}>
                <X size={16} />
              </button>
            </div>
          </li>
        </ul>
      )}

      {file && file.size > BIG_FILE && !buffer && decoding && <p className="ac-help ac-gap">This is a large file, so reading it may take a moment.</p>}

      {error && (
        <p className="notice error ac-notice" role="alert">
          <WarningCircle size={16} weight="fill" />
          {error}
        </p>
      )}

      {file && !buffer && decoding && <div className="ac-wave-skeleton skeleton" aria-label="Reading audio" />}

      {buffer && (
        <section className="panel ac-editor" aria-label="Selection">
          <Waveform buffer={buffer} view={view} sel={sel} playhead={playhead} onSel={updateSel} onSeek={(t) => (playing ? play(t) : setPlayhead(t))} disabled={busy} />
          {zoom > 1 && (
            <input
              className="ac-scroll"
              type="range"
              min="0"
              max={Math.max(0, duration - span)}
              step={span / 200}
              value={view.start}
              onChange={(e) => setViewStart(Number(e.target.value))}
              aria-label="Scroll the waveform"
              aria-valuetext={`Showing ${formatClock(view.start)} to ${formatClock(view.end)}`}
            />
          )}
          <div className="ac-toolbar">
            <div className="ac-transport">
              <button type="button" className="btn primary ac-play" onClick={() => (playing ? stop() : play(playhead ?? sel.start))} disabled={busy}>
                {playing ? <Stop size={15} weight="fill" /> : <Play size={15} weight="fill" />}
                {playing ? 'Stop' : 'Play selection'}
              </button>
              <button type="button" className={`btn small ac-loop${loop ? ' on' : ''}`} aria-pressed={loop} onClick={() => setLoop((l) => !l)}>
                <Repeat size={15} weight={loop ? 'bold' : 'regular'} />
                Loop
              </button>
            </div>
            <div className="ac-zoom" role="group" aria-label="Zoom">
              <button type="button" className="icon" aria-label="Zoom out" title="Zoom out" onClick={() => zoomTo(zoom / 2)} disabled={zoom <= 1}>
                <MagnifyingGlassMinus size={17} />
              </button>
              <span className="ac-zoom-level" aria-live="polite">
                {zoom}×
              </span>
              <button type="button" className="icon" aria-label="Zoom in on the selection" title="Zoom in" onClick={() => zoomTo(zoom * 2)} disabled={zoom >= ZOOMS[ZOOMS.length - 1] || duration / zoom < 1}>
                <MagnifyingGlassPlus size={17} />
              </button>
            </div>
          </div>
          <div className="ac-times">
            <ClockField label="Start" value={sel.start} onCommit={(v) => updateSel({ start: v })} disabled={busy} />
            <ClockField label="End" value={sel.end} onCommit={(v) => updateSel({ end: v })} disabled={busy} />
            <div className="ac-time">
              <span className="field-label">Length</span>
              <span className={`ac-len${format === 'm4r' && len > RINGTONE_MAX ? ' over' : ''}`}>{formatClock(len, 1)}</span>
            </div>
          </div>
          <div className="ac-fades">
            <FadeSlider label="Fade in" value={fadeIn} onChange={(v) => (setFadeIn(v), changed())} disabled={busy} />
            <FadeSlider label="Fade out" value={fadeOut} onChange={(v) => (setFadeOut(v), changed())} disabled={busy} />
          </div>
          <p className="ac-help">Drag on the waveform to select, or drag the handles. Arrow keys nudge a focused handle by 0.1 s (Shift for 1 s). Fades play back as you’ll hear them.</p>
        </section>
      )}

      {buffer && (
        <section className="ac-options" aria-label="Export">
          <div className="ac-field">
            <span className="field-label" id="ac-format">
              Save as
            </span>
            <div className="segmented ac-seg" role="radiogroup" aria-labelledby="ac-format">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={format === f.key}
                  className={format === f.key ? 'on' : ''}
                  onClick={() => {
                    setFormat(f.key)
                    setNotice(null)
                    changed()
                  }}
                  disabled={busy}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {format === 'mp3' && (
            <div className="ac-field">
              <span className="field-label" id="ac-bitrate">
                Quality
              </span>
              <div className="segmented ac-seg" role="radiogroup" aria-labelledby="ac-bitrate">
                {BITRATES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={bitrate === b}
                    className={bitrate === b ? 'on' : ''}
                    onClick={() => (setBitrate(b), changed())}
                    disabled={busy}
                  >
                    {b} kbps
                  </button>
                ))}
              </div>
            </div>
          )}
          {format === 'm4r' && (
            <p className="ac-help ac-ring">
              {len > RINGTONE_MAX ? `Ringtones can be up to ${RINGTONE_MAX} seconds, so only the first ${RINGTONE_MAX} seconds of your selection will be saved. ` : ''}
              To add it, connect your iPhone to a Mac, open it in Finder and drag the .m4r onto it, or on the phone import it into GarageBand and share it as a
              ringtone.
            </p>
          )}
        </section>
      )}

      {buffer && (
        <div className="controls">
          <span className="meta">
            {formatClock(sel.start)} – {formatClock(format === 'm4r' ? Math.min(sel.end, sel.start + RINGTONE_MAX) : sel.end)}
          </span>
          <div className="actions">
            {busy && (
              <button type="button" className="btn" onClick={cancel}>
                Cancel
              </button>
            )}
            <button type="button" className={`btn primary${busy ? ' loading' : ''}`} onClick={exportCut} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <Scissors size={16} weight="bold" />}
              {busy ? 'Working…' : format === 'm4r' ? 'Make ringtone' : `Cut ${format.toUpperCase()}`}
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="ac-progress-wrap" role="status" aria-live="polite">
          <div className="ac-progress-text">
            {status === 'loading'
              ? loadProgress
                ? `Loading the audio encoder · ${(loadProgress.loaded / 1048576).toFixed(1)} of ${(loadProgress.total / 1048576).toFixed(1)} MB`
                : 'Loading the audio encoder (~30 MB, one-time)'
              : `Encoding… ${Math.round(progress * 100)}%`}
          </div>
          {(() => {
            const v = status === 'loading' ? (loadProgress ? loadProgress.loaded / loadProgress.total : null) : progress || null
            return (
              <div className={`ac-progress${v == null ? ' indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v == null ? undefined : Math.round(v * 100)}>
                <span style={{ width: v == null ? undefined : `${v * 100}%` }} />
              </div>
            )
          })()}
        </div>
      )}

      {notice && !busy && (
        <p className="notice ac-notice">
          <WarningCircle size={16} weight="fill" />
          {notice}
        </p>
      )}

      {result && (
        <section className="section" aria-label="Result">
          <div className="section-head">
            <h2>Result</h2>
          </div>
          <div className="panel ac-result">
            <audio className="ac-audio" src={result.url} controls preload="metadata" />
            <div className="ac-result-row">
              <span className="file-icon pdf" aria-hidden="true">
                <MusicNotes size={20} weight="duotone" />
              </span>
              <div className="row-main">
                <span className="name">{result.name}</span>
                <span className="meta">
                  {formatBytes(result.blob.size)} · {formatClock(result.duration, 1)}
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
        Audio is decoded and played by your browser, and the cut is encoded with ffmpeg.wasm, a one-time ~30 MB download that loads when you export.
        Nothing is uploaded or remembered.
      </footer>
    </div>
  )
}

function FadeSlider({ label, value, onChange, disabled }) {
  const id = `ac-${label.toLowerCase().replace(' ', '-')}`
  return (
    <div className="ac-fade">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="ac-range" type="range" min="0" max="5" step="0.1" value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} aria-valuetext={value ? `${value} seconds` : 'Off'} />
      <span className="ac-fade-value">{value ? `${value.toFixed(1)} s` : 'Off'}</span>
    </div>
  )
}

function ClockField({ label, value, onCommit, disabled }) {
  const [draft, setDraft] = useState(null)
  const id = `ac-time-${label.toLowerCase()}`
  const commit = () => {
    if (draft === null) return
    const v = parseClock(draft)
    if (v !== null) onCommit(v)
    setDraft(null)
  }
  return (
    <div className="ac-time">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input ac-clock"
        inputMode="decimal"
        value={draft ?? formatClock(value, 1)}
        disabled={disabled}
        aria-describedby="ac-time-help"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setDraft(null)
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            setDraft(null)
            onCommit(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1))
          }
        }}
      />
      <span id="ac-time-help" className="sr-only">
        Minutes and seconds, like 1:23.4. Up and down arrows nudge by a tenth of a second, with Shift by one second.
      </span>
    </div>
  )
}

function Waveform({ buffer, view, sel, playhead, onSel, onSeek, disabled }) {
  const wrap = useRef(null)
  const canvas = useRef(null)
  const drag = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 })

  useLayoutEffect(() => {
    const el = wrap.current
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight, dpr: window.devicePixelRatio || 1 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Moving the window between screens changes the pixel ratio.
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    mq.addEventListener?.('change', measure)
    return () => {
      ro.disconnect()
      mq.removeEventListener?.('change', measure)
    }
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c || !size.w) return
    c.width = Math.round(size.w * size.dpr)
    c.height = Math.round(size.h * size.dpr)
    const color = getComputedStyle(c).getPropertyValue('--ac-wave').trim() || '#b5532f'
    drawWaveform(c, buffer, view.start, view.end, color)
  }, [buffer, view.start, view.end, size])

  const span = view.end - view.start || 1
  const x = (t) => ((t - view.start) / span) * 100
  const timeAt = (clientX) => {
    const r = wrap.current.getBoundingClientRect()
    return view.start + clamp((clientX - r.left) / r.width, 0, 1) * span
  }

  const onDown = (e) => {
    if (disabled || e.button > 0) return
    const r = wrap.current.getBoundingClientRect()
    const px = e.clientX - r.left
    const startPx = ((sel.start - view.start) / span) * r.width
    const endPx = ((sel.end - view.start) / span) * r.width
    const t = timeAt(e.clientX)
    let mode
    if (e.target.dataset.handle) mode = e.target.dataset.handle
    else if (Math.abs(px - startPx) < 10) mode = 'start'
    else if (Math.abs(px - endPx) < 10) mode = 'end'
    else mode = 'new'
    drag.current = { mode, anchor: t, x0: e.clientX, moved: false }
    wrap.current.setPointerCapture(e.pointerId)
    if (mode !== 'new') e.currentTarget.querySelector(`[data-handle="${mode}"]`)?.focus()
    e.preventDefault()
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true
    if (!d.moved) return
    const t = timeAt(e.clientX)
    if (d.mode === 'start') onSel({ start: Math.min(t, sel.end - 0.1) })
    else if (d.mode === 'end') onSel({ end: Math.max(t, sel.start + 0.1) })
    else onSel({ start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) })
  }
  const onUp = (e) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved && d.mode === 'new') onSeek(timeAt(e.clientX))
  }

  const handleKey = (which) => (e) => {
    const step = e.altKey ? 0.01 : e.shiftKey ? 1 : 0.1
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -5, PageUp: 5 }[e.key]
    if (delta === undefined) return
    e.preventDefault()
    onSel({ [which]: sel[which] + delta })
  }

  return (
    <div className={`ac-wave${disabled ? ' disabled' : ''}`} ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)}>
      <canvas ref={canvas} className="ac-canvas" aria-hidden="true" />
      <div className="ac-shade" style={{ left: 0, width: `${clamp(x(sel.start), 0, 100)}%` }} />
      <div className="ac-shade" style={{ left: `${clamp(x(sel.end), 0, 100)}%`, right: 0 }} />
      <div className="ac-sel" style={{ left: `${clamp(x(sel.start), 0, 100)}%`, width: `${clamp(x(sel.end), 0, 100) - clamp(x(sel.start), 0, 100)}%` }} />
      {playhead !== null && playhead >= view.start && playhead <= view.end && <div className="ac-playhead" style={{ left: `${x(playhead)}%` }} />}
      {['start', 'end'].map((which) => {
        const t = sel[which]
        const visible = t >= view.start && t <= view.end
        return (
          <div
            key={which}
            data-handle={which}
            className={`ac-handle ${which}${visible ? '' : ' off'}`}
            style={{ left: `${clamp(x(t), 0, 100)}%` }}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={which === 'start' ? 'Selection start' : 'Selection end'}
            aria-valuemin={0}
            aria-valuemax={Math.round(buffer.duration * 10) / 10}
            aria-valuenow={Math.round(t * 100) / 100}
            aria-valuetext={formatClock(t, 2)}
            onKeyDown={disabled ? undefined : handleKey(which)}
          />
        )
      })}
    </div>
  )
}
