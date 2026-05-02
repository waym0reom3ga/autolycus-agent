import { useStore } from '@nanostores/react'
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback } from 'react'

import { SidebarProvider } from '@/components/ui/sidebar'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $inspectorOpen,
  $sidebarOpen,
  $sidebarWidth,
  setSidebarOpen,
  setSidebarResizing,
  setSidebarWidth
} from '@/store/layout'
import { $previewTarget } from '@/store/preview'
import { $connection } from '@/store/session'

import { TITLEBAR_HEIGHT, titlebarControlsPosition } from './titlebar'
import { TitlebarControls, type TitlebarTool } from './titlebar-controls'

interface AppShellProps {
  children: ReactNode
  inspectorWidth: string
  leftTitlebarTools?: readonly TitlebarTool[]
  previewWidth: string
  rightRailOpen: boolean
  settingsOpen: boolean
  sidebar: ReactNode
  titlebarTools?: readonly TitlebarTool[]
  onOpenSettings: () => void
  overlays?: ReactNode
}

export function AppShell({
  children,
  inspectorWidth,
  leftTitlebarTools,
  previewWidth,
  rightRailOpen,
  settingsOpen,
  sidebar,
  titlebarTools,
  onOpenSettings,
  overlays
}: AppShellProps) {
  const sidebarWidth = useStore($sidebarWidth)
  const connection = useStore($connection)
  const sidebarOpen = useStore($sidebarOpen)
  const inspectorOpen = useStore($inspectorOpen)
  const previewTarget = useStore($previewTarget)

  // The shell grid should describe visible app chrome only. Titlebar buttons
  // and draggable hit-zones are fixed overlays, so keeping an invisible grid
  // column for a closed sidebar pushes/clips the actual chat surface.
  const displayedSidebarWidth = sidebarOpen ? sidebarWidth : 0

  const titlebarControls = titlebarControlsPosition(connection?.windowButtonPosition)

  const titlebarContentInset = sidebarOpen
    ? 0
    : titlebarControls.left + TITLEBAR_HEIGHT + Math.round(TITLEBAR_HEIGHT / 2)

  const showPreviewRail = rightRailOpen && Boolean(previewTarget)
  const showInspectorRail = rightRailOpen && inspectorOpen

  const inspectorColumn = showInspectorRail ? 'var(--inspector-width)' : '0px'

  // Preview yields first because it is the widest rail; keep chat usable before
  // letting the webview consume horizontal space.
  const previewColumn = showPreviewRail
    ? `min(var(--preview-width), max(0px, calc(100vw - var(--sidebar-width) - ${showInspectorRail ? 'var(--inspector-width)' : '0px'} - var(--chat-min-width) - 3 * var(--shell-gap))))`
    : '0px'

  const titlebarToolCount = (titlebarTools?.filter(tool => !tool.hidden).length ?? 0) + (rightRailOpen ? 1 : 0) + 2

  // Always keep the shell as fixed columns because sidebar/chat/preview/inspector
  // are always rendered as grid children. Hidden rails collapse to 0px so they
  // don't float over the chat surface or reorder into a new row.
  const shellGridColumns = 'var(--sidebar-width) minmax(0,1fr) var(--preview-col) var(--inspector-col)'

  const hasSideGaps = sidebarOpen || showPreviewRail || showInspectorRail

  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setSidebarResizing(true)

      const startX = event.clientX
      const startWidth = sidebarWidth
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (moveEvent: PointerEvent) => {
        setSidebarWidth(startWidth + moveEvent.clientX - startX)
      }

      const handleUp = () => {
        setSidebarResizing(false)
        triggerHaptic('crisp')
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp, { once: true })
    },
    [sidebarWidth]
  )

  return (
    <SidebarProvider
      className="h-screen min-h-0 bg-background"
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={
        {
          '--inspector-width': inspectorWidth,
          '--preview-width': previewWidth,
          '--sidebar-width': `${displayedSidebarWidth}px`,
          '--chat-center-offset': '0px',
          '--shell-left-sidebar-width': `${displayedSidebarWidth}px`,
          '--shell-preview-pane-width': previewColumn,
          '--shell-right-sidebar-width': inspectorColumn,
          '--shell-right-region-width': 'calc(var(--shell-preview-pane-width) + var(--shell-right-sidebar-width))',
          '--shell-preview-toolbar-gap': showPreviewRail
            ? 'max(0px, calc(var(--shell-right-sidebar-width) - (3 * var(--titlebar-control-size)) + 0.2rem))'
            : '0px',
          '--titlebar-height': `${TITLEBAR_HEIGHT}px`,
          '--titlebar-content-inset': `${titlebarContentInset}px`,
          '--titlebar-controls-left': `${titlebarControls.left}px`,
          '--titlebar-controls-top': `${titlebarControls.top}px`,
          '--titlebar-tools-right': '0.75rem',
          '--titlebar-tools-width': `calc(${titlebarToolCount} * var(--titlebar-control-size) + var(--shell-preview-toolbar-gap))`
        } as CSSProperties
      }
    >
      <TitlebarControls
        leftTools={leftTitlebarTools}
        onOpenSettings={onOpenSettings}
        settingsOpen={settingsOpen}
        showInspectorToggle={rightRailOpen}
        tools={titlebarTools}
      />

      <main
        className={cn(
          'relative grid h-screen w-full overflow-hidden bg-background pr-0.75 pb-0.75 pt-0.75 transition-none',
          hasSideGaps ? 'gap-(--shell-gap)' : 'gap-0'
        )}
        style={
          {
            '--inspector-col': inspectorColumn,
            '--preview-col': previewColumn,
            gridTemplateColumns: shellGridColumns
          } as CSSProperties
        }
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-1 h-(--titlebar-height) w-(--titlebar-controls-left) [-webkit-app-region:drag]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 z-1 h-(--titlebar-height) left-[calc(var(--titlebar-controls-left)+(var(--titlebar-control-size)*2)+0.75rem)] right-[calc(var(--titlebar-tools-right)+var(--titlebar-tools-width)+0.75rem)] [-webkit-app-region:drag]"
        />

        {sidebar}

        {sidebarOpen && (
          <div
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            className="group absolute bottom-0 top-0 left-[calc(var(--sidebar-width)-0.5rem)] z-5 w-4 cursor-col-resize [-webkit-app-region:no-drag]"
            onPointerDown={startSidebarResize}
            role="separator"
            tabIndex={0}
          >
            <span className="absolute left-1/2 top-1/2 h-23 w-0.75 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/80 opacity-0 transition-opacity duration-100 group-hover:opacity-[0.65] group-focus-visible:opacity-[0.65]" />
          </div>
        )}

        {children}
      </main>

      {overlays}
    </SidebarProvider>
  )
}
