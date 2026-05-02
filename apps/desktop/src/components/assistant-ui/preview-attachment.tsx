import { useStore } from '@nanostores/react'
import { MonitorPlay } from 'lucide-react'
import { useState } from 'react'

import { previewName } from '@/lib/preview-targets'
import { notifyError } from '@/store/notifications'
import { $previewTarget, setPreviewTarget } from '@/store/preview'
import { $currentCwd } from '@/store/session'

export function PreviewAttachment({ target }: { target: string }) {
  const cwd = useStore($currentCwd)
  const activePreview = useStore($previewTarget)
  const [opening, setOpening] = useState(false)
  const name = previewName(target)
  const isActive = activePreview?.source === target

  function localFallbackPreview() {
    if (/^https?:\/\//i.test(target)) {
      return { kind: 'url' as const, label: previewName(target), source: target, url: target }
    }

    if (/^file:\/\//i.test(target)) {
      return { kind: 'file' as const, label: previewName(target), source: target, url: target }
    }

    if (/^(?:\/|\.{1,2}\/|~\/).+\.html?$/i.test(target)) {
      const path = target.startsWith('file://') ? target : `file://${encodeURI(target)}`

      return { kind: 'file' as const, label: previewName(target), source: target, url: path }
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

    setOpening(true)

    try {
      const preview = await window.hermesDesktop?.normalizePreviewTarget(target, cwd || undefined).catch(error => {
        if (isMissingPreviewIpc(error)) {
          return localFallbackPreview()
        }

        throw error
      })

      if (!preview) {
        throw new Error(`Could not open preview target: ${target}`)
      }

      setPreviewTarget(preview)
    } catch (error) {
      notifyError(error, 'Preview unavailable')
    } finally {
      setOpening(false)
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
