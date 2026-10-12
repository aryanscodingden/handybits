// Small hooks shared by the text and everyday tools.
import { useCallback, useEffect, useRef, useState } from 'react'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

// useState that is saved to localStorage, debounced so typing stays smooth.
export function useStoredState(key, initial, delay = 300) {
  const [value, setValue] = useState(() => read(key, typeof initial === 'function' ? initial() : initial))
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // Storage may be full or unavailable; the tool still works.
      }
    }, delay)
    return () => clearTimeout(id)
  }, [key, value, delay])
  return [value, setValue]
}

// copy(text, id) -> copied === id for ~1.6s. Returns false if the browser refused.
export function useCopy() {
  const [copied, setCopied] = useState(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback(async (text, id = true) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    clearTimeout(timer.current)
    setCopied(id)
    timer.current = setTimeout(() => setCopied(null), 1600)
    return true
  }, [])
  return [copied, copy]
}

// Grow a textarea with its content, between its CSS min-height and maxPx.
export function useAutosize(ref, value, maxPx = 640) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, maxPx)}px`
  }, [ref, value, maxPx])
}

export const nf = new Intl.NumberFormat()
