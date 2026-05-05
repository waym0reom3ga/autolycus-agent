import { type MutableRefObject, useCallback } from 'react'

import { notify, notifyError } from '@/store/notifications'
import { $currentCwd, setCurrentBranch, setCurrentCwd } from '@/store/session'
import type { SessionRuntimeInfo } from '@/types/hermes'

interface CwdActionsOptions {
  activeSessionId: string | null
  activeSessionIdRef: MutableRefObject<string | null>
  currentCwd: string
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function useCwdActions({ activeSessionId, activeSessionIdRef, currentCwd, requestGateway }: CwdActionsOptions) {
  const refreshProjectBranch = useCallback(
    async (cwd: string) => {
      const target = cwd.trim()

      if (!target || activeSessionIdRef.current) {
        return
      }

      try {
        const info = await requestGateway<{ branch?: string; cwd?: string }>('config.get', {
          key: 'project',
          cwd: target
        })

        if (!activeSessionIdRef.current && ($currentCwd.get() || target) === (info.cwd || target)) {
          setCurrentBranch(info.branch || '')
        }
      } catch {
        setCurrentBranch('')
      }
    },
    [activeSessionIdRef, requestGateway]
  )

  const changeSessionCwd = useCallback(
    async (cwd: string) => {
      const trimmed = cwd.trim()

      if (!trimmed) {
        return
      }

      const persistGlobal = async () => {
        const info = await requestGateway<{ branch?: string; cwd?: string; value?: string }>('config.set', {
          ...(activeSessionId && { session_id: activeSessionId }),
          key: 'terminal.cwd',
          value: trimmed
        })

        setCurrentCwd(info.cwd || info.value || trimmed)

        if (!activeSessionId) {
          setCurrentBranch(info.branch || '')
        }
      }

      if (!activeSessionId) {
        try {
          await persistGlobal()
        } catch (err) {
          notifyError(err, 'Working directory change failed')
        }

        return
      }

      try {
        const info = await requestGateway<SessionRuntimeInfo>('session.cwd.set', {
          session_id: activeSessionId,
          cwd: trimmed
        })

        setCurrentCwd(info.cwd || trimmed)
        setCurrentBranch(info.branch || '')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        // Older gateways without `session.cwd.set` fall back to a global write —
        // user has to restart the active session for it to take effect.
        if (!message.includes('unknown method')) {
          notifyError(err, 'Working directory change failed')

          return
        }

        try {
          await persistGlobal()
          notify({
            kind: 'warning',
            title: 'Working directory saved',
            message: 'Restart the desktop backend to apply cwd changes to this active session.'
          })
        } catch (fallbackErr) {
          notifyError(fallbackErr, 'Working directory change failed')
        }
      }
    },
    [activeSessionId, requestGateway]
  )

  const browseSessionCwd = useCallback(async () => {
    const paths = await window.hermesDesktop?.selectPaths({
      title: 'Change working directory',
      defaultPath: currentCwd || undefined,
      directories: true,
      multiple: false
    })

    if (paths?.[0]) {
      await changeSessionCwd(paths[0])
    }
  }, [changeSessionCwd, currentCwd])

  return { browseSessionCwd, changeSessionCwd, refreshProjectBranch }
}
