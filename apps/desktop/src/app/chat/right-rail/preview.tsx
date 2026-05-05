import { useStore } from '@nanostores/react'
import { type MouseEvent, useCallback, useEffect, useMemo, useRef } from 'react'

import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import { X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $rightRailActiveTabId,
  RIGHT_RAIL_PREVIEW_TAB_ID,
  type RightRailTabId,
  selectRightRailTab
} from '@/store/layout'
import {
  $filePreviewTabs,
  $previewReloadRequest,
  $previewTarget,
  closeFilePreviewTab,
  dismissPreviewTarget,
  type FilePreviewTab,
  type PreviewTarget
} from '@/store/preview'

import { PreviewPane } from './preview-pane'

export const PREVIEW_RAIL_MIN_WIDTH = '18rem'
export const PREVIEW_RAIL_MAX_WIDTH = '38rem'

const INTRINSIC = `clamp(${PREVIEW_RAIL_MIN_WIDTH}, 36vw, 32rem)`

// Track for <Pane id="preview">. Folds the intrinsic clamp with a min-floor
// against --chat-min-width so the chat surface never gets squeezed below it.
// Subtracts the project browser width so preview yields rather than crushing
// the chat when both right-side panes are open.
export const PREVIEW_RAIL_PANE_WIDTH = `min(${INTRINSIC}, max(0px, calc(100vw - var(--pane-chat-sidebar-width) - var(--pane-file-browser-width, 0px) - var(--chat-min-width))))`

interface ChatPreviewRailProps {
  onRestartServer?: (url: string, context?: string) => Promise<string>
  setTitlebarToolGroup?: SetTitlebarToolGroup
}

interface RailTab {
  closeLabel: string
  id: RightRailTabId
  label: string
  target: PreviewTarget
}

function previewTabLabel(target: PreviewTarget): string {
  const value = target.label || target.path || target.source || target.url
  const parts = value.split(/[\\/]/).filter(Boolean)

  return parts.at(-1) || value || 'Preview'
}

function tabLabel(tab: FilePreviewTab): string {
  return previewTabLabel(tab.target)
}

export function ChatPreviewRail({ onRestartServer, setTitlebarToolGroup }: ChatPreviewRailProps) {
  const previewReloadRequest = useStore($previewReloadRequest)
  const activeTabId = useStore($rightRailActiveTabId)
  const filePreviewTabs = useStore($filePreviewTabs)
  const previewTarget = useStore($previewTarget)

  const tabs = useMemo<readonly RailTab[]>(
    () => [
      ...(previewTarget
        ? [
            {
              closeLabel: 'Close preview',
              id: RIGHT_RAIL_PREVIEW_TAB_ID,
              label: 'Preview',
              target: previewTarget
            } satisfies RailTab
          ]
        : []),
      ...filePreviewTabs.map(tab => ({
        closeLabel: `Close ${tabLabel(tab)}`,
        id: tab.id,
        label: tabLabel(tab),
        target: tab.target
      }))
    ],
    [filePreviewTabs, previewTarget]
  )

  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  // Read-by-ref so close handlers stay reference-stable across renders.
  const activeTabRef = useRef<RailTab | undefined>(activeTab)
  activeTabRef.current = activeTab

  useEffect(() => {
    if (activeTab && activeTab.id !== activeTabId) {
      selectRightRailTab(activeTab.id)
    }
  }, [activeTab, activeTabId])

  const closeRailTab = useCallback((tab: RailTab) => {
    if (tab.id === RIGHT_RAIL_PREVIEW_TAB_ID) {
      dismissPreviewTarget()

      return
    }

    closeFilePreviewTab(tab.id)
  }, [])

  // Stable: PreviewPane lists onClose in a useEffect dep array that pushes
  // titlebar tools. A fresh closure every render → setTitlebarToolGroup every
  // render → DesktopController setState → re-render → ∞.
  const handleCloseDocument = useCallback(() => {
    const tab = activeTabRef.current

    if (tab) {
      closeRailTab(tab)
    }
  }, [closeRailTab])

  const closeTab = (event: MouseEvent, tab: RailTab) => {
    event.stopPropagation()
    closeRailTab(tab)
  }

  if (!activeTab) {
    return null
  }

  const isPreview = activeTab.id === RIGHT_RAIL_PREVIEW_TAB_ID

  return (
    <aside className="relative flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-border/60 bg-background text-muted-foreground">
      <div
        className="flex h-(--titlebar-height) shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border/60 bg-[color-mix(in_srgb,var(--dt-sidebar-bg)_94%,transparent)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {tabs.map(tab => {
          const active = tab.id === activeTab.id

          return (
            <div
              className={cn(
                'group/tab relative flex h-full max-w-48 shrink-0 items-center text-[0.6875rem] font-medium [-webkit-app-region:no-drag]',
                active
                  ? 'bg-background text-foreground'
                  : 'border-r border-border/40 text-muted-foreground hover:bg-accent/30 hover:text-foreground'
              )}
              key={tab.id}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-primary/70" />}
              <button
                aria-selected={active}
                className="flex h-full min-w-0 flex-1 items-center truncate pl-3 pr-1.5 text-left outline-none"
                onClick={() => selectRightRailTab(tab.id)}
                role="tab"
                title={tab.label}
                type="button"
              >
                {tab.label}
              </button>
              <button
                aria-label={tab.closeLabel}
                className={cn(
                  'mr-1.5 hidden size-4 shrink-0 place-items-center rounded-sm text-muted-foreground/55 transition-colors hover:bg-accent hover:text-foreground focus-visible:grid group-hover/tab:grid',
                  active && 'grid'
                )}
                onClick={event => closeTab(event, tab)}
                title={tab.closeLabel}
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <PreviewPane
          embedded
          onClose={handleCloseDocument}
          onRestartServer={isPreview ? onRestartServer : undefined}
          reloadRequest={previewReloadRequest}
          setTitlebarToolGroup={setTitlebarToolGroup}
          target={activeTab.target}
        />
      </div>
    </aside>
  )
}
