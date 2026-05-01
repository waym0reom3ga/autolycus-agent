import { useEffect, useRef, useState } from 'react'

const ELAPSED_TICK_MS = 1000

export function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60

  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function useElapsedSeconds(active = true): number {
  const startedAt = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }

    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)))
    }

    update()
    const id = window.setInterval(update, ELAPSED_TICK_MS)

    return () => window.clearInterval(id)
  }, [active])

  return elapsed
}
