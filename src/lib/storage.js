// Everything stays on this device.
// - File index (names, sizes, expiry) lives in localStorage.
// - File bytes live in IndexedDB, because localStorage is capped at ~5 MB.
// Nothing is ever sent over the network.

export const RETENTION_MS = 3 * 24 * 60 * 60 * 1000

const INDEX_KEY = 'pdf-toolkit:files'
const DB_NAME = 'pdf-toolkit'
const STORE = 'pdfs'

let dbPromise = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function tx(mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const result = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(result?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export function readIndex() {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list))
}

// Files are shared by every tool; `tool` says which one made them. Entries
// saved before tools were tagged all came from the PDF converter.
export function forTool(list, tool) {
  return list.filter((f) => (f.tool || 'pdf') === tool)
}

export async function saveFile(meta, blob) {
  const now = Date.now()
  const entry = { ...meta, createdAt: now, expiresAt: now + RETENTION_MS }
  await tx('readwrite', (s) => s.put(blob, entry.id))
  writeIndex([entry, ...readIndex()])
  return entry
}

export async function getBlob(id) {
  return tx('readonly', (s) => s.get(id))
}

export async function deleteFile(id) {
  writeIndex(readIndex().filter((f) => f.id !== id))
  await tx('readwrite', (s) => s.delete(id))
}

export async function clearAll() {
  writeIndex([])
  await tx('readwrite', (s) => s.clear())
}

// Drops expired entries, plus any stored bytes that no longer have an index
// entry (e.g. if localStorage was cleared by the user).
export async function purgeExpired() {
  const now = Date.now()
  const list = readIndex()
  const alive = list.filter((f) => f.expiresAt > now)
  if (alive.length !== list.length) writeIndex(alive)

  const keep = new Set(alive.map((f) => f.id))
  const keys = (await tx('readonly', (s) => s.getAllKeys())) || []
  const stale = keys.filter((k) => !keep.has(k))
  if (stale.length) await tx('readwrite', (s) => stale.forEach((k) => s.delete(k)))

  // Index entries whose bytes are missing can't be downloaded; drop them too.
  const present = new Set(keys)
  const usable = alive.filter((f) => present.has(f.id))
  if (usable.length !== alive.length) writeIndex(usable)
  return usable
}
