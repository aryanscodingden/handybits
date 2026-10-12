// Which links the downloader accepts. Every user-supplied URL is parsed, its
// host checked against a fixed allowlist, and its path matched strictly. Only
// the captured IDs survive: yt-dlp always gets a canonical URL we built
// ourselves, never the raw input, so it can't be pointed at arbitrary hosts.

const hosts = (...list) => new Set(list)

// IDs and short codes below are deliberately narrow.
const PINTEREST_TLDS = [
  'com', 'ca', 'co.uk', 'com.au', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'se', 'dk', 'ch', 'at',
  'ie', 'nz', 'jp', 'co.kr', 'com.mx', 'cl', 'ph', 'ru', 'in',
]
const PINTEREST_HOSTS = new Set(
  PINTEREST_TLDS.flatMap((tld) => [`pinterest.${tld}`, `www.pinterest.${tld}`]),
)

export const SITES = [
  {
    id: 'instagram',
    label: 'Instagram',
    hosts: hosts('instagram.com', 'www.instagram.com', 'm.instagram.com'),
    paths: [
      {
        re: /^\/(?:[A-Za-z0-9._]{1,30}\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,64})\/?$/,
        clean: (m) => `https://www.instagram.com/${m[1] === 'p' ? 'p' : 'reel'}/${m[2]}/`,
      },
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hosts: hosts('tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'),
    paths: [
      {
        host: /^(?:www\.|m\.)?tiktok\.com$/,
        re: /^\/@([A-Za-z0-9._]{1,64})\/video\/(\d{5,25})\/?$/,
        clean: (m) => `https://www.tiktok.com/@${m[1]}/video/${m[2]}`,
      },
      {
        host: /^(?:www\.|m\.)?tiktok\.com$/,
        re: /^\/t\/([A-Za-z0-9]{5,20})\/?$/,
        clean: (m) => `https://www.tiktok.com/t/${m[1]}/`,
      },
      {
        host: /^v[mt]\.tiktok\.com$/,
        re: /^\/([A-Za-z0-9]{5,20})\/?$/,
        clean: (m, host) => `https://${host}/${m[1]}/`,
      },
    ],
  },
  {
    id: 'x',
    label: 'X',
    hosts: hosts('x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'm.twitter.com'),
    paths: [
      {
        re: /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:\/(?:video|photo)\/\d)?\/?$/,
        clean: (m) => `https://x.com/${m[1]}/status/${m[2]}`,
      },
    ],
  },
  {
    id: 'reddit',
    label: 'Reddit',
    hosts: hosts('reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'm.reddit.com', 'np.reddit.com', 'redd.it', 'v.redd.it'),
    paths: [
      {
        host: /reddit\.com$/,
        re: /^\/(r|u|user)\/([A-Za-z0-9_-]{2,32})\/comments\/([a-z0-9]{4,10})(?:\/[A-Za-z0-9_%-]{0,300})?\/?$/,
        clean: (m) => `https://www.reddit.com/${m[1] === 'r' ? 'r' : 'user'}/${m[2]}/comments/${m[3]}/`,
      },
      {
        host: /reddit\.com$/,
        re: /^\/comments\/([a-z0-9]{4,10})(?:\/[A-Za-z0-9_%-]{0,300})?\/?$/,
        clean: (m) => `https://www.reddit.com/comments/${m[1]}/`,
      },
      // Share links (reddit.com/r/sub/s/CODE) redirect to the post.
      {
        host: /reddit\.com$/,
        re: /^\/r\/([A-Za-z0-9_]{2,32})\/s\/([A-Za-z0-9]{5,20})\/?$/,
        clean: (m) => `https://www.reddit.com/r/${m[1]}/s/${m[2]}`,
      },
      {
        host: /^redd\.it$/,
        re: /^\/([a-z0-9]{4,10})\/?$/,
        clean: (m) => `https://www.reddit.com/comments/${m[1]}/`,
      },
      {
        host: /^v\.redd\.it$/,
        re: /^\/([a-z0-9]{5,20})\/?$/,
        clean: (m) => `https://v.redd.it/${m[1]}`,
      },
    ],
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    hosts: new Set([...PINTEREST_HOSTS, 'pin.it']),
    paths: [
      {
        host: /pinterest\./,
        re: /^\/pin\/(?:[A-Za-z0-9-]{1,120}--)?(\d{5,25})\/?$/,
        clean: (m) => `https://www.pinterest.com/pin/${m[1]}/`,
      },
      {
        host: /^pin\.it$/,
        re: /^\/([A-Za-z0-9]{5,20})\/?$/,
        clean: (m) => `https://pin.it/${m[1]}`,
      },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    hosts: hosts('facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch', 'www.fb.watch'),
    paths: [
      {
        host: /facebook\.com$/,
        re: /^\/reels?\/(\d{5,25})\/?$/,
        clean: (m) => `https://www.facebook.com/reel/${m[1]}`,
      },
      {
        host: /facebook\.com$/,
        re: /^\/watch\/?$/,
        query: 'v',
        clean: (m, host, id) => `https://www.facebook.com/watch/?v=${id}`,
      },
      {
        host: /facebook\.com$/,
        re: /^\/(?:[A-Za-z0-9.-]{1,80}\/)?videos\/(?:[A-Za-z0-9.%-]{1,200}\/)?(\d{5,25})\/?$/,
        clean: (m) => `https://www.facebook.com/watch/?v=${m[1]}`,
      },
      {
        host: /facebook\.com$/,
        re: /^\/share\/([vr])\/([A-Za-z0-9]{5,20})\/?$/,
        clean: (m) => `https://www.facebook.com/share/${m[1]}/${m[2]}/`,
      },
      {
        host: /fb\.watch$/,
        re: /^\/([A-Za-z0-9_-]{5,20})\/?$/,
        clean: (m) => `https://fb.watch/${m[1]}/`,
      },
    ],
  },
]

const YOUTUBE = /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/

/**
 * Validate a user-supplied link.
 * Returns { site, url } with a canonical URL, or { error } with a message.
 */
export function matchSite(input) {
  const unsupported = { error: 'That doesn’t look like a supported video link (Instagram, TikTok, X, Reddit, Pinterest or Facebook).' }
  if (typeof input !== 'string' || input.length > 2048) return unsupported
  let u
  try {
    u = new URL(input.trim())
  } catch {
    return unsupported
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return unsupported
  if (u.username || u.password || u.port) return unsupported
  const host = u.hostname.toLowerCase()
  if (YOUTUBE.test(host)) return { error: 'YouTube isn’t supported.' }

  const site = SITES.find((s) => s.hosts.has(host))
  if (!site) return unsupported
  for (const p of site.paths) {
    if (p.host && !p.host.test(host)) continue
    const m = p.re.exec(u.pathname)
    if (!m) continue
    if (p.query) {
      const id = u.searchParams.get(p.query) || ''
      if (!/^\d{5,25}$/.test(id)) continue
      return { site, url: p.clean(m, host, id) }
    }
    return { site, url: p.clean(m, host) }
  }
  return { error: `That ${site.label} link doesn’t point to a video post.`, site }
}
