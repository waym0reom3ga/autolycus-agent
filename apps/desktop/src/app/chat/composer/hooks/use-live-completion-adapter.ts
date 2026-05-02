import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface CompletionEntry {
  text: string
  display?: unknown
  meta?: unknown
}

export interface CompletionPayload {
  items: CompletionEntry[]
  query: string
}

/**
 * Drives an assistant-ui `Unstable_TriggerAdapter` from an async RPC call.
 *
 * Mirrors the TUI's `useCompletion` flow: each query change schedules a
 * debounced fetch (default 60ms) and the adapter synchronously returns the
 * most recent items while the user keeps typing. When the fetch resolves we
 * store the new items + the query they belong to, which causes a re-render
 * with a fresh adapter instance — `Unstable_TriggerPopover` then re-runs its
 * `search()` and shows the latest results.
 */
export function useLiveCompletionAdapter(options: {
  enabled: boolean
  debounceMs?: number
  fetcher: (query: string) => Promise<CompletionPayload>
  toItem: (entry: CompletionEntry, index: number) => Unstable_TriggerItem
}): { adapter: Unstable_TriggerAdapter; loading: boolean } {
  const { enabled, debounceMs = 60, fetcher, toItem } = options

  const [state, setState] = useState<{ query: string; items: Unstable_TriggerItem[] }>({
    query: '\u0000',
    items: []
  })

  const [loading, setLoading] = useState(false)

  const tokenRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const pendingQueryRef = useRef<string | null>(null)

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => () => cancelTimer(), [cancelTimer])

  const scheduleFetch = useCallback(
    (query: string) => {
      if (!enabled) {
        return
      }

      if (pendingQueryRef.current === query) {
        return
      }

      pendingQueryRef.current = query
      cancelTimer()
      const token = ++tokenRef.current
      setLoading(true)

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null

        fetcher(query)
          .then(payload => {
            if (token !== tokenRef.current) {
              return
            }

            setState({
              query: payload.query,
              items: payload.items.map((entry, index) => toItem(entry, index))
            })
          })
          .catch(() => {
            if (token !== tokenRef.current) {
              return
            }

            setState({ query, items: [] })
          })
          .finally(() => {
            if (token === tokenRef.current) {
              setLoading(false)
            }
          })
      }, debounceMs)
    },
    [cancelTimer, debounceMs, enabled, fetcher, toItem]
  )

  const adapter = useMemo<Unstable_TriggerAdapter>(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (query: string) => {
        if (query !== state.query) {
          scheduleFetch(query)
        }

        return state.items
      }
    }),
    [scheduleFetch, state]
  )

  return { adapter, loading }
}
