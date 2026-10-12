// Every tool, in sidebar order. Each one is loaded only when it's opened, so
// adding a tool doesn't make the first page load any heavier.

import { lazy } from 'react'
import {
  Article,
  ArrowsInSimple,
  CloudArrowDown,
  FilePdf,
  Files,
  FilmSlate,
  GlobeHemisphereWest,
  Image,
  Password,
  QrCode,
  SelectionBackground,
  Signature,
  TextAa,
} from '@phosphor-icons/react'

export const GROUPS = ['PDF', 'Image', 'Media', 'Text', 'Everyday']

const tool = (def) => ({ ...def, component: lazy(def.load) })

export const TOOLS = [
  tool({
    id: 'pdf',
    label: 'Convert to PDF',
    hint: 'Any file to PDF',
    icon: FilePdf,
    group: 'PDF',
    keywords: 'convert word docx excel image jpg png markdown html',
    load: () => import('./PdfTool.jsx'),
  }),
  tool({
    id: 'pdf-organize',
    label: 'Merge & split PDF',
    hint: 'Combine, reorder, rotate',
    icon: Files,
    group: 'PDF',
    keywords: 'merge combine join split extract reorder rotate delete pages organize',
    load: () => import('./PdfOrganize.jsx'),
  }),
  tool({
    id: 'pdf-compress',
    label: 'Compress PDF',
    hint: 'Make PDFs smaller',
    icon: ArrowsInSimple,
    group: 'PDF',
    keywords: 'compress reduce shrink size email smaller',
    load: () => import('./PdfCompress.jsx'),
  }),
  tool({
    id: 'pdf-sign',
    label: 'Sign PDF',
    hint: 'Add your signature',
    icon: Signature,
    group: 'PDF',
    keywords: 'sign signature initials fill form esign',
    load: () => import('./SignPdf.jsx'),
  }),
  tool({
    id: 'images',
    label: 'Compress images',
    hint: 'Resize, convert, HEIC',
    icon: Image,
    group: 'Image',
    keywords: 'compress resize convert jpg jpeg png webp avif heic iphone photo optimize',
    load: () => import('./ImageTool.jsx'),
  }),
  tool({
    id: 'remove-bg',
    label: 'Remove background',
    hint: 'Transparent PNG cut-outs',
    icon: SelectionBackground,
    group: 'Image',
    keywords: 'remove background cutout transparent png remove.bg erase',
    load: () => import('./BgRemover.jsx'),
  }),
  tool({
    id: 'qr',
    label: 'QR code',
    hint: 'Links, Wi-Fi, contacts',
    icon: QrCode,
    group: 'Image',
    keywords: 'qr code generator barcode wifi vcard link',
    load: () => import('./QrTool.jsx'),
  }),
  tool({
    id: 'download',
    aliases: ['instagram'],
    label: 'Video downloader',
    hint: 'Instagram, TikTok, X, Reddit',
    icon: CloudArrowDown,
    group: 'Media',
    keywords: 'download instagram reel tiktok twitter x reddit pinterest facebook video audio mp3',
    load: () => import('./Downloader.jsx'),
  }),
  tool({
    id: 'video',
    label: 'Video to MP3',
    hint: 'Extract audio, shrink video',
    icon: FilmSlate,
    group: 'Media',
    keywords: 'video mp3 audio extract compress shrink discord whatsapp mp4 convert',
    load: () => import('./VideoTool.jsx'),
  }),
  tool({
    id: 'words',
    label: 'Word counter',
    hint: 'Words, characters, reading time',
    icon: Article,
    group: 'Text',
    keywords: 'word count character count reading time essay sentences',
    load: () => import('./WordCounter.jsx'),
  }),
  tool({
    id: 'text',
    label: 'Text tools',
    hint: 'Case, cleanup, compare',
    icon: TextAa,
    group: 'Text',
    keywords: 'uppercase lowercase title case sentence remove line breaks spaces sort dedupe diff compare',
    load: () => import('./TextTools.jsx'),
  }),
  tool({
    id: 'passwords',
    label: 'Password generator',
    hint: 'Strong passwords, passphrases',
    icon: Password,
    group: 'Everyday',
    keywords: 'password generator passphrase random secure',
    load: () => import('./Passwords.jsx'),
  }),
  tool({
    id: 'timezones',
    label: 'Time zones',
    hint: 'Convert times, plan meetings',
    icon: GlobeHemisphereWest,
    group: 'Everyday',
    keywords: 'time zone converter meeting planner world clock utc',
    load: () => import('./TimeZones.jsx'),
  }),
]

export function findTool(id) {
  return TOOLS.find((t) => t.id === id || t.aliases?.includes(id)) || null
}

// Preload a tool's code before it's opened, e.g. on hover.
export function preload(t) {
  t.load().catch(() => {})
}

const RECENT_KEY = 'handybits:recent'

export function readRecent() {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return ids.map(findTool).filter(Boolean)
  } catch {
    return []
  }
}

export function markRecent(id) {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => x !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...ids].slice(0, 4)))
  } catch {
    // Storage can be unavailable (private mode); recents are optional.
  }
}
