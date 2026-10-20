# Handybits
small, handy tools in one place

# why Handybits?
Everyday tools without the upload-your-file-to-the-darkweb-servers part
- merge, compress and sign PDFs
- remove backgrounds, compress images, make QR codes
- cut audio, make GIFs, record your screen
- everything runs in your browser, files never leave your device
- also open source, we love open source

# tools you'll love
- `PDF` - Convert any file to PDF, merge & split, compress, sign, and turn pages into images
- `Image` - Compress, resize and convert (HEIC too), remove backgrounds, QR codes, image to text (OCR), crop for socials and passports
- `Media` - Video to MP3, shrink videos, GIF maker, audio cutter, screen recorder, webcam & mic test
- `Video downloader` - YouTube, Instagram, TikTok, X, Reddit, Pinterest and Facebook (the only tool that needs a server)
- `Text` - Word counter, case & cleanup tools, text compare, typing test
- `Everyday` - Password generator, time zones, timer & stopwatch, unit converter, calculators, wheel & random picker
- `Developer` - JSON, Base64, hashes, JWT, color palettes and contrast checker

# under the hood?
- Frontend - React, Vite
- PDFs - pdf-lib, pdf.js, jsPDF
- Background removal - transformers.js (runs in a web worker)
- Video & audio - ffmpeg.wasm
- OCR - tesseract.js
- Downloader API - Node + yt-dlp + ffmpeg
- Hosting - Vercel

# run it
Needs Node 20+, plus [ffmpeg](https://ffmpeg.org) for the video downloader. `yt-dlp` installs with the npm dependencies.

```sh
brew install ffmpeg    # macOS
npm install
npm run dev            # app on :5173, API on :8787
```

For production, use the included `Dockerfile` (one Node process, port `8787` or `PORT`). Don't use static-only hosting, the downloader needs a server.

# video downloader notes
- Paste a link, pick **Video (MP4)** or **Audio only (MP3)**. Single videos only, no playlists.
- Links are checked against an allowlist in `server/sites.js`, downloaded to a temp folder, streamed back and deleted. Nothing is stored.
- Limits: 3 downloads at once, 2 min timeout, 300 MB, 30 min length.
- TikTok needs `curl_cffi` next to yt-dlp (`pip install curl_cffi`).
- **Instagram or YouTube asking for a login?** Datacenter IPs get blocked, home connections don't. Route yt-dlp through a home machine:

```sh
# home machine on your tailnet
microsocks -i "$(tailscale ip -4)" -p 1080

# server
YTDLP_PROXY=socks5://<home-machine-tailscale-ip>:1080 npm start
```

- Last resort: `YTDLP_COOKIES_FROM_BROWSER=chrome` or `YTDLP_COOKIES=/path/to/cookies.txt` (use a throwaway account).
- If downloads break, refresh yt-dlp with `npm rebuild youtube-dl-exec`. Only download content you have the right to use.

# code map
- `src/tools/index.js` - the tool registry, add a tool here and it shows up in the sidebar, home and ⌘K menu
- `src/tools/*.jsx` - one file per tool
- `src/lib/` - shared logic (PDF work, conversion, background removal worker, ffmpeg engine)
- `server/` - downloader API and static server

# ❤️ Built With Intent
Handybits started as a weekend project, because most "free online tools" want your files. These don't.

# Contribute
if you want to contribute just raise a pull request, or want a tool cooked? open an issue
