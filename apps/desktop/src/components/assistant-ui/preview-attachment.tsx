import { useStore } from '@nanostores/react'
import { MonitorPlay } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { previewName } from '@/lib/preview-targets'
import { notifyError } from '@/store/notifications'
import { $previewTarget, setPreviewTarget } from '@/store/preview'
import { $currentCwd } from '@/store/session'

export function PreviewAttachment({ target }: { target: string }) {
  const cwd = useStore($currentCwd)
  const activePreview = useStore($previewTarget)
  const [opening, setOpening] = useState(false)
  const activePreviewRef = useRef(activePreview)
  const cwdRef = useRef(cwd)
  const mountedRef = useRef(false)
  const requestTokenRef = useRef(0)
  const targetRef = useRef(target)
  const name = previewName(target)
  const isActive = activePreview?.source === target

  activePreviewRef.current = activePreview
  cwdRef.current = cwd
  targetRef.current = target

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      requestTokenRef.current += 1
    }
  }, [])

  useEffect(() => {
    requestTokenRef.current += 1
    setOpening(false)
  }, [cwd, target])

  function localFallbackPreview(value: string) {
    if (/^https?:\/\//i.test(value)) {
      return { kind: 'url' as const, label: previewName(value), source: value, url: value }
    }

    if (/^file:\/\//i.test(value)) {
      return { kind: 'file' as const, label: previewName(value), source: value, url: value }
    }

    if (/^(?:\/|\.{1,2}\/|~\/).+\.html?$/i.test(value)) {
      const path = value.startsWith('file://') ? value : `file://${encodeURI(value)}`

      return { kind: 'file' as const, label: previewName(value), source: value, url: path }
    }

    return null
  }

  function isMissingPreviewIpc(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

    return message.includes("No handler registered for 'hermes:normalizePreviewTarget'")
  }

  async function togglePreview() {
    if (opening) {
      return
    }

    if (isActive) {
      setPreviewTarget(null)

      return
    }

    const requestToken = ++requestTokenRef.current
    const requestTarget = target
    const requestCwd = cwd

    setOpening(true)

    try {
      const preview = await window.hermesDesktop?.normalizePreviewTarget(requestTarget, requestCwd || undefined).catch(error => {
        if (isMissingPreviewIpc(error)) {
          return localFallbackPreview(requestTarget)
        }

        throw error
      })

      if (
        !mountedRef.current ||
        requestTokenRef.current !== requestToken ||
        targetRef.current !== requestTarget ||
        cwdRef.current !== requestCwd
      ) {
        return
      }

      if (!preview) {
        throw new Error(`Could not open preview target: ${requestTarget}`)
      }

      const currentPreview = activePreviewRef.current

      if (currentPreview?.source === preview.source && currentPreview.url === preview.url) {
        return
      }

      setPreviewTarget(preview)
    } catch (error) {
      if (
        !mountedRef.current ||
        requestTokenRef.current !== requestToken ||
        targetRef.current !== requestTarget ||
        cwdRef.current !== requestCwd
      ) {
        return
      }

      notifyError(error, 'Preview unavailable')
    } finally {
      if (mountedRef.current && requestTokenRef.current === requestToken) {
        setOpening(false)
      }
    }
  }

  return (
    <div className="inline-flex max-w-[min(100%,32rem)] items-center gap-3 rounded-xl border border-border/70 bg-card/70 p-3 text-sm">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
        <MonitorPlay className="size-4" />
      </div>
      <div className="min-w-0 max-w-64">
        <div className="truncate font-medium text-foreground">{name}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{target}</div>
      </div>
      <button
        className="shrink-0 rounded-lg border border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        disabled={opening}
        onClick={() => void togglePreview()}
        type="button"
      >
        {opening ? 'Opening...' : isActive ? 'Hide Preview' : 'Toggle Preview'}
      </button>
    </div>
  )
}
