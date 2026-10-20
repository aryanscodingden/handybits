// Handybits server: the video downloader API, and in production the built
// front end. Videos are fetched with yt-dlp into a temp folder, streamed back
// to the browser, and deleted immediately.

import http from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SITES, matchSite } from './sites.js'

const PORT = Number(process.env.PORT) || 8787
const DIST = path.resolve(import.meta.dirname, '../dist')
const require = createRequire(import.meta.url)
// Use the binary installed with npm. YTDLP_PATH remains available for hosts
// that manage yt-dlp themselves.
const YTDLP = process.env.YTDLP_PATH || require.resolve('youtube-dl-exec/bin/yt-dlp')
const TIMEOUT_MS = 120_000
const MAX_JOBS = 3
const MAX_MINUTES = 30
// Printed by yt-dlp once a video passes --match-filter. If it's missing from
// a successful run, the filter skipped the video.
const PASSED = 'handybits-passed'

let activeJobs = 0

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

// Optional login cookies help when a site refuses anonymous requests.
function cookieArgs() {
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) return ['--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER]
  if (process.env.YTDLP_COOKIES) return ['--cookies', process.env.YTDLP_COOKIES]
  return []
}

// Instagram, YouTube (and sometimes others) demand a login from datacenter IPs (like
// most VPSes) but not from home connections. YTDLP_PROXY routes yt-dlp through
// a residential machine, e.g. a SOCKS proxy on a home computer reachable over
// Tailscale.
function proxyArgs() {
  return process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : []
}

// Video formats per site. Everything should open in QuickTime, so H.264 MP4
// is preferred wherever the site offers it.
function videoFormatArgs(site) {
  // Instagram's DASH MP4 video streams can use VP9, which QuickTime cannot
  // play even though the file extension is .mp4. Prefer its progressive
  // MP4 stream: it contains H.264 video and AAC audio in one file.
  if (site.id === 'instagram') return ['-f', 'b[ext=mp4]']
  const h264 = "[vcodec~='^(avc|h264)']"
  return [
    '-f', `b[ext=mp4]${h264}/bv*${h264}+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b`,
    '--merge-output-format', 'mp4',
  ]
}

// YouTube hides its stream URLs behind a JavaScript challenge. yt-dlp solves it
// with a JS runtime, and Node is already here.
function siteArgs(site) {
  return site.id === 'youtube' ? ['--js-runtimes', 'node'] : []
}

const AUDIO_ARGS = ['-f', 'ba/b[acodec!=none]/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']

function friendlyError(stderr, label) {
  if (label === 'YouTube' && /not a bot|sign in to confirm/i.test(stderr)) {
    return [429, 'YouTube thinks this server is a bot. This usually happens on datacenter IPs; the server needs YTDLP_PROXY set to a home connection (see README).']
  }
  if (/login required|log in|sign in|rate-?limit|checkpoint|cookies|authenticat/i.test(stderr)) {
    return label === 'Instagram'
      ? [429, 'Instagram is asking for a login. Try again later, or route the server through YTDLP_PROXY (see README).']
      : [429, `${label} is asking for a login. The post may be private or age-restricted, or ${label} is limiting requests right now.`]
  }
  if (/No video could be found/i.test(stderr)) {
    return [422, `Couldn’t find a video in this ${label} post. It may not have one, or ${label} hides it from logged-out visitors.`]
  }
  if (/no video formats|There is no video|Requested format is not available/i.test(stderr)) {
    return [422, `This ${label} post doesn’t contain a video.`]
  }
  if (/private|not available|unavailable|404|does not exist|no longer exists|removed/i.test(stderr)) {
    return [404, `This ${label} post is private, deleted, or unavailable.`]
  }
  if (/unable to obtain file audio codec|does not contain any stream|no audio/i.test(stderr)) {
    return [422, 'This video has no audio track to extract.']
  }
  if (/File is larger than max-filesize/i.test(stderr)) return [413, 'This video is too large to download (over 300 MB).']
  return [502, `Couldn’t download this video. ${label} may be blocking requests right now.`]
}

