import { useCallback, useRef, useState } from 'react'

/** 실행 취소/다시 실행. 같은 key로 연속 변경(슬라이더 등)은 하나로 묶는다. */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState({ past: [] as T[], present: initial, future: [] as T[] })
  const last = useRef<{ key?: string; time: number }>({ time: 0 })

  const set = useCallback((next: T | ((prev: T) => T), key?: string) => {
    const now = Date.now()
    const merge = key !== undefined && key === last.current.key && now - last.current.time < 800
    last.current = { key, time: now }
    setH((s) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(s.present) : next
      if (merge) return { ...s, present: value }
      return { past: [...s.past, s.present].slice(-100), present: value, future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    last.current = { time: 0 }
    setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s))
  }, [])
  const redo = useCallback(() => {
    last.current = { time: 0 }
    setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s))
  }, [])

  return { state: h.present, set, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}
