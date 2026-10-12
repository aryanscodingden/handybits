import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, ArrowRight, DownloadSimple, FilmSlate, Info, Microphone, Monitor, Pause, Play, Record, SpeakerHigh, Stop, WarningCircle, Webcam } from '@phosphor-icons/react'
import { downloadBlob, formatBytes } from '../lib/format.js'
import { formatClock, mediaErrorKind, stampName, stopStreams } from '../lib/media-utils.js'
import { extensionFor, fixInfiniteDuration, pickVideoMime, startCompositor } from '../lib/media-record.js'
import './ScreenRecorder.css'

const QUALITIES = {
  720: { w: 1280, h: 720, bps: 5_000_000, label: '720p' },
  1080: { w: 1920, h: 1080, bps: 8_000_000, label: '1080p' },
}
const CORNERS = [
  { key: 'tl', label: 'Top left' },
  { key: 'tr', label: 'Top right' },
  { key: 'bl', label: 'Bottom left' },
  { key: 'br', label: 'Bottom right' },
]
const SIZES = [
  { key: 0.2, label: 'Small' },
  { key: 0.28, label: 'Medium' },
  { key: 0.36, label: 'Large' },
]
const FPS = 30

const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'
// Tab and system audio capture is a Chromium feature.
const canShareAudio = typeof window !== 'undefined' && !!window.chrome

export default function ScreenRecorder() {
  if (!supported) {
    return (
      <div className="tool rec">
        <Header />
        <div className="notice error rec-unsupported" role="status">
          <Monitor size={16} weight="fill" />
          <span>Screen recording works in desktop browsers like Chrome, Edge, Firefox and Safari. This browser can’t share its screen with web pages.</span>
        </div>
        <Footer />
      </div>
    )
  }
  return <Recorder />
}

function Header() {
  return (
    <header className="header">
      <h1 className="title">Screen recorder</h1>
      <p className="lede">Record a tab, a window or your whole screen, with your voice and an optional webcam bubble. The video is made in your browser and never uploaded.</p>
    </header>
  )
}

function Footer() {
  return (
    <footer className="footer">
      Recorded with your browser’s built-in MediaRecorder. Nothing is uploaded, and the recording is gone when you leave this page unless you download it.
    </footer>
  )
}

