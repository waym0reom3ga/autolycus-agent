import { useEffect, useState } from 'react'

import { getLogs, getStatus } from '@/hermes'
import type { StatusResponse } from '@/types/hermes'

const REFRESH_MS = 15_000
const LOG_TAIL = 12

export function useStatusSnapshot(gatewayState: string | undefined) {
  const [statusSnapshot, setStatusSnapshot] = useState<StatusResponse | null>(null)
  const [gatewayLogLines, setGatewayLogLines] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const [next, logs] = await Promise.all([
          getStatus(),
          getLogs({ file: 'gateway', lines: LOG_TAIL }).catch(() => ({ lines: [] }))
        ])

        if (cancelled) {
          return
        }

        setStatusSnapshot(next)
        setGatewayLogLines(logs.lines.map(line => line.trim()).filter(Boolean))
      } catch {
        // Keep last snapshot through transient gateway flaps.
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [gatewayState])

  return { gatewayLogLines, statusSnapshot }
}
