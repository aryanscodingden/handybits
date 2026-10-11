# PDF Toolkit

Convert any file to PDF, entirely in the browser. Nothing is uploaded.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/, host anywhere
```

## What it converts

| Input | How |
| --- | --- |
| PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, ICO (HEIC in Safari) | One image per page, page orientation follows the image |
| Word (.docx) | mammoth → HTML → rendered pages |
| Excel (.xlsx, .xls, .ods), CSV/TSV | SheetJS → tables, one section per sheet (first 5,000 rows) |
| Markdown, HTML | Rendered pages |
| Plain text, code, JSON | Real, selectable PDF text (JSON is pretty-printed) |
| PDF | Passed through as-is |

Not supported: PowerPoint/Keynote, legacy .doc, RTF, ODT, archives, audio/video. The app says why when you add one.

File types are detected from the file's **bytes** (magic numbers, zip contents), not just the extension, so a PNG named `photo.txt` is still treated as a PNG.

## Privacy and storage

- All conversion runs locally in the browser. Rich documents are rendered in a sandboxed iframe with scripts disabled and a Content Security Policy that blocks all network requests. Remote images and links to remote resources are stripped first.
- The **file index** (name, size, pages, expiry) is kept in `localStorage` under `pdf-toolkit:files`.
- The **PDF bytes** are kept in IndexedDB (`pdf-toolkit` database), because `localStorage` only holds about 5 MB.
- Every file expires **3 days** after it's created. Expired files are removed from both stores when the page loads and once a minute while it's open.

## Code map

- `src/lib/detect.js`: file type detection
- `src/lib/convert.js`: converters (lazy-loaded on first convert)
- `src/lib/storage.js`: localStorage index + IndexedDB storage, 3-day expiry
- `src/App.jsx`: UI

## Known limits

- Word, Excel, Markdown and HTML files are converted to page **images** (about 144 dpi), so their text isn't selectable and they run about 150–300 KB per page. Plain text and code produce real text PDFs. Text with non-Latin characters falls back to images too, so every glyph renders.
- Word conversion keeps structure (headings, lists, tables, images) but not exact Word layout (headers/footers, columns, page setup).
