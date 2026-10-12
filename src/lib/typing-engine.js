// Pure typing-test logic: text generation, input reducer and scoring.
// No DOM, so it can be unit-tested in Node.

// ---------- Text generation ----------

const rand = (n, rng) => Math.floor(rng() * n)

// Turn a list of plain words into words with punctuation/capitals/numbers.
export function generateWords(pool, count, { punctuation = false, numbers = false, rng = Math.random, startOfSentence = true } = {}) {
  const out = []
  let capNext = startOfSentence
  let last = ''
  for (let i = 0; i < count; i++) {
    let w
    // Avoid the same word twice in a row.
    do w = pool[rand(pool.length, rng)]
    while (w === last && pool.length > 1)
    last = w
    if (numbers && rng() < 0.1) {
      const digits = 1 + rand(4, rng)
      w = String(rand(10 ** digits, rng))
    }
    if (punctuation) {
      if (capNext && /^[a-z]/.test(w)) w = w[0].toUpperCase() + w.slice(1)
      capNext = false
      const r = rng()
      const lastWord = i === count - 1
      if (lastWord) w += '.'
      else if (r < 0.07) {
        w += '.'
        capNext = true
      } else if (r < 0.14) w += ','
      else if (r < 0.16) {
        w += '?'
        capNext = true
      } else if (r < 0.17) {
        w += '!'
        capNext = true
      } else if (r < 0.19) w += ';'
      else if (r < 0.21) w += ':'
      else if (r < 0.23) w = `"${w}"`
      else if (r < 0.25) w = `(${w})`
      else if (r < 0.26 && i > 0) out.push('-')
    }
    out.push(w)
  }
  return out
}

export function quoteWords(text) {
  return text.trim().split(/\s+/)
}

// ---------- Input reducer ----------
// state: { words, typed: string[], keys: { total, correct, errors }, done }
// typed[typed.length - 1] is the word being typed now.

export function initialState(words) {
  return { words, typed: [''], keys: { total: 0, correct: 0, errors: 0 }, done: false }
}

const MAX_EXTRA = 20

export function currentIndex(state) {
  return state.typed.length - 1
}

// Insert one character. Returns a new state (or the same one if ignored).
export function typeChar(state, ch) {
  if (state.done) return state
  const i = currentIndex(state)
  const target = state.words[i] ?? ''
  const cur = state.typed[i]
  if (ch === ' ' || ch === '\n') {
    if (cur === '') return state // no skipping words with a stray space
    const ok = cur === target
    const keys = { total: state.keys.total + 1, correct: state.keys.correct + (ok ? 1 : 0), errors: state.keys.errors + (ok ? 0 : 1) }
    const isLast = i >= state.words.length - 1
    if (isLast) return { ...state, keys, done: true }
    return { ...state, typed: [...state.typed, ''], keys }
  }
  if (cur.length >= target.length + MAX_EXTRA) return state
  const ok = cur.length < target.length && target[cur.length] === ch
  const next = cur + ch
  const typed = state.typed.slice()
  typed[i] = next
  const keys = { total: state.keys.total + 1, correct: state.keys.correct + (ok ? 1 : 0), errors: state.keys.errors + (ok ? 0 : 1) }
  // The test ends as soon as the last word is typed exactly.
  const done = i >= state.words.length - 1 && next === target
  return { ...state, typed, keys, done }
}

export function typeText(state, text) {
  let s = state
  for (const ch of text) s = typeChar(s, ch)
  return s
}

// Can we step back into the previous word? Only if it has a mistake.
function canGoBack(state) {
  const i = currentIndex(state)
  return i > 0 && state.typed[i - 1] !== state.words[i - 1]
}

export function backspace(state) {
  if (state.done) return state
  const i = currentIndex(state)
  const cur = state.typed[i]
  if (cur.length) {
    const typed = state.typed.slice()
    typed[i] = [...cur].slice(0, -1).join('')
    return { ...state, typed }
  }
  if (canGoBack(state)) return { ...state, typed: state.typed.slice(0, -1) }
  return state
}

export function deleteWord(state) {
  if (state.done) return state
  const i = currentIndex(state)
  if (state.typed[i].length) {
    const typed = state.typed.slice()
    typed[i] = ''
    return { ...state, typed }
  }
  if (canGoBack(state)) {
    const typed = state.typed.slice(0, -1)
    typed[typed.length - 1] = ''
    return { ...state, typed }
  }
  return state
}

// ---------- Scoring ----------

// Character breakdown. A word counts as "submitted" once you've moved past it
// (or the test is over); unfinished characters in submitted words are missed.
export function countChars(state, { final = state.done } = {}) {
  let correct = 0
  let incorrect = 0
  let extra = 0
  let missed = 0
  let spaces = 0 // correct spaces (after exactly-typed words)
  let typedSpaces = 0
  const n = state.typed.length
  for (let i = 0; i < n; i++) {
    const t = state.typed[i]
    const w = state.words[i] ?? ''
    const submitted = i < n - 1 || final
    const m = Math.min(t.length, w.length)
    for (let j = 0; j < m; j++) {
      if (t[j] === w[j]) correct++
      else incorrect++
    }
    if (t.length > w.length) extra += t.length - w.length
    if (submitted && t.length < w.length) missed += w.length - t.length
    if (i < n - 1) {
      typedSpaces++
      if (t === w) spaces++
    }
  }
  return { correct, incorrect, extra, missed, spaces, typedSpaces }
}

// Net WPM: correct characters plus correct spaces, / 5, per minute.
export function wpm(chars, seconds) {
  if (seconds <= 0) return 0
  return ((chars.correct + chars.spaces) / 5) * (60 / seconds)
}

// Raw WPM: everything typed (right or wrong, including spaces).
export function rawWpm(chars, seconds) {
  if (seconds <= 0) return 0
  return ((chars.correct + chars.incorrect + chars.extra + chars.typedSpaces) / 5) * (60 / seconds)
}

export function accuracy(keys) {
  return keys.total ? (keys.correct / keys.total) * 100 : 100
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

export function stdev(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length)
}

// Coefficient of variation of per-second raw WPM, mapped to 0–100 where 100 is
// perfectly even (the same curve Monkeytype uses: 100 * (1 - tanh-ish(cv))).
export function consistency(perSecondRaw) {
  const xs = perSecondRaw.filter((x) => Number.isFinite(x))
  if (xs.length < 2) return 100
  const m = mean(xs)
  if (m === 0) return 0
  const cv = stdev(xs) / m
  return Math.max(0, 100 * (1 - Math.tanh(cv + cv ** 3 / 3 + cv ** 5 / 5)))
}

export function coefficientOfVariation(xs) {
  const m = mean(xs)
  return m ? stdev(xs) / m : 0
}

// Personal-best key for a test configuration.
export function pbKey({ mode, amount, punctuation, numbers }) {
  if (mode === 'quote') return 'quote'
  return `${mode}-${amount}${punctuation ? '-p' : ''}${numbers ? '-n' : ''}`
}
