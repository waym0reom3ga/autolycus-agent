import { useStore } from '@nanostores/react'
import { NotebookTabs, Search, Settings, SlidersHorizontal } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'
import { $inspectorOpen, $sidebarOpen, toggleInspectorOpen, toggleSidebarOpen } from '@/store/layout'

import { TITLEBAR_ICON_SIZE, titlebarButtonClass } from './titlebar'

interface TitlebarControlsProps extends React.ComponentProps<'div'> {
  settingsOpen: boolean
  showInspectorToggle: boolean
  onOpenSettings: () => void
}

export function TitlebarControls({ settingsOpen, showInspectorToggle, onOpenSettings }: TitlebarControlsProps) {
  const sidebarOpen = useStore($sidebarOpen)
  const inspectorOpen = useStore($inspectorOpen)

  return (
    <>
      <div
        aria-label="Window controls"
        className="fixed left-(--titlebar-controls-left) top-(--titlebar-controls-top) z-50 grid translate-y-[2px] grid-flow-col auto-cols-(--titlebar-control-size) items-center pointer-events-auto [-webkit-app-region:no-drag]"
      >
        <button
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent [&_svg]:size-3.5')}
          onClick={toggleSidebarOpen}
          onPointerDown={event => event.stopPropagation()}
          type="button"
        >
          <NotebookTabs />
        </button>

        <button
          aria-label="Search"
          className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent')}
          onPointerDown={event => event.stopPropagation()}
          type="button"
        >
          <Search size={TITLEBAR_ICON_SIZE} />
        </button>
      </div>

      {!settingsOpen && (
        <div
          aria-label="App controls"
          className="fixed right-3 top-(--titlebar-controls-top) z-1100 grid grid-flow-col auto-cols-(--titlebar-control-size) items-center pointer-events-auto [-webkit-app-region:no-drag]"
        >
          {showInspectorToggle && (
            <button
              aria-label={inspectorOpen ? 'Hide session details' : 'Show session details'}
              className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent [&_svg]:size-3.5')}
              onClick={toggleInspectorOpen}
              onPointerDown={event => event.stopPropagation()}
              title={inspectorOpen ? 'Hide session details' : 'Show session details'}
              type="button"
            >
              <SlidersHorizontal />
            </button>
          )}
          <button
            aria-label="Open settings"
            className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent [&_svg]:size-3.5')}
            onClick={onOpenSettings}
            onPointerDown={event => event.stopPropagation()}
            title="Settings"
            type="button"
          >
            <Settings />
          </button>
        </div>
      )}
    </>
  )
}
