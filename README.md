# Handybits

Small, handy tools in one place.

- **PDF**: convert any file to PDF; merge, split, reorder and rotate pages; compress; sign.
- **Image**: compress, resize and convert images (including iPhone HEIC); remove backgrounds; make QR codes.
- **Media**: download videos from YouTube, Instagram, TikTok, X, Reddit, Pinterest and Facebook; extract MP3 audio or shrink a video to a target size.
- **Text**: word and character counter; case conversion, cleanup, sorting and text comparison.
- **Everyday**: password and passphrase generator; time zone converter and meeting planner.

Everything except the video downloader runs in the browser. Files never leave the device.

## Run it

Requires Node 20+, plus [ffmpeg](https://ffmpeg.org) for the video downloader. `yt-dlp` is installed automatically with the project's npm dependencies:

```sh
brew install ffmpeg            # macOS
npm install
npm run dev                    # app on http://localhost:5173, API on :8787
```

For production, deploy using the included `Dockerfile`. It installs `ffmpeg`; the production npm install downloads the bundled `yt-dlp` binary. The app and API run from one Node process (port `8787`, or `PORT`):

```sh
docker build -t handybits .
docker run --rm -p 8787:8787 handybits
```

Most hosts (Fly.io, Render, Railway, or a VPS) detect the Dockerfile automatically. Do not use static-only hosting: the Instagram tool needs a server that can run `yt-dlp` and `ffmpeg`.

## Video downloader

Paste a link, choose **Video (MP4)** or **Audio only (MP3)**, and click **Download**. Supported sites:

| Site | Links |
| --- | --- |
| YouTube | `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/shorts/…`, `music.youtube.com/watch?v=…` |
| Instagram | `instagram.com/reel/…`, `/p/…`, `/tv/…` |
| TikTok | `tiktok.com/@user/video/…`, `vm.tiktok.com/…`, `vt.tiktok.com/…`, `tiktok.com/t/…` |
| X / Twitter | `x.com/user/status/…`, `twitter.com/user/status/…` |
| Reddit | `reddit.com/r/…/comments/…`, `reddit.com/r/…/s/…`, `redd.it/…`, `v.redd.it/…` |
| Pinterest | `pinterest.*/pin/…`, `pin.it/…` |
| Facebook | `facebook.com/reel/…`, `facebook.com/watch?v=…`, `facebook.com/…/videos/…`, `facebook.com/share/v/…`, `fb.watch/…` |

Single YouTube videos only (no playlists or channels). yt-dlp needs a JavaScript runtime to read YouTube; the server passes `--js-runtimes node`, and Node is already there. YouTube blocks datacenter IPs more aggressively than any other site here ("confirm you’re not a bot"), so on a VPS expect to need `YTDLP_PROXY` below.

The browser can't fetch these sites directly, because they block cross-site requests, so the server does it. `GET /api/download?url=…&type=video|audio` (`/api/instagram` is kept as an alias) checks the link against a fixed allowlist in `server/sites.js`, rebuilds a canonical URL from the post ID (yt-dlp never sees the raw input or any other host), runs yt-dlp into a temp folder, streams the file back and deletes it. Nothing is stored. At most 3 downloads run at once, each with a 2-minute timeout, a 300 MB size cap and a 30-minute length cap. Videos prefer H.264 MP4 so they play in QuickTime. `GET /api/sites` lists the supported sites.

TikTok needs yt-dlp's browser impersonation, which requires the `curl_cffi` Python package next to the bundled yt-dlp (for example `pip install curl_cffi`). Without it, TikTok downloads fail with an SSL error.

**If Instagram asks for a login on your server**, the cause is usually the IP address, not the reel. Instagram serves public reels anonymously to home connections but asks datacenter IPs (most VPSes) to log in. Route yt-dlp through a home machine instead of using your account:

```sh
# On an always-on home machine on your tailnet (Mac, Pi, etc.)
brew install microsocks                                  # or: apt install microsocks
microsocks -i "$(tailscale ip -4)" -p 1080               # only listens on the tailnet

# On the server
YTDLP_PROXY=socks5://<home-machine-tailscale-ip>:1080 npm start
```

Only yt-dlp's requests to the video sites use the proxy. Other sites may ask datacenter IPs to log in too; the same proxy fixes that. The video still streams from the server to the browser. Any `http://`, `https://` or `socks5://` proxy works.

As a last resort, yt-dlp can use session cookies. Use a throwaway account, because Instagram may flag accounts used this way:

```sh
YTDLP_COOKIES_FROM_BROWSER=chrome npm run dev     # reuse your logged-in Chrome session
YTDLP_COOKIES=/path/to/cookies.txt npm start      # or a Netscape-format cookies file
```

Only public videos work without cookies. Sites change things often; if downloads start failing, refresh the bundled downloader first (`npm rebuild youtube-dl-exec`). Only download content you have the right to use.

## PDF Converter

| Input | How |
| --- | --- |
| PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, ICO (HEIC in Safari) | One image per page, page orientation follows the image |
| Word (.docx) | mammoth → HTML → rendered pages |
| Excel (.xlsx, .xls, .ods), CSV/TSV | SheetJS → tables, one section per sheet (first 5,000 rows) |
| Markdown, HTML | Rendered pages |
| Plain text, code, JSON | Real, selectable PDF text (JSON is pretty-printed) |
| PDF | Passed through as-is |

Not supported: PowerPoint/Keynote, legacy .doc, RTF, ODT, archives, audio/video.

File types are detected from the file's **bytes** (magic numbers, zip contents), not just the extension.

**Privacy and storage**: conversion never leaves the browser. Rich documents are rendered in a sandboxed iframe with scripts disabled and all network requests blocked. The list of converted files is kept in `localStorage`; the PDF bytes are kept in IndexedDB (localStorage only holds about 5 MB). Both expire after **3 days**.

**Limits**: Word, Excel, Markdown and HTML are rendered as page images (about 144 dpi), so their text isn't selectable and they run about 150–300 KB per page. Plain text and code produce real text PDFs.

## Code map

- `src/tools/index.js`: the tool registry (id, label, icon, group, search keywords). Add a tool here and it appears in the sidebar, home screen and ⌘K menu; each tool's code loads only when it's opened.
- `src/App.jsx`: sidebar, hash routing (`#/<tool-id>`, `#/` for the home screen), lazy loading
- `src/components/`: shared drop zone, home screen, ⌘K command menu
- `src/tools/*.jsx` (+ matching `.css`): one file per tool
- `src/lib/`: shared logic. `pdf.js` (pdf-lib + pdf.js page work), `convert.js` (any file → PDF), `storage.js` (3-day on-device library), `bg-worker.js` (background removal model, in a worker), `video-engine.js` (ffmpeg.wasm), plus pure helpers for images, QR codes, text, passwords and time zones
- `server/index.js`: video downloader API and production static server
- `server/sites.js`: allowlist of supported sites and link validation