function Recorder() {
  const [mic, setMic] = useState(true)
  const [micId, setMicId] = useState('')
  const [sysAudio, setSysAudio] = useState(canShareAudio)
  const [cam, setCam] = useState(false)
  const [camId, setCamId] = useState('')
  const [corner, setCorner] = useState('br')
  const [bubble, setBubble] = useState(0.28)
  const [quality, setQuality] = useState(1080)
  const [devices, setDevices] = useState({ mics: [], cams: [] })
  const [camStream, setCamStream] = useState(null)
  const [phase, setPhase] = useState('setup') // setup | starting | countdown | recording | paused | done
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const live = useRef({}) // { display, micStream, ctx, stopDraw, recorder, chunks, mime }
  const clock = useRef({ started: 0, pausedAt: 0, pausedTotal: 0 })
  const camPreview = useRef(null)
  const camStreamRef = useRef(null)
  useEffect(() => {
    camStreamRef.current = camStream
  }, [camStream])
  const resultVideo = useRef(null)

  const active = phase === 'countdown' || phase === 'recording' || phase === 'paused'

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        mics: list.filter((d) => d.kind === 'audioinput' && d.deviceId),
        cams: list.filter((d) => d.kind === 'videoinput' && d.deviceId),
      })
    } catch {
      // Device list is a nicety; defaults still work.
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(refreshDevices, 0)
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices)
    return () => {
      clearTimeout(id)
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices)
    }
  }, [refreshDevices])

  // Everything off when leaving the tool.
  const teardown = useCallback(() => {
    const l = live.current
    l.stopDraw?.()
    if (l.recorder && l.recorder.state !== 'inactive') {
      l.recorder.onstop = null
      try {
        l.recorder.stop()
      } catch {
        // Already stopped.
      }
    }
    stopStreams(l.display, l.micStream, l.canvasStream, l.mixed)
    l.ctx?.close().catch(() => {})
    clearInterval(l.countTimer)
    live.current = {}
  }, [])

  useEffect(
    () => () => {
      teardown()
      stopStreams(camStreamRef.current)
    },
    [teardown],
  )
  useEffect(() => () => result && URL.revokeObjectURL(result.url), [result])

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (!active) return
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])

  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsed((performance.now() - clock.current.started - clock.current.pausedTotal) / 1000), 250)
    return () => clearInterval(id)
  }, [phase])

  // Webcam preview while the bubble is on (and reused for the recording).
  const camWanted = cam && phase !== 'done'
  useEffect(() => {
    if (!camWanted) return
    let cancelled = false
    let stream = null
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((s) => {
        if (cancelled) return stopStreams(s)
        stream = s
        setCamStream(s)
        setError(null)
        refreshDevices()
      })
      .catch((err) => {
        if (cancelled) return
        setCam(false)
        setError(deviceHelp(err, 'camera'))
      })
    return () => {
      cancelled = true
      stopStreams(stream)
      setCamStream(null)
    }
  }, [camWanted, camId, refreshDevices])

  useEffect(() => {
    if (camPreview.current) camPreview.current.srcObject = camStream
  }, [camStream])

  async function toggleMic(on) {
    setMic(on)
    if (!on || devices.mics.some((d) => d.label)) return
    // Ask now so device names show up and the prompt doesn't interrupt the countdown.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      stopStreams(s)
      refreshDevices()
      setError(null)
    } catch (err) {
      setMic(false)
      setError(deviceHelp(err, 'microphone'))
    }
  }

  async function start() {
    setError(null)
    setNotice(null)
    setResult(null)
    setPhase('starting')
    const q = QUALITIES[quality]
    const l = {}
    live.current = l
    try {
      // Screen first: browsers only allow the picker straight after a click.
      try {
        l.display = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: FPS, max: FPS } },
          audio: sysAudio && canShareAudio ? { suppressLocalAudioPlayback: false } : false,
          ...(sysAudio && canShareAudio ? { systemAudio: 'include' } : {}),
          surfaceSwitching: 'include',
          selfBrowserSurface: 'exclude',
        })
      } catch (err) {
        live.current = {}
        setPhase('setup')
        if (mediaErrorKind(err) === 'denied') setNotice('Screen sharing was cancelled, so nothing was recorded.')
        else setError('The browser couldn’t start screen sharing. Check that screen recording is allowed for your browser in your system settings.')
        return
      }
      if (live.current !== l) return stopStreams(l.display)
      if (mic) {
        try {
          l.micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
        } catch (err) {
          setNotice(`${deviceHelp(err, 'microphone')} Recording without your microphone.`)
        }
      }
      if (live.current !== l) return teardown()

      const screenTrack = l.display.getVideoTracks()[0]
      screenTrack.addEventListener('ended', () => {
        if (live.current === l) finish()
      })
      try {
        screenTrack.contentHint = 'detail'
      } catch {
        // Not supported everywhere.
      }

      // Video: straight from the screen, or composed with the webcam bubble.
      let videoTrack = screenTrack
      const camNow = cam ? camStreamRef.current : null
      if (camNow) {
        const s = screenTrack.getSettings()
        const sw = s.width || q.w
        const sh = s.height || q.h
        const scale = Math.min(1, q.w / sw, q.h / sh)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round((sw * scale) / 2) * 2
        canvas.height = Math.round((sh * scale) / 2) * 2
        const screen = makeVideo(new MediaStream([screenTrack]))
        const camera = makeVideo(camNow)
        await Promise.all([screen.play().catch(() => {}), camera.play().catch(() => {})])
        l.stopDraw = startCompositor({ canvas, screen, camera, corner, size: bubble, fps: FPS })
        l.canvasStream = canvas.captureStream(FPS)
        videoTrack = l.canvasStream.getVideoTracks()[0]
      }

      // Audio: mix screen audio and the mic into one track.
      const audioSources = [l.display, l.micStream].filter((s) => s?.getAudioTracks().length)
      let audioTrack = null
      if (audioSources.length) {
        l.ctx = new AudioContext()
        const dest = l.ctx.createMediaStreamDestination()
        for (const s of audioSources) l.ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest)
        l.mixed = dest.stream
        audioTrack = dest.stream.getAudioTracks()[0]
      }
      if (sysAudio && canShareAudio && !l.display.getAudioTracks().length) {
        setNotice((n) => n || 'No tab or system audio was shared. To include it, tick “Share audio” in the browser’s picker next time.')
      }

      const mime = pickVideoMime()
      l.mime = mime || 'video/webm'
      l.chunks = []
      const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack])
      l.recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: q.bps, audioBitsPerSecond: 128_000 })
      l.recorder.ondataavailable = (e) => e.data.size && l.chunks.push(e.data)
      l.recorder.onstop = () => done(l)

      // 3-2-1, then go.
      setCount(3)
      setPhase('countdown')
      let n = 3
      await new Promise((resolve) => {
        l.countTimer = setInterval(() => {
          n--
          if (n <= 0 || live.current !== l) {
            clearInterval(l.countTimer)
            resolve()
          } else setCount(n)
        }, 1000)
      })
      if (live.current !== l) return
      if (screenTrack.readyState === 'ended') return finish()
      l.recorder.start(1000)
      clock.current = { started: performance.now(), pausedAt: 0, pausedTotal: 0, stoppedAt: 0 }
      setElapsed(0)
      setPhase('recording')
    } catch (err) {
      console.error(err)
      teardown()
      setPhase('setup')
      setError('Recording couldn’t start in this browser. Try turning off the webcam bubble or choosing 720p.')
    }
  }

  function cancelCountdown() {
    teardown()
    setPhase('setup')
    setNotice('Cancelled before recording started.')
  }

  function pause() {
    const r = live.current.recorder
    if (!r || r.state !== 'recording') return
    r.pause()
    clock.current.pausedAt = performance.now()
    setPhase('paused')
  }

  function resume() {
    const r = live.current.recorder
    if (!r || r.state !== 'paused') return
    r.resume()
    clock.current.pausedTotal += performance.now() - clock.current.pausedAt
    setPhase('recording')
  }

  function finish() {
    const l = live.current
    if (!l.recorder) return
    if (l.recorder.state === 'paused') clock.current.pausedTotal += performance.now() - clock.current.pausedAt
    if (l.recorder.state === 'inactive') {
      // Ended during the countdown: nothing recorded yet.
      teardown()
      setPhase('setup')
      setNotice('Screen sharing stopped before recording started.')
      return
    }
    clock.current.stoppedAt = performance.now()
    setElapsed((clock.current.stoppedAt - clock.current.started - clock.current.pausedTotal) / 1000)
    l.recorder.stop()
  }

  function done(l) {
    const duration = ((clock.current.stoppedAt || performance.now()) - clock.current.started - clock.current.pausedTotal) / 1000
    const type = l.mime.split(';')[0]
    const blob = new Blob(l.chunks, { type })
    const ext = extensionFor(type)
    l.recorder.onstop = null
    teardown()
    if (!blob.size) {
      setPhase('setup')
      setError('The recording came out empty. Try again, or choose a different window or tab.')
      return
    }
    setResult({ blob, url: URL.createObjectURL(blob), ext, name: `${stampName('recording')}.${ext}`, duration })
    setPhase('done')
  }

  function again() {
    setResult(null)
    setNotice(null)
    setError(null)
    setPhase('setup')
  }

  const q = QUALITIES[quality]

  return (
    <div className="tool rec">
      <Header />

      {error && (
        <p className="notice error rec-notice" role="alert">
          <WarningCircle size={16} weight="fill" />
          {error}
        </p>
      )}
      {notice && (
        <p className="notice rec-notice rec-info" role="status">
          <Info size={16} weight="fill" />
          {notice}
        </p>
      )}

      {(phase === 'setup' || phase === 'starting') && (
        <>
          <div className="rec-setup">
            <div className="panel rec-options">
              <div className="rec-option">
                <label className={`check${mic ? ' on' : ''}`}>
                  <input type="checkbox" checked={mic} onChange={(e) => toggleMic(e.target.checked)} />
                  <Microphone size={15} />
                  Microphone
                </label>
                {mic && (
                  <select className="rec-select" value={micId} onChange={(e) => setMicId(e.target.value)} aria-label="Microphone">
                    <option value="">Default microphone</option>
                    {devices.mics
                      .filter((d) => d.deviceId !== 'default' && d.label)
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                  </select>
                )}
              </div>

              <div className="rec-option">
                <label className={`check${sysAudio && canShareAudio ? ' on' : ''}`}>
                  <input type="checkbox" checked={sysAudio && canShareAudio} disabled={!canShareAudio} onChange={(e) => setSysAudio(e.target.checked)} />
                  <SpeakerHigh size={15} />
                  Tab or system audio
                </label>
                <p className="rec-help">
                  {canShareAudio
                    ? 'Tick “Share audio” in the picker. Tabs work everywhere; whole-screen audio works on Windows and ChromeOS.'
                    : 'Only Chrome and Edge can record tab or system audio.'}
                </p>
              </div>

              <div className="rec-option">
                <label className={`check${cam ? ' on' : ''}`}>
                  <input type="checkbox" checked={cam} onChange={(e) => setCam(e.target.checked)} />
                  <Webcam size={15} />
                  Webcam bubble
                </label>
                {cam && devices.cams.filter((d) => d.label).length > 1 && (
                  <select className="rec-select" value={camId} onChange={(e) => setCamId(e.target.value)} aria-label="Camera">
                    <option value="">Default camera</option>
                    {devices.cams
                      .filter((d) => d.label)
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                  </select>
                )}
              </div>

              {cam && (
                <div className="rec-option rec-sub">
                  <Seg label="Corner" value={corner} options={CORNERS} onChange={setCorner} />
                  <Seg label="Size" value={bubble} options={SIZES} onChange={setBubble} />
                </div>
              )}

              <div className="rec-option">
                <Seg
                  label="Quality"
                  value={quality}
                  options={Object.entries(QUALITIES).map(([k, v]) => ({ key: Number(k), label: `${v.label} · ${FPS} fps` }))}
                  onChange={setQuality}
                />
              </div>
            </div>

            <div className="rec-stage" aria-hidden="true">
              <div className="rec-screen">
                <span className="rec-screen-label">
                  <Monitor size={18} />
                  Your screen · {q.label}
                </span>
                {cam && (
                  <div className={`rec-bubble ${corner}`} style={{ '--size': bubble }}>
                    {camStream ? <video ref={camPreview} autoPlay muted playsInline /> : <Webcam size={20} />}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="controls">
            <span className="meta">You’ll choose a tab, window or screen next.</span>
            <div className="actions">
              <button type="button" className={`btn primary rec-start${phase === 'starting' ? ' loading' : ''}`} onClick={start} disabled={phase === 'starting'}>
                {phase === 'starting' ? <span className="spinner" aria-hidden="true" /> : <Record size={16} weight="fill" />}
                {phase === 'starting' ? 'Waiting for you to choose…' : 'Start recording'}
              </button>
            </div>
          </div>
        </>
      )}

      {phase === 'countdown' && (
        <div className="rec-countdown" role="alertdialog" aria-modal="true" aria-label="Recording starts soon">
          <div className="rec-count" key={count} aria-live="assertive">
            {count}
          </div>
          <p>Recording starts in a moment</p>
          <button type="button" className="btn" onClick={cancelCountdown} autoFocus>
            Cancel
          </button>
        </div>
      )}

      {(phase === 'recording' || phase === 'paused') && (
        <div className="panel rec-bar" role="region" aria-label="Recording controls">
          <span className={`rec-dot${phase === 'paused' ? ' paused' : ''}`} aria-hidden="true" />
          <div className="rec-bar-main">
            <span className="rec-time" role="timer" aria-live="off">
              {formatClock(elapsed, 0)}
            </span>
            <span className="rec-state">{phase === 'paused' ? 'Paused' : 'Recording'}</span>
          </div>
          <div className="rec-bar-actions">
            {phase === 'recording' ? (
              <button type="button" className="btn" onClick={pause}>
                <Pause size={16} weight="fill" />
                Pause
              </button>
            ) : (
              <button type="button" className="btn" onClick={resume}>
                <Play size={16} weight="fill" />
                Resume
              </button>
            )}
            <button type="button" className="btn primary" onClick={finish}>
              <Stop size={16} weight="fill" />
              Stop
            </button>
          </div>
        </div>
      )}
      {(phase === 'recording' || phase === 'paused') && (
        <p className="rec-help rec-tip">Switch to whatever you want to record. Come back here, or use the browser’s “Stop sharing” button, when you’re done.</p>
      )}

      {phase === 'done' && result && (
        <section className="section rec-result-wrap" aria-label="Recording">
          <div className="section-head">
            <h2>Your recording</h2>
          </div>
          <div className="panel rec-result">
            <video ref={resultVideo} className="rec-preview" src={result.url} controls playsInline preload="metadata" onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)} />
            <div className="rec-result-row">
              <span className="file-icon pdf" aria-hidden="true">
                <FilmSlate size={20} weight="duotone" />
              </span>
              <div className="row-main">
                <span className="name">{result.name}</span>
                <span className="meta">
                  {formatClock(Math.floor(result.duration), 0)} · {formatBytes(result.blob.size)} · {result.ext.toUpperCase()}
                </span>
              </div>
              <div className="rec-result-actions">
                <button type="button" className="btn" onClick={again}>
                  <ArrowCounterClockwise size={16} />
                  Record again
                </button>
                <button type="button" className="btn primary" onClick={() => downloadBlob(result.blob, result.name)}>
                  <DownloadSimple size={16} weight="bold" />
                  Download
                </button>
              </div>
            </div>
            {result.ext === 'webm' && (
              <div className="rec-convert">
                <p className="rec-help">This browser records WebM, which some apps and phones won’t open. Download it, then convert it to MP4 with the video tool.</p>
                <a className="btn small" href="#/video">
                  Convert to MP4
                  <ArrowRight size={14} />
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      <Footer />
    </div>
  )
}

function makeVideo(stream) {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.srcObject = stream
  return v
}

function deviceHelp(err, what) {
  const kind = mediaErrorKind(err)
  if (kind === 'denied')
    return `Your browser blocked the ${what}. Allow it from the icon at the left of the address bar, and check your system privacy settings (macOS: System Settings › Privacy & Security; Windows: Settings › Privacy).`
  if (kind === 'missing') return `No ${what} was found. Check that it’s plugged in and not turned off.`
  if (kind === 'busy') return `The ${what} is in use by another app or couldn’t be started. Close other apps that might be using it and try again.`
  return `The ${what} couldn’t be started.`
}

function Seg({ label, value, options, onChange }) {
  const id = `rec-${label.toLowerCase()}`
  return (
    <div className={`rec-seg ${id}`}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={value === o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
