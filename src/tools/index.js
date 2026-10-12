// Every tool, in sidebar order. Each one is loaded only when it's opened, so
// adding a tool doesn't make the first page load any heavier.

import { lazy } from 'react'
import {
  Article,
  BracketsCurly,
  Calculator,
  Crop,
  DiceFive,
  FileImage,
  Gif,
  Keyboard,
  Palette,
  Record,
  Ruler,
  Scan,
  Timer,
  Waveform,
  Webcam,
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

export const GROUPS = ['PDF', 'Image', 'Media', 'Text', 'Everyday', 'Developer']

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
    id: 'pdf-to-images',
    label: 'PDF to images',
    hint: 'Pages to JPG or PNG',
    icon: FileImage,
    group: 'PDF',
    keywords: 'pdf to jpg png image convert export pages',
    load: () => import('./PdfToImages.jsx'),
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
    id: 'ocr',
    label: 'Image to text',
    hint: 'Copy text from pictures',
    icon: Scan,
    group: 'Image',
    keywords: 'ocr image to text extract text screenshot scan photo recognize',
    load: () => import('./OcrTool.jsx'),
  }),
  tool({
    id: 'crop',
    label: 'Crop & resize',
    hint: 'Sizes for social and passports',
    icon: Crop,
    group: 'Image',
    keywords: 'crop resize instagram story youtube thumbnail profile picture passport photo rotate flip',
    load: () => import('./CropTool.jsx'),
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
    id: 'gif',
    label: 'GIF maker',
    hint: 'Video or images to GIF',
    icon: Gif,
    group: 'Media',
    keywords: 'gif maker video to gif animated images to gif',
    load: () => import('./GifMaker.jsx'),
  }),
  tool({
    id: 'audio-cut',
    label: 'Audio cutter',
    hint: 'Trim audio, make ringtones',
    icon: Waveform,
    group: 'Media',
    keywords: 'audio cutter trim mp3 ringtone m4r fade cut song voice note',
    load: () => import('./AudioCutter.jsx'),
  }),
  tool({
    id: 'record',
    label: 'Screen recorder',
    hint: 'Record your screen and camera',
    icon: Record,
    group: 'Media',
    keywords: 'screen recorder record screen capture tab window webcam loom',
    load: () => import('./ScreenRecorder.jsx'),
  }),
  tool({
    id: 'device-test',
    label: 'Webcam & mic test',
    hint: 'Check camera, mic, speakers',
    icon: Webcam,
    group: 'Media',
    keywords: 'webcam test camera microphone mic test speakers audio check zoom call',
    load: () => import('./DeviceTest.jsx'),
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
    id: 'typing',
    label: 'Typing test',
    hint: 'Words per minute, accuracy',
    icon: Keyboard,
    group: 'Text',
    keywords: 'typing test speed wpm accuracy keyboard practice',
    load: () => import('./TypingTest.jsx'),
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
  tool({
    id: 'timer',
    label: 'Timer & stopwatch',
    hint: 'Countdown, laps, Pomodoro',
    icon: Timer,
    group: 'Everyday',
    keywords: 'timer stopwatch countdown pomodoro alarm laps focus',
    load: () => import('./TimerTool.jsx'),
  }),
  tool({
    id: 'units',
    label: 'Unit converter',
    hint: 'Length, weight, temperature',
    icon: Ruler,
    group: 'Everyday',
    keywords: 'unit converter length weight temperature volume speed area data cooking cm inch kg lb celsius fahrenheit',
    load: () => import('./UnitConverter.jsx'),
  }),
  tool({
    id: 'calc',
    label: 'Calculators',
    hint: 'Percent, age, tip, GPA',
    icon: Calculator,
    group: 'Everyday',
    keywords: 'calculator percentage age date difference tip split bill discount tax gpa',
    load: () => import('./Calculators.jsx'),
  }),
  tool({
    id: 'wheel',
    label: 'Wheel & random picker',
    hint: 'Spin, flip, roll, pick',
    icon: DiceFive,
    group: 'Everyday',
    keywords: 'wheel spinner random name picker coin flip dice roll random number teams',
    load: () => import('./WheelPicker.jsx'),
  }),
  tool({
    id: 'dev',
    label: 'Developer tools',
    hint: 'JSON, Base64, hashes, JWT',
    icon: BracketsCurly,
    group: 'Developer',
    keywords: 'json formatter validator base64 url encode decode uuid hash sha256 jwt decoder unix timestamp',
    load: () => import('./DevTools.jsx'),
  }),
  tool({
    id: 'color',
    label: 'Color tools',
    hint: 'Palettes, picker, contrast',
    icon: Palette,
    group: 'Developer',
    keywords: 'color picker palette from image hex rgb hsl oklch contrast checker wcag',
    load: () => import('./ColorTools.jsx'),
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
