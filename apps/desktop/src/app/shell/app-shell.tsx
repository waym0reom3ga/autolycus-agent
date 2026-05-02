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
import { TitlebarControls } from './titlebar-controls'

interface AppShellProps {
  children: ReactNode
  inspectorWidth: string
  rightRailOpen: boolean
  settingsOpen: boolean
  sidebar: ReactNode
  titlebarActions?: ReactNode
  onOpenSettings: () => void
  overlays?: ReactNode
}

export function AppShell({
  children,
  inspectorWidth,
  rightRailOpen,
  settingsOpen,
  sidebar,
  titlebarActions,
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
  const titlebarContentInset = titlebarControls.left + TITLEBAR_HEIGHT + Math.round(TITLEBAR_HEIGHT / 2)
  const showRightRail = rightRailOpen && (inspectorOpen || Boolean(previewTarget))

  // Right rail yields to chat min-width before the chat column starts crushing the composer.
  const inspectorColumn = showRightRail
    ? 'min(var(--inspector-width), max(0px, calc(100vw - var(--sidebar-width) - var(--chat-min-width) - 2 * var(--shell-gap))))'
    : '0px'
  // Always keep the shell as 3 columns because the sidebar and chat are
  // always rendered as grid children. Collapsing to a single grid column
  // makes the hidden sidebar occupy row 1 and pushes chat into row 2, which
  // looks like a blank/white screen when closing the preview with sidebars
  // hidden. Centering is handled by setting closed side columns to 0px.
  const shellGridColumns = 'var(--sidebar-width) minmax(0,1fr) var(--inspector-col)'

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
          '--sidebar-width': `${displayedSidebarWidth}px`,
          '--chat-center-offset': '0px',
          '--titlebar-height': `${TITLEBAR_HEIGHT}px`,
          '--titlebar-content-inset': `${titlebarContentInset}px`,
          '--titlebar-controls-left': `${titlebarControls.left}px`,
          '--titlebar-controls-top': `${titlebarControls.top}px`
        } as CSSProperties
      }
    >
      <TitlebarControls
        leadingActions={titlebarActions}
        onOpenSettings={onOpenSettings}
        settingsOpen={settingsOpen}
        showInspectorToggle={rightRailOpen}
      />

      <main
        className={cn(
          'relative grid h-screen w-full overflow-hidden bg-background pr-0.75 pb-0.75 pt-0.75 transition-none',
          sidebarOpen || showRightRail ? 'gap-(--shell-gap)' : 'gap-0'
        )}
        style={
          {
            '--inspector-width': inspectorWidth,
            '--inspector-col': inspectorColumn,
            gridTemplateColumns: shellGridColumns
          } as CSSProperties
        }
      >
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 z-1 h-(--titlebar-height) w-(--titlebar-controls-left) [-webkit-app-region:drag]"
        />
        <div
          aria-hidden="true"
          className="absolute right-20 top-0 z-1 h-(--titlebar-height) left-[calc(var(--titlebar-controls-left)+(var(--titlebar-control-size)*2)+0.75rem)] [-webkit-app-region:drag]"
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
