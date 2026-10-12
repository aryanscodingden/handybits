// Tesseract OCR, served entirely from this site for English. Loaded on demand
// by the Image to text tool, so none of this is in the main bundle.
//
// tesseract.js normally pulls its worker, WASM core and language data from
// jsDelivr. Here each piece is a Vite asset instead:
// - the worker script and the WASM core (the .wasm.js builds embed the WASM,
//   so nothing else is fetched) are passed as explicit URLs;
// - the English data has a hashed file name, which tesseract.js can't be told
//   about (it always requests `<langPath>/<lang>.traineddata.gz`), so the
//   worker starts from a tiny shim that maps that one request to our asset.
// Other languages are opt-in and come from jsDelivr, which the tool says
// before anything is fetched.

import { createWorker } from 'tesseract.js'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import coreRelaxedSimd from 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js?url'
import coreSimd from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import corePlain from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'
import engData from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url'

const abs = (u) => new URL(u, location.href).href

// Feature probes from wasm-feature-detect (MIT).
const RELAXED_SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11])
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])

function pickCore() {
  try {
    if (WebAssembly.validate(RELAXED_SIMD)) return coreRelaxedSimd
    if (WebAssembly.validate(SIMD)) return coreSimd
  } catch {
    // Fall through to the plain build.
  }
  return corePlain
}

const LOCAL_LANG_PATH = () => `${location.origin}/__ocr-data`
const CDN_LANG_PATH = (code) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}/4.0.0_best_int`

function shimUrl() {
  const from = `${LOCAL_LANG_PATH()}/eng.traineddata.gz`
  const src = [
    `var FROM=${JSON.stringify(from)},TO=${JSON.stringify(abs(engData))};`,
    'var f=self.fetch.bind(self);',
    'self.fetch=function(u,o){return f(String(u&&u.url||u)===FROM?TO:u,o)};',
    `importScripts(${JSON.stringify(abs(workerUrl))});`,
  ].join('')
  return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
}

// Creates a worker for one language code. `onProgress({ status, progress })`.
export async function createOcr(lang, onProgress) {
  const shim = shimUrl()
  let failed = null
  try {
    const worker = await createWorker(lang, 1, {
      workerPath: shim,
      workerBlobURL: false,
      corePath: abs(pickCore()),
      langPath: lang === 'eng' ? LOCAL_LANG_PATH() : CDN_LANG_PATH(lang),
      gzip: true,
      logger: (m) => onProgress?.(m),
      errorHandler: (e) => {
        failed = e
      },
    })
    return {
      async recognize(blob) {
        failed = null
        const { data } = await worker.recognize(blob, {}, { text: true, blocks: true })
        if (failed) throw new Error(String(failed))
        return data
      },
      terminate: () => worker.terminate(),
    }
  } finally {
    // The worker has loaded the shim by the time createWorker resolves.
    setTimeout(() => URL.revokeObjectURL(shim), 5000)
  }
}

// Flattens tesseract's blocks into words with pixel boxes.
export function wordsOf(data) {
  const words = []
  for (const block of data.blocks || [])
    for (const para of block.paragraphs || [])
      for (const line of para.lines || [])
        for (const w of line.words || []) {
          const text = (w.text || '').trim()
          if (text) words.push({ text, confidence: w.confidence, box: w.bbox })
        }
  return words
}
