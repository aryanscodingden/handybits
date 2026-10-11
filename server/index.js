// Handybits server: the Instagram downloader API, and in production the
// built front end. Reels are fetched with yt-dlp into a temp folder, streamed
// back to the browser, and deleted immediately.

import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.PORT) || 8787
const DIST = path.resolve(import.meta.dirname, '../dist')
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp'
const TIMEOUT_MS = 120_000
const MAX_JOBS = 3

// Only reel/post links; the shortcode is all we keep from user input.
const INSTAGRAM_URL = /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,64})\/?(?:[?#].*)?$/i

let activeJobs = 0

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

// Optional login cookies help when Instagram refuses anonymous requests.
function cookieArgs() {
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) return ['--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER]
  if (process.env.YTDLP_COOKIES) return ['--cookies', process.env.YTDLP_COOKIES]
  return []
}

function friendlyError(stderr) {
  if (/login required|log in|rate-?limit|checkpoint|cookies/i.test(stderr)) {
    return [429, 'Instagram is asking for a login. Try again later, or set YTDLP_COOKIES_FROM_BROWSER on the server (see README).']
  }
  if (/private|not available|unavailable|404|does not exist/i.test(stderr)) {
    return [404, 'This reel is private, deleted, or unavailable.']
  }
  if (/no video formats|There is no video/i.test(stderr)) return [422, 'This post doesn’t contain a video.']
  if (/File is larger than max-filesize/i.test(stderr)) return [413, 'This reel is too large to download.']
  return [502, 'Couldn’t download this reel. Instagram may be blocking requests right now.']
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(Object.assign(new Error('timeout'), { status: 504, userMessage: 'Instagram took too long to respond. Try again.' }))
    }, TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      const missing = err.code === 'ENOENT'
      reject(Object.assign(err, { status: 500, userMessage: missing ? 'yt-dlp isn’t installed on the server.' : 'Downloader failed to start.' }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve(stdout)
      const [status, userMessage] = friendlyError(stderr)
      reject(Object.assign(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited ${code}`), { status, userMessage }))
    })
  })
}

async function handleInstagram(req, res, query) {
  const match = INSTAGRAM_URL.exec(query.get('url') || '')
  if (!match) return sendJson(res, 400, { error: 'That doesn’t look like an Instagram reel or post link.' })
  const type = query.get('type') === 'audio' ? 'audio' : 'video'
  if (activeJobs >= MAX_JOBS) return sendJson(res, 503, { error: 'Busy with other downloads. Try again in a few seconds.' })

  const shortcode = match[2]
  const url = `https://www.instagram.com/${match[1] === 'p' ? 'p' : 'reel'}/${shortcode}/`
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'handybits-'))
  activeJobs++

  const formatArgs =
    type === 'audio'
      ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
      : ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4']

  try {
    const out = await runYtDlp([
      '--no-playlist',
      '--no-progress',
      '--no-warnings',
      '--restrict-filenames',
      '--max-filesize', '300M',
      ...cookieArgs(),
      ...formatArgs,
      '-o', path.join(dir, '%(channel,uploader_id|instagram)s-%(id)s.%(ext)s'),
      '--print', 'after_move:filepath',
      '--',
      url,
    ])

    const file = out.trim().split('\n').pop()
    if (!file || path.dirname(file) !== dir) throw Object.assign(new Error('no output file'), { status: 502 })
    const { size } = await fsp.stat(file)
    const name = path.basename(file)

    res.writeHead(200, {
      'Content-Type': type === 'audio' ? 'audio/mpeg' : 'video/mp4',
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
    console.error(`[instagram] ${shortcode} ${type}: ${err.message}`)
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.userMessage || 'Download failed. Try again.' })
    else res.destroy()
  } finally {
    activeJobs--
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

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
    if (pathname === '/api/instagram' && req.method === 'GET') return await handleInstagram(req, res, searchParams)
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' })
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, pathname)
    res.writeHead(405).end()
  } catch (err) {
    console.error(err)
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' })
  }
})

server.listen(PORT, () => console.log(`Handybits server on http://localhost:${PORT}`))
