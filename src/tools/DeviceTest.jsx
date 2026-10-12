import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Camera, DownloadSimple, FlipHorizontal, Microphone, Record, ShieldCheck, SpeakerHigh, Stop, VideoCamera, WarningCircle } from '@phosphor-icons/react'
import { downloadBlob } from '../lib/format.js'
import { mediaErrorKind, stampName, stopStreams } from '../lib/media-utils.js'
import { pickAudioMime } from '../lib/media-record.js'
import './DeviceTest.css'

const hasMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export default function DeviceTest() {
  return (
    <div className="tool dt">
      <header className="header">
        <h1 className="title">Webcam & mic test</h1>
        <p className="lede">Check your camera, microphone and speakers before a call. Each one starts only when you press its button.</p>
      </header>

      <p className="dt-privacy">
        <ShieldCheck size={16} weight="fill" aria-hidden="true" />
        Nothing is recorded or sent anywhere unless you press record, and recordings stay on this device.
      </p>

      {!hasMedia && (
        <p className="notice error dt-gap" role="status">
          <WarningCircle size={16} weight="fill" />
          This browser doesn’t allow web pages to use the camera or microphone. Camera and mic access also needs a secure (https) connection.
        </p>
      )}

      {hasMedia && <CameraPanel />}
      {hasMedia && <MicPanel />}
      <SpeakerPanel />

      <footer className="footer">
        Everything here runs in your browser. Your camera and microphone switch off as soon as you press Stop or leave this page.
      </footer>
    </div>
  )
}

function useDevices(kind) {
  const [list, setList] = useState([])
  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setList(all.filter((d) => d.kind === kind && d.deviceId && d.label))
    } catch {
      setList([])
    }
  }, [kind])
  useEffect(() => {
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
  }, [refresh])
  return [list, refresh]
}

function PermissionHelp({ error, what }) {
  if (!error) return null
  const Icon = what === 'camera' ? VideoCamera : Microphone
  const pane = what === 'camera' ? 'Camera' : 'Microphone'
  let body
  if (error === 'denied')
    body = (
      <>
        <strong>Your browser blocked the {what}.</strong> Click the {what} or settings icon at the left of the address bar, choose Allow, then press Start
        again. Still blocked? Check your system settings: on macOS, System Settings › Privacy & Security › {pane}; on Windows, Settings › Privacy & security ›{' '}
        {pane}. Make sure your browser is switched on there.
      </>
    )
  else if (error === 'missing')
    body = (
      <>
        <strong>No {what} found.</strong> Check it’s plugged in and switched on, then try again. Laptop {what}s can be turned off by a key or a privacy
        shutter.
      </>
    )
  else if (error === 'busy')
    body = (
      <>
        <strong>The {what} is busy.</strong> Another app (Zoom, Teams, FaceTime or another tab) may be using it. Close it and try again.
      </>
    )
  else body = <strong>The {what} couldn’t be started. Try again, or pick another device.</strong>
  return (
    <div className="notice error dt-help" role="alert">
      <Icon size={16} weight="fill" />
      <span>{body}</span>
    </div>
  )
}

function PanelHead({ icon: Icon, title, live, status = true, children }) {
  return (
    <div className="dt-head">
      <span className={`dt-icon${live ? ' live' : ''}`} aria-hidden="true">
        <Icon size={18} weight="duotone" />
      </span>
      <h2>{title}</h2>
      {status && <span className={`status${live ? ' ready' : ''}`}>{live ? 'On' : 'Off'}</span>}
      <div className="dt-head-actions">{children}</div>
    </div>
  )
}

/* Camera */

