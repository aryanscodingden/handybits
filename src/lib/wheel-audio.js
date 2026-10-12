// A short, quiet tick for the spinning wheel.
let ctx = null
let last = 0

export function unlockWheelAudio() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

export function tick() {
  const ac = unlockWheelAudio()
  if (!ac) return
  const t = ac.currentTime
  if (t - last < 0.03) return
  last = t
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(1900, t)
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.03)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.08, t + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
  osc.connect(g).connect(ac.destination)
  osc.start(t)
  osc.stop(t + 0.05)
}

// A soft two-note "done" sound when the wheel stops.
export function landed() {
  const ac = unlockWheelAudio()
  if (!ac) return
  const t = ac.currentTime + 0.01
  ;[
    [784, 0],
    [1046.5, 0.11],
  ].forEach(([f, dt]) => {
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    g.gain.setValueAtTime(0.0001, t + dt)
    g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.6)
    osc.connect(g).connect(ac.destination)
    osc.start(t + dt)
    osc.stop(t + dt + 0.65)
  })
}
