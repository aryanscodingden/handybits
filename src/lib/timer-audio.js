// A soft generated chime for the timer, played with Web Audio.
// The context is created on the first user gesture (start) so browsers let it play later.

let ctx = null

export function unlockAudio() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// One bell-like note: a sine with two quiet overtones and a long exponential decay.
function bell(ac, out, freq, at, length = 1.6, level = 0.22) {
  const partials = [
    [1, 1],
    [2.01, 0.28],
    [3.02, 0.08],
  ]
  for (const [mult, amp] of partials) {
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * mult
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(level * amp, at + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, at + length / mult)
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + length + 0.05)
  }
}

// Three rising notes (E5, G#5, B5). Returns its length in seconds.
export function playChime() {
  const ac = unlockAudio()
  if (!ac) return 0
  const out = ac.createGain()
  out.gain.value = 0.9
  out.connect(ac.destination)
  const t = ac.currentTime + 0.03
  bell(ac, out, 659.25, t)
  bell(ac, out, 830.61, t + 0.18)
  bell(ac, out, 987.77, t + 0.36, 2.2)
  return 2.6
}

// Repeats the chime until stop() is called, or for at most maxMs.
export function startAlarm({ interval = 2800, maxMs = 120000 } = {}) {
  let stopped = false
  playChime()
  const id = setInterval(() => {
    if (!stopped) playChime()
  }, interval)
  const cap = setTimeout(stop, maxMs)
  function stop() {
    stopped = true
    clearInterval(id)
    clearTimeout(cap)
  }
  return stop
}
