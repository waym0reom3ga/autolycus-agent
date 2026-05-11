import { useStore } from '@nanostores/react'
import type { CSSProperties, ReactNode } from 'react'

import { Backdrop } from '@/components/Backdrop'
import { PaneShell } from '@/components/pane-shell'
import { SidebarProvider } from '@/components/ui/sidebar'
import {
  $fileBrowserOpen,
  $sidebarOpen,
  FILE_BROWSER_DEFAULT_WIDTH,
  FILE_BROWSER_PANE_ID,
  setSidebarOpen
} from '@/store/layout'
import { $paneWidthOverride } from '@/store/panes'
import { $connection } from '@/store/session'

import { StatusbarControls, type StatusbarItem } from './statusbar-controls'
import { TITLEBAR_HEIGHT, titlebarControlsPosition } from './titlebar'
import { TitlebarControls, type TitlebarTool } from './titlebar-controls'

interface AppShellProps {
  children: ReactNode
  leftStatusbarItems?: readonly StatusbarItem[]
  leftTitlebarTools?: readonly TitlebarTool[]
  onOpenSettings: () => void
  overlays?: ReactNode
  statusbarItems?: readonly StatusbarItem[]
  titlebarTools?: readonly TitlebarTool[]
}

export function AppShell({
  children,
  leftStatusbarItems,
  leftTitlebarTools,
  onOpenSettings,
  overlays,
  statusbarItems,
  titlebarTools
}: AppShellProps) {
  const sidebarOpen = useStore($sidebarOpen)
  const fileBrowserOpen = useStore($fileBrowserOpen)
  const fileBrowserWidthOverride = useStore($paneWidthOverride(FILE_BROWSER_PANE_ID))
  const connection = useStore($connection)

  const titlebarControls = titlebarControlsPosition(connection?.windowButtonPosition)

  const titlebarContentInset = sidebarOpen
    ? 0
    : titlebarControls.left + TITLEBAR_HEIGHT + Math.round(TITLEBAR_HEIGHT / 2)

  // The static system cluster (file-browser, haptics, settings) is hardcoded
  // in TitlebarControls. Pane-supplied tools (preview's group) render in a
  // separate cluster anchored further left.
  const SYSTEM_TOOL_COUNT = 3
  const paneToolCount = titlebarTools?.filter(tool => !tool.hidden).length ?? 0
  const systemToolsWidth = `calc(${SYSTEM_TOOL_COUNT} * var(--titlebar-control-size))`

  const fileBrowserWidth =
    fileBrowserWidthOverride !== undefined ? `${fileBrowserWidthOverride}px` : FILE_BROWSER_DEFAULT_WIDTH

  // Where the pane-tool cluster's right edge sits, measured from the inner
  // titlebar padding (--titlebar-tools-right). Two anchors:
  //   - file-browser closed → flush against static cluster's left edge
  //   - file-browser open   → flush against the file-browser pane's left edge
  //                           (= preview pane's right edge)
  const previewToolbarGap = fileBrowserOpen ? fileBrowserWidth : systemToolsWidth

  // Used by the drag region to know where the rightmost interactive element
  // ends. When pane tools are present, that's `gap + paneCount * controlSize`
  // (the leftmost button is at `tools-right + gap + paneCount * size`).
  // Otherwise the static cluster's footprint is enough.
  const titlebarToolsWidth =
    paneToolCount > 0
      ? `calc(${previewToolbarGap} + ${paneToolCount} * var(--titlebar-control-size))`
      : systemToolsWidth

  return (
    <SidebarProvider
      className="h-screen min-h-0 bg-background"
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={
        {
          // Alias for shadcn <Sidebar> descendants. Resolves to the chat-sidebar
          // pane track via PaneShell's emitted --pane-chat-sidebar-width.
          '--sidebar-width': 'var(--pane-chat-sidebar-width)',
          '--titlebar-height': `${TITLEBAR_HEIGHT}px`,
          '--titlebar-content-inset': `${titlebarContentInset}px`,
          '--titlebar-controls-left': `${titlebarControls.left}px`,
          '--titlebar-controls-top': `${titlebarControls.top}px`,
          '--titlebar-tools-right': '0.75rem',
          '--titlebar-tools-width': titlebarToolsWidth,
          // Anchor for the pane-tool cluster's right edge in TitlebarControls.
          // Sourced from the layout store rather than the PaneShell-emitted
          // --pane-*-width vars because the titlebar is a sibling of PaneShell
          // and CSS variables resolve at the consumer's scope.
          '--shell-preview-toolbar-gap': previewToolbarGap
        } as CSSProperties
      }
    >
      <TitlebarControls leftTools={leftTitlebarTools} onOpenSettings={onOpenSettings} tools={titlebarTools} />

      <Backdrop />
      <main className="relative z-[3] flex h-screen w-full flex-col overflow-hidden pr-0.75 pb-0.75 pt-0.75 transition-none">
        <PaneShell className="min-h-0 flex-1">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-1 h-(--titlebar-height) w-(--titlebar-controls-left) [-webkit-app-region:drag]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 z-1 h-(--titlebar-height) left-[calc(var(--titlebar-controls-left)+(var(--titlebar-control-size)*2)+0.75rem)] right-[calc(var(--titlebar-tools-right)+var(--titlebar-tools-width)+0.75rem)] [-webkit-app-region:drag]"
          />

          {children}
        </PaneShell>

        <StatusbarControls items={statusbarItems} leftItems={leftStatusbarItems} />
      </main>

      {overlays}
    </SidebarProvider>
  )
}