function CameraPanel() {
  const [stream, setStream] = useState(null)
  const [starting, setStarting] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const [mirror, setMirror] = useState(true)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [devices, refresh] = useDevices('videoinput')
  const video = useRef(null)
  const streamRef = useRef(null)
  useEffect(() => {
    streamRef.current = stream
  }, [stream])

  useEffect(() => () => stopStreams(streamRef.current), [])

  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])

  async function start(id = deviceId) {
    setStarting(true)
    setError(null)
    stopStreams(streamRef.current)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false,
      })
      const track = s.getVideoTracks()[0]
      track.addEventListener('ended', () => setStream((cur) => (cur === s ? null : cur)))
      setStream(s)
      const st = track.getSettings()
      setInfo({ width: st.width, height: st.height, fps: st.frameRate, label: track.label, facing: st.facingMode })
      if (!id && st.deviceId) setDeviceId(st.deviceId)
      refresh()
    } catch (err) {
      setStream(null)
      setError(mediaErrorKind(err))
    } finally {
      setStarting(false)
    }
  }

  function stop() {
    stopStreams(stream)
    setStream(null)
    setInfo(null)
  }

  function snapshot() {
    const v = video.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (mirror) {
      ctx.translate(c.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(v, 0, 0)
    c.toBlob((b) => b && downloadBlob(b, `${stampName('snapshot')}.png`), 'image/png')
  }

  // The real size can differ from what the track reports at first.
  const onMeta = () => {
    const v = video.current
    if (v?.videoWidth) setInfo((i) => (i ? { ...i, width: v.videoWidth, height: v.videoHeight } : i))
  }

  return (
    <section className="panel dt-panel" aria-labelledby="dt-camera">
      <PanelHead icon={VideoCamera} title={<span id="dt-camera">Camera</span>} live={!!stream}>
        {stream ? (
          <button type="button" className="btn small" onClick={stop}>
            <Stop size={14} weight="fill" />
            Stop
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={() => start()} disabled={starting}>
            {starting ? <span className="spinner" aria-hidden="true" /> : <Camera size={14} weight="bold" />}
            {starting ? 'Starting…' : 'Start camera'}
          </button>
        )}
      </PanelHead>

      <PermissionHelp error={error} what="camera" />

      <div className={`dt-video${stream ? ' live' : ''}`}>
        {stream ? (
          <video ref={video} className={mirror ? 'mirror' : ''} autoPlay muted playsInline onLoadedMetadata={onMeta} aria-label="Camera preview" />
        ) : (
          <div className="dt-video-empty">
            <VideoCamera size={28} />
            <span>Camera is off</span>
          </div>
        )}
        {stream && info && (
          <span className="dt-badge">
            {info.width} × {info.height}
            {info.fps ? ` · ${Math.round(info.fps)} fps` : ''}
          </span>
        )}
      </div>

      {stream && (
        <div className="dt-row">
          {devices.length > 0 && (
            <select
              className="dt-select"
              aria-label="Camera"
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value)
                start(e.target.value)
              }}
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <label className={`check${mirror ? ' on' : ''}`}>
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            <FlipHorizontal size={15} />
            Mirror
          </label>
          <button type="button" className="btn small dt-push" onClick={snapshot}>
            <DownloadSimple size={14} weight="bold" />
            Snapshot
          </button>
        </div>
      )}
      {stream && info && (
        <p className="dt-note">
          Your camera is sending {info.width} × {info.height}
          {info.fps ? ` at ${Math.round(info.fps)} frames per second` : ''}. Calls usually send less than this, depending on your connection.
        </p>
      )}
    </section>
  )
}

/* Microphone */

const DB_FLOOR = -60

