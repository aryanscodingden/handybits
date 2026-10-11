# Handybits

Small, handy tools in one place.

- **PDF Converter**: turn any file into a PDF, entirely in your browser.
- **Instagram**: download a reel, or just its audio, in one click.

## Run it

Requires Node 20+, plus [ffmpeg](https://ffmpeg.org) for the Instagram tool. `yt-dlp` is installed automatically with the project's npm dependencies:

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

## Instagram

Paste a reel link, choose **Reel (video)** or **Audio only (MP3)**, and click **Download**.

The browser can't fetch Instagram directly, because Instagram blocks cross-site requests, so the server does it: `server/index.js` validates the link, rebuilds a clean `instagram.com/reel/<id>/` URL, runs yt-dlp into a temp folder, streams the file back and deletes it. Nothing is stored. At most 3 downloads run at once, each with a 2-minute timeout.

**If Instagram asks for a login**, which happens on some networks and server IPs, give yt-dlp your session cookies:

```sh
YTDLP_COOKIES_FROM_BROWSER=chrome npm run dev     # reuse your logged-in Chrome session
YTDLP_COOKIES=/path/to/cookies.txt npm start      # or a Netscape-format cookies file
```

Only public reels work without cookies. Instagram changes things often; if downloads start failing, refresh the bundled downloader first (`npm rebuild youtube-dl-exec`). Only download content you have the right to use.

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

- `src/App.jsx`: sidebar and tool routing (`#/pdf`, `#/instagram`)
- `src/tools/PdfTool.jsx`, `src/tools/InstagramTool.jsx`: the tools
- `src/lib/`: PDF detection, conversion, storage
- `server/index.js`: Instagram API and production static server
