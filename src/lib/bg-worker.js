// Background removal worker. Runs a segmentation model with transformers.js
// and returns a low-resolution alpha mask; the page scales it up to the
// original image size and applies it, so the full-size pixels never have to
// pass through the model.
//
// Models (both permissively licensed, both fine for commercial use):
// - "general": onnx-community/BiRefNet_lite-ONNX — BiRefNet lite, MIT licence.
//   Dichotomous image segmentation, works on people, products, animals and
//   most clear subjects. Fixed 1024×1024 input. ~115 MB (fp16) or ~224 MB
//   (fp32). WebGPU only: on the WASM backend it runs out of memory.
// - "portrait": Xenova/modnet — MODNet, Apache-2.0 licence. Portrait matting,
//   only meant for people. ~26 MB. Runs on WebGPU or WASM.
// We deliberately avoid briaai/RMBG-1.4 and RMBG-2.0: their licences are
// non-commercial.

import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers'

env.allowLocalModels = false

// The page picks the model id, device and dtype (see BgRemover.jsx).
const cache = new Map() // `${id}:${device}:${dtype}` -> Promise<{ model, processor }>

function load(id, device, dtype) {
  const cacheKey = `${id}:${device}:${dtype}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const files = {}
  const progress_callback = (info) => {
    if (info.status !== 'progress' || !info.file) return
    files[info.file] = { loaded: info.loaded || 0, total: info.total || 0 }
    let loaded = 0
    let total = 0
    for (const f of Object.values(files)) {
      loaded += f.loaded
      total += f.total
    }
    self.postMessage({ type: 'progress', loaded, total })
  }
  const promise = Promise.all([
    AutoModel.from_pretrained(id, { device, dtype, progress_callback }),
    AutoProcessor.from_pretrained(id, { progress_callback }),
  ]).then(([model, processor]) => ({ model, processor }))
  promise.catch(() => cache.delete(cacheKey))
  cache.set(cacheKey, promise)
  return promise
}

async function segment({ model: id, device, dtype, blob }) {
  self.postMessage({ type: 'stage', stage: 'loading' })
  const { model, processor } = await load(id, device, dtype)
  self.postMessage({ type: 'stage', stage: 'running' })

  const image = await RawImage.fromBlob(blob)
  const inputs = await processor(image)
  const { inputNames, outputNames } = model.sessions.model
  // Some exported models name their single input something other than pixel_values.
  if (!inputNames.includes('pixel_values') && inputNames.length === 1) inputs[inputNames[0]] = inputs.pixel_values

  const output = await model(inputs)
  const tensor = output[outputNames[0]]
  const dims = tensor.dims
  const height = dims[dims.length - 2]
  const width = dims[dims.length - 1]
  const raw = tensor.data
  const n = width * height

  // Outputs are either probabilities already or logits; detect which.
  let needsSigmoid = false
  for (let i = 0; i < n; i++) {
    const v = Number(raw[i])
    if (v < -1e-5 || v > 1 + 1e-5) {
      needsSigmoid = true
      break
    }
  }
  const mask = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    const v = Number(raw[i])
    mask[i] = (needsSigmoid ? 1 / (1 + Math.exp(-v)) : v) * 255
  }
  if (typeof tensor.dispose === 'function') tensor.dispose()
  return { mask, width, height }
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'run') return
  try {
    const result = await segment(data)
    self.postMessage({ type: 'done', id: data.id, ...result }, [result.mask.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message || err) })
  }
}