function MicPanel() {
  const [stream, setStream] = useState(null)
  const [starting, setStarting] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState(null)
  const [quiet, setQuiet] = useState(false)
  const [recording, setRecording] = useState(0) // seconds left, 0 when idle
  const [clip, setClip] = useState(null)
  const [devices, refresh] = useDevices('audioinput')
  const ctxRef = useRef(null)
  const meter = useRef({ raf: 0, level: DB_FLOOR, peak: DB_FLOOR, peakAt: 0, loudAt: 0, startedAt: 0 })
  const bar = useRef(null)
  const peakEl = useRef(null)
  const dbEl = useRef(null)
  const meterEl = useRef(null)
  const recRef = useRef(null)
  const streamRef = useRef(null)
  useEffect(() => {
    streamRef.current = stream
  }, [stream])

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(meter.current.raf)
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
  }, [])

  useEffect(
    () => () => {
      stopMeter()
      if (recRef.current?.state === 'recording') {
        recRef.current.ondataavailable = null
        recRef.current.onstop = null
        recRef.current.stop()
      }
      stopStreams(streamRef.current)
    },
    [stopMeter],
  )
  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip])

  function runMeter(s) {
    stopMeter()
    const ctx = new AudioContext()
    ctxRef.current = ctx
    const source = ctx.createMediaStreamSource(s)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const data = new Float32Array(analyser.fftSize)
    const m = meter.current
    m.level = DB_FLOOR
    m.peak = DB_FLOOR
    m.startedAt = performance.now()
    m.loudAt = 0
    let lastQuiet = false
    let lastText = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      const db = Math.max(DB_FLOOR, 20 * Math.log10(rms || 1e-8))
      const now = performance.now()
      // Fast attack, slow release, so the bar moves smoothly.
      m.level = db > m.level ? m.level + (db - m.level) * 0.6 : m.level + (db - m.level) * 0.12
      // Peak marker holds for a second, then falls.
      if (m.level >= m.peak) {
        m.peak = m.level
        m.peakAt = now
      } else if (now - m.peakAt > 1000) m.peak = Math.max(m.level, m.peak - 0.5)
      if (db > -45) m.loudAt = now
      const pct = ((m.level - DB_FLOOR) / -DB_FLOOR) * 100
      const peakPct = ((m.peak - DB_FLOOR) / -DB_FLOOR) * 100
      if (bar.current) bar.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`
      if (peakEl.current) peakEl.current.style.left = `${peakPct}%`
      if (now - lastText > 120) {
        lastText = now
        if (dbEl.current) dbEl.current.textContent = m.level <= DB_FLOOR + 0.5 ? `< ${DB_FLOOR} dB` : `${Math.round(m.level)} dB`
        meterEl.current?.setAttribute('aria-valuenow', String(Math.round(m.level)))
      }
      const isQuiet = now - m.startedAt > 4000 && now - (m.loudAt || m.startedAt) > 4000
      if (isQuiet !== lastQuiet) {
        lastQuiet = isQuiet
        setQuiet(isQuiet)
      }
      m.raf = requestAnimationFrame(tick)
    }
    m.raf = requestAnimationFrame(tick)
  }

  async function start(id = deviceId) {
    setStarting(true)
    setError(null)
    stopMeter()
    stopStreams(streamRef.current)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true }, video: false })
      const track = s.getAudioTracks()[0]
      track.addEventListener('ended', () => setStream((cur) => (cur === s ? null : cur)))
      setStream(s)
      setQuiet(false)
      const st = track.getSettings()
      if (!id && st.deviceId) setDeviceId(st.deviceId)
      refresh()
      runMeter(s)
    } catch (err) {
      setStream(null)
      setError(mediaErrorKind(err))
    } finally {
      setStarting(false)
    }
  }

  function stop() {
    if (recRef.current?.state === 'recording') recRef.current.stop()
    stopMeter()
    stopStreams(stream)
    setStream(null)
    setQuiet(false)
  }

  function record() {
    if (!stream || recording) return
    const mime = pickAudioMime()
    let rec
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      setError('other')
      return
    }
    const chunks = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      setRecording(0)
      const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] })
      if (blob.size) setClip({ url: URL.createObjectURL(blob), blob })
    }
    recRef.current = rec
    setClip(null)
    rec.start()
    let left = 5
    setRecording(left)
    const id = setInterval(() => {
      left--
      if (left <= 0 || rec.state !== 'recording') {
        clearInterval(id)
        if (rec.state === 'recording') rec.stop()
      } else setRecording(left)
    }, 1000)
  }

  return (
    <section className="panel dt-panel" aria-labelledby="dt-mic">
      <PanelHead icon={Microphone} title={<span id="dt-mic">Microphone</span>} live={!!stream}>
        {stream ? (
          <button type="button" className="btn small" onClick={stop}>
            <Stop size={14} weight="fill" />
            Stop
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={() => start()} disabled={starting}>
            {starting ? <span className="spinner" aria-hidden="true" /> : <Microphone size={14} weight="bold" />}
            {starting ? 'Starting…' : 'Start microphone'}
          </button>
        )}
      </PanelHead>

      <PermissionHelp error={error} what="microphone" />

      <div className={`dt-meter-wrap${stream ? '' : ' off'}`}>
        <div
          ref={meterEl}
          className="dt-meter"
          role="meter"
          aria-label="Microphone level in decibels"
          aria-valuemin={DB_FLOOR}
          aria-valuemax={0}
          aria-valuenow={DB_FLOOR}
        >
          <span ref={bar} className="dt-meter-bar" style={{ clipPath: 'inset(0 100% 0 0)' }} />
          <span ref={peakEl} className="dt-meter-peak" style={{ left: '0%' }} />
          <span className="dt-meter-ticks" aria-hidden="true" />
        </div>
        <span ref={dbEl} className="dt-db" aria-hidden="true">
          {stream ? '' : 'Off'}
        </span>
      </div>
      <div className="dt-scale" aria-hidden="true">
        <span>−60</span>
        <span>−40</span>
        <span>−20</span>
        <span>0 dB</span>
      </div>

      {stream && quiet && (
        <p className="notice dt-quiet" role="status">
          <WarningCircle size={16} weight="fill" />
          We’re barely hearing anything. Try speaking, check the mic isn’t muted (a switch, a key, or your system’s input volume), or pick another microphone.
        </p>
      )}

      {stream && (
        <div className="dt-row">
          {devices.length > 0 && (
            <select
              className="dt-select"
              aria-label="Microphone"
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value)
                start(e.target.value)
              }}
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className={`btn small dt-push${recording ? ' dt-recording' : ''}`} onClick={record} disabled={!!recording}>
            <Record size={14} weight="fill" />
            {recording ? `Recording… ${recording}` : 'Record 5 seconds and play back'}
          </button>
        </div>
      )}

      {clip && (
        <div className="dt-clip">
          <audio src={clip.url} controls autoPlay aria-label="Your 5-second test recording" />
          <span className="dt-note">Played back from this device only.</span>
        </div>
      )}
    </section>
  )
}

/* Speakers */

function SpeakerPanel() {
  const ctxRef = useRef(null)
  const [playing, setPlaying] = useState(null)
  const timer = useRef(0)

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      ctxRef.current?.close().catch(() => {})
    },
    [],
  )

  const ctx = () => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext()
    ctxRef.current.resume().catch(() => {})
    return ctxRef.current
  }

  function note(ac, freq, at, dur, pan, peak = 0.25, type = 'sine') {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    const panner = ac.createStereoPanner ? ac.createStereoPanner() : null
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    if (panner) {
      panner.pan.value = pan
      osc.connect(gain).connect(panner).connect(ac.destination)
    } else osc.connect(gain).connect(ac.destination)
    osc.start(at)
    osc.stop(at + dur + 0.05)
  }

  function tone(which) {
    const ac = ctx()
    const pan = which === 'left' ? -1 : which === 'right' ? 1 : 0
    const t = ac.currentTime + 0.05
    // Two short beeps, so it's easy to tell which side they come from.
    note(ac, 660, t, 0.35, pan)
    note(ac, 660, t + 0.45, 0.35, pan)
    flash(which, 900)
  }

  function chime() {
    const ac = ctx()
    const t = ac.currentTime + 0.05
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      note(ac, f, t + i * 0.14, 1.4, 0, 0.18)
      note(ac, f * 2, t + i * 0.14, 0.6, 0, 0.03, 'triangle')
    })
    flash('chime', 1700)
  }

  function flash(which, ms) {
    clearTimeout(timer.current)
    setPlaying(which)
    timer.current = setTimeout(() => setPlaying(null), ms)
  }

  const btn = (key, label) => (
    <button type="button" className={`btn dt-speaker${playing === key ? ' on' : ''}`} onClick={() => tone(key)} aria-pressed={playing === key}>
      <SpeakerHigh size={16} className={key === 'left' ? 'dt-flip' : ''} />
      {label}
    </button>
  )

  return (
    <section className="panel dt-panel" aria-labelledby="dt-speakers">
      <PanelHead icon={SpeakerHigh} title={<span id="dt-speakers">Speakers</span>} live={!!playing} status={false} />
      <p className="dt-note dt-note-top">Play a short tone on each side to check your speakers or headphones are connected the right way round.</p>
      <div className="dt-speakers">
        {btn('left', 'Left')}
        {btn('both', 'Both')}
        {btn('right', 'Right')}
        <button type="button" className={`btn dt-speaker${playing === 'chime' ? ' on' : ''}`} onClick={chime} aria-pressed={playing === 'chime'}>
          <Bell size={16} />
          Chime
        </button>
      </div>
      <p className="dt-note">Can’t hear anything? Check the volume, that the right output is selected in your system’s sound settings, and that this tab isn’t muted.</p>
    </section>
  )
}
