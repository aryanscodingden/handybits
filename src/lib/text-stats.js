// Pure text statistics for the word counter. No DOM, so it can be tested in Node.

export const READING_WPM = 238
export const SPEAKING_WPM = 150

const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
const wordSegmenter = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
const graphemeSegmenter = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

// Fallback: runs of letters/numbers, allowing inner apostrophes and hyphens.
const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export function words(text, { segmenter = wordSegmenter } = {}) {
  if (!text) return []
  if (segmenter) {
    const out = []
    for (const s of segmenter.segment(text)) if (s.isWordLike) out.push(s.segment)
    return out
  }
  return text.match(WORD_RE) || []
}

// Characters as people see them (emoji and accented letters count once).
export function charCount(text) {
  if (!text) return 0
  if (graphemeSegmenter) {
    let n = 0
    for (const _ of graphemeSegmenter.segment(text)) n++
    return n
  }
  return Array.from(text).length
}

export function sentenceCount(text) {
  const t = text.trim()
  if (!t) return 0
  // A sentence ends with terminal punctuation (Latin, CJK, Devanagari) or a blank line.
  const parts = t.split(/(?<=[.!?。！？।…])\s+|\n\s*\n/u)
  return parts.filter((p) => /[\p{L}\p{N}]/u.test(p)).length
}

export function paragraphCount(text) {
  return text.split(/\n\s*\n/).filter((p) => p.trim()).length
}

export function stats(text) {
  const w = words(text)
  const chars = charCount(text)
  const noSpaces = charCount(text.replace(/\s+/g, ''))
  return {
    words: w.length,
    chars,
    noSpaces,
    sentences: sentenceCount(text),
    paragraphs: paragraphCount(text),
    readingMin: w.length / READING_WPM,
    speakingMin: w.length / SPEAKING_WPM,
  }
}

// "Under a minute", "4 min", "1 hr 12 min"
export function formatDuration(minutes) {
  if (minutes <= 0) return '0 min'
  const secs = Math.round(minutes * 60)
  if (secs < 60) return `${secs} sec`
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} hr ${m % 60} min`
}

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both
  but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had
  hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd
  i'll i'm i've if in into is isn't it it's its itself just let's me more most mustn't my myself no nor not now of off on
  once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some
  such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've
  this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's
  where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your
  yours yourself yourselves also get got like one two us may might much many must shall still yet via etc s t ll re ve d m`
    .split(/\s+/)
    .filter(Boolean),
)

function normalise(word) {
  return word.toLocaleLowerCase().replace(/’/g, "'")
}

function isContent(w) {
  return !STOPWORDS.has(w) && !/^\p{N}+$/u.test(w) && w.length > 1
}

// Top keywords or two-word phrases. Phrases don't cross sentence breaks and
// must be made of two non-stopwords.
export function keywords(text, { phrases = false, limit = 8 } = {}) {
  const counts = new Map()
  let total = 0
  if (!phrases) {
    for (const raw of words(text)) {
      const w = normalise(raw)
      if (!isContent(w)) continue
      total++
      counts.set(w, (counts.get(w) || 0) + 1)
    }
  } else {
    for (const chunk of text.split(/[.!?;:,()\n"“”。！？]+/u)) {
      const ws = words(chunk).map(normalise)
      for (let i = 0; i < ws.length - 1; i++) {
        total++
        if (!isContent(ws[i]) || !isContent(ws[i + 1])) continue
        const k = `${ws[i]} ${ws[i + 1]}`
        counts.set(k, (counts.get(k) || 0) + 1)
      }
    }
  }
  return [...counts]
    .filter(([, n]) => !phrases || n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count, pct: total ? (count / total) * 100 : 0 }))
}
