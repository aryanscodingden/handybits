// Pure text transforms for the text tools. No DOM, so it can be tested in Node.

const SMALL_WORDS = new Set(
  'a an and as at but by en for if in nor of on or per the to v vs via up yet so from into onto with off out over'.split(' '),
)

function capitalise(word) {
  // Leave words that already have inner capitals alone (iPhone, NASA, McDonald).
  if (/\p{Lu}/u.test(word.slice(1))) return word
  return word.charAt(0).toLocaleUpperCase() + word.slice(1)
}

// Title case per line: small words stay lowercase unless first or last, or
// right after a colon/dash. Hyphenated parts are capitalised individually.
export function titleCase(text) {
  return text
    .split('\n')
    .map((raw) => {
      // An all-caps line has no meaningful capitals to preserve.
      const line = /\p{Ll}/u.test(raw) ? raw : raw.toLocaleLowerCase()
      const tokens = line.split(/(\s+)/)
      const wordIdx = tokens.map((t, i) => (/\S/.test(t) ? i : -1)).filter((i) => i >= 0)
      const first = wordIdx[0]
      const last = wordIdx[wordIdx.length - 1]
      let afterBreak = false
      return tokens
        .map((tok, i) => {
          if (!/\S/.test(tok)) return tok
          const lead = tok.match(/^[^\p{L}\p{N}]*/u)[0]
          const core = tok.slice(lead.length)
          const bare = core.replace(/[^\p{L}\p{N}'’-]+$/u, '')
          const lower = bare.toLocaleLowerCase()
          const forceCap = i === first || i === last || afterBreak
          afterBreak = /[:—–]$|^[—–-]$/.test(tok)
          if (!forceCap && SMALL_WORDS.has(lower)) {
            return lead + core.replace(bare, lower)
          }
          const capped = bare
            .split('-')
            .map((p) => capitalise(/\p{Lu}/u.test(p.slice(1)) ? p : p.toLocaleLowerCase()))
            .join('-')
          return lead + core.replace(bare, capped)
        })
        .join('')
    })
    .join('\n')
}

export function sentenceCase(text) {
  const lower = text.toLocaleLowerCase()
  // Capitalise the first letter of the text and after . ! ? or a blank line.
  return lower
    .replace(/(^\s*|[.!?]\s+|\n\s*)(\p{L})/gu, (_, pre, ch) => pre + ch.toLocaleUpperCase())
    .replace(/\bi\b/g, 'I')
}

function splitWords(text) {
  return (
    text
      // fooBar -> foo Bar, HTMLParser -> HTML Parser
      .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  )
}

// Identifier styles work per line so a list of names converts as a list.
function perLine(fn) {
  return (text) => text.split('\n').map((l) => (l.trim() ? fn(splitWords(l)) : l)).join('\n')
}

export const camelCase = perLine((ws) =>
  ws.map((w, i) => (i ? w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase() : w.toLocaleLowerCase())).join(''),
)
export const snakeCase = perLine((ws) => ws.map((w) => w.toLocaleLowerCase()).join('_'))
export const kebabCase = perLine((ws) => ws.map((w) => w.toLocaleLowerCase()).join('-'))

const lines = (t) => t.split(/\r?\n/)

export const removeLineBreaks = (t) => t.replace(/\s*\r?\n\s*/g, ' ').trim()
export const removeExtraSpaces = (t) => lines(t).map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n')
export const trimLines = (t) => lines(t).map((l) => l.trim()).join('\n')
export const removeEmptyLines = (t) => lines(t).filter((l) => l.trim()).join('\n')
export const removeDuplicateLines = (t) => {
  const seen = new Set()
  return lines(t)
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .join('\n')
}
export function stripHtml(t) {
  return t
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const plain = new Intl.Collator(undefined, { sensitivity: 'base' })
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const sortAZ = (t) => lines(t).sort(plain.compare).join('\n')
export const sortZA = (t) => lines(t).sort((a, b) => plain.compare(b, a)).join('\n')
export const sortNatural = (t) => lines(t).sort(natural.compare).join('\n')
export const reverseLines = (t) => lines(t).reverse().join('\n')

export function shuffleLines(t, randomInt) {
  const arr = lines(t)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.join('\n')
}

export function numberLines(t) {
  const arr = lines(t)
  const width = String(arr.length).length
  return arr.map((l, i) => `${String(i + 1).padStart(width, ' ')}. ${l}`).join('\n')
}
