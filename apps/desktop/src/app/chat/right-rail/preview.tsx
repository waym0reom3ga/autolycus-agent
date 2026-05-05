import { useStore } from '@nanostores/react'

import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import {
  $filePreviewTarget,
  $previewReloadRequest,
  $previewTarget,
  dismissFilePreviewTarget,
  dismissPreviewTarget
} from '@/store/preview'

import { PreviewPane } from './preview-pane'

const INTRINSIC = 'clamp(18rem, 36vw, 38rem)'

// Track for <Pane id="preview">. Folds the intrinsic clamp with a min-floor
// against --chat-min-width so the chat surface never gets squeezed below it.
// Subtracts the project browser width so preview yields rather than crushing
// the chat when both right-side panes are open.
export const PREVIEW_RAIL_PANE_WIDTH = `min(${INTRINSIC}, max(0px, calc(100vw - var(--pane-chat-sidebar-width) - var(--pane-file-browser-width, 0px) - var(--chat-min-width))))`

interface ChatPreviewRailProps {
  onRestartServer?: (url: string, context?: string) => Promise<string>
  setTitlebarToolGroup?: SetTitlebarToolGroup
}

export function ChatPreviewRail({ onRestartServer, setTitlebarToolGroup }: ChatPreviewRailProps) {
  const previewReloadRequest = useStore($previewReloadRequest)
  const filePreviewTarget = useStore($filePreviewTarget)
  const previewTarget = useStore($previewTarget)
  const target = filePreviewTarget ?? previewTarget

  if (!target) {return null}

  return (
    <PreviewPane
      onClose={filePreviewTarget ? dismissFilePreviewTarget : dismissPreviewTarget}
      onRestartServer={filePreviewTarget ? undefined : onRestartServer}
      reloadRequest={previewReloadRequest}
      setTitlebarToolGroup={setTitlebarToolGroup}
      target={target}
    />
  )
}
