import { useEffect } from 'react'

import { HermesGateway } from '@/hermes'
import { notify, notifyError } from '@/store/notifications'
import { setConnection, setGatewayState, setSessionsLoading } from '@/store/session'
import type { RpcEvent } from '@/types/hermes'

interface GatewayBootOptions {
  handleGatewayEvent: (event: RpcEvent) => void
  onConnectionReady: (connection: Awaited<ReturnType<NonNullable<typeof window.hermesDesktop>['getConnection']>> | null) => void
  onGatewayReady: (gateway: HermesGateway | null) => void
  refreshHermesConfig: () => Promise<void>
  refreshSessions: () => Promise<void>
}

export function useGatewayBoot({
  handleGatewayEvent,
  onConnectionReady,
  onGatewayReady,
  refreshHermesConfig,
  refreshSessions
}: GatewayBootOptions) {
  useEffect(() => {
    let cancelled = false
    const desktop = window.hermesDesktop

    if (!desktop) {
      setSessionsLoading(false)

      return () => void (cancelled = true)
    }

    const gateway = new HermesGateway()
    onGatewayReady(gateway)

    const offState = gateway.onState(st => void setGatewayState(st))
    const offEvent = gateway.onEvent(handleGatewayEvent)

    const offExit = desktop.onBackendExit(() => {
      notify({
        kind: 'error',
        title: 'Backend stopped',
        message: 'Hermes background process exited.',
        durationMs: 0
      })
    })

    async function boot() {
      try {
        const conn = await desktop.getConnection()

        if (cancelled) {
          return
        }

        onConnectionReady(conn)
        setConnection(conn)
        await gateway.connect(conn.wsUrl)

        if (cancelled) {
          return
        }

        await refreshHermesConfig()

        if (cancelled) {
          return
        }

        await refreshSessions()
      } catch (err) {
        if (!cancelled) {
          notifyError(err, 'Desktop boot failed')
          setSessionsLoading(false)
        }
      }
    }

    void boot()

    return () => {
      cancelled = true
      offState()
      offEvent()
      offExit()
      gateway.close()
      onConnectionReady(null)
      onGatewayReady(null)
    }
  }, [
    handleGatewayEvent,
    onConnectionReady,
    onGatewayReady,
    refreshHermesConfig,
    refreshSessions
  ])
}