function runYtDlp(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(Object.assign(new Error('timeout'), { status: 504, userMessage: `${label} took too long to respond. Try again.` }))
    }, TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      const missing = err.code === 'ENOENT'
      reject(Object.assign(err, { status: 500, userMessage: missing ? 'yt-dlp isn’t installed on the server.' : 'Downloader failed to start.' }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve(stdout)
      const [status, userMessage] = friendlyError(stderr, label)
      reject(Object.assign(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited ${code}`), { status, userMessage }))
    })
  })
}

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
}

async function handleDownload(req, res, query) {
  const found = matchSite(query.get('url') || '')
  if (!found.url) return sendJson(res, 400, { error: found.error })
  const { site, url } = found
  const type = query.get('type') === 'audio' ? 'audio' : 'video'
  if (activeJobs >= MAX_JOBS) return sendJson(res, 503, { error: 'Busy with other downloads. Try again in a few seconds.' })

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'handybits-'))
  activeJobs++

  try {
    const out = await runYtDlp([
      '--no-playlist',
      '--playlist-items', '1',
      '--no-progress',
      '--no-warnings',
      '--restrict-filenames',
      '--trim-filenames', '120',
      '--max-filesize', '300M',
      // Refuse long videos before downloading anything. Posts without a
      // known duration are allowed; the size cap still applies.
      '--match-filter', `duration <? ${MAX_MINUTES * 60}`,
      '--print', `after_filter:${PASSED} %(id)s`,
      ...proxyArgs(),
      ...cookieArgs(),
      ...siteArgs(site),
      ...(type === 'audio' ? AUDIO_ARGS : videoFormatArgs(site)),
      '-o', path.join(dir, `${site.id}-%(uploader_id,uploader,channel|video)s-%(id)s.%(ext)s`),
      '--print', 'after_move:filepath',
      '--',
      url,
    ], site.label)

    const lines = out.trim().split('\n')
    if (!lines.some((l) => l.startsWith(PASSED))) {
      throw Object.assign(new Error('filtered or empty'), {
        status: 413,
        userMessage: `This video is longer than ${MAX_MINUTES} minutes, which is the limit here.`,
      })
    }
    const file = lines.filter((l) => !l.startsWith(PASSED)).pop()
    // yt-dlp also exits 0 without a file when --max-filesize stops it.
    if (!file) throw Object.assign(new Error('no output file'), { status: 413, userMessage: 'This video is too large to download (over 300 MB).' })
    if (path.dirname(file) !== dir) throw Object.assign(new Error('unexpected output path'), { status: 502 })
    const { size } = await fsp.stat(file)
    const name = path.basename(file)
    const ext = path.extname(name).toLowerCase()

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    })
    await new Promise((resolve) => {
      const stream = fs.createReadStream(file)
      stream.pipe(res)
      stream.on('error', () => res.destroy())
      res.on('close', resolve)
    })
  } catch (err) {
    console.error(`[download] ${site.id} ${url} ${type}: ${err.message}`)
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.userMessage || 'Download failed. Try again.' })
    else res.destroy()
  } finally {
    activeJobs--
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const SITE_LIST = SITES.map(({ id, label }) => ({ id, label }))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

async function serveStatic(req, res, pathname) {
  const target = path.resolve(DIST, '.' + decodeURIComponent(pathname))
  let file = target.startsWith(DIST + path.sep) ? target : path.join(DIST, 'index.html')
  try {
    if (!(await fsp.stat(file)).isFile()) file = path.join(DIST, 'index.html')
  } catch {
    file = path.join(DIST, 'index.html')
  }
  try {
    const body = await fsp.readFile(file)
    const immutable = file.includes(`${path.sep}assets${path.sep}`)
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found. Run `npm run build` first.')
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost')
  try {
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true })
    if (pathname === '/api/sites') return sendJson(res, 200, SITE_LIST)
    // /api/instagram is the original endpoint, kept as an alias.
    if ((pathname === '/api/download' || pathname === '/api/instagram') && req.method === 'GET') {
      return await handleDownload(req, res, searchParams)
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' })
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, pathname)
    res.writeHead(405).end()
  } catch (err) {
    console.error(err)
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' })
  }
})

server.listen(PORT, () => console.log(`Handybits server on http://localhost:${PORT}`))
