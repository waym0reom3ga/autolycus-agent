import { useStore } from '@nanostores/react'
import { NotebookTabs, Search, Settings, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react'
import type { ReactNode } from 'react'
import type * as React from 'react'

import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $hapticsMuted, toggleHapticsMuted } from '@/store/haptics'
import { $inspectorOpen, $sidebarOpen, toggleInspectorOpen, toggleSidebarOpen } from '@/store/layout'

import { TITLEBAR_ICON_SIZE, titlebarButtonClass } from './titlebar'

interface TitlebarControlsProps extends React.ComponentProps<'div'> {
  settingsOpen: boolean
  showInspectorToggle: boolean
  leadingActions?: ReactNode
  onOpenSettings: () => void
}

export function TitlebarControls({
  settingsOpen,
  showInspectorToggle,
  leadingActions,
  onOpenSettings
}: TitlebarControlsProps) {
  const hapticsMuted = useStore($hapticsMuted)
  const sidebarOpen = useStore($sidebarOpen)
  const inspectorOpen = useStore($inspectorOpen)

  const toggleHaptics = () => {
    if (!hapticsMuted) {
      triggerHaptic('tap')
    }

    toggleHapticsMuted()

    if (hapticsMuted) {
      window.requestAnimationFrame(() => triggerHaptic('success'))
    }
  }

  return (
    <>
      <div
        aria-label="Window controls"
        className="fixed left-(--titlebar-controls-left) top-(--titlebar-controls-top) z-50 grid translate-y-[2px] grid-flow-col auto-cols-(--titlebar-control-size) items-center pointer-events-auto [-webkit-app-region:no-drag]"
      >
        <button
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent [&_svg]:size-3.5')}
          onClick={() => {
            triggerHaptic('tap')
            toggleSidebarOpen()
          }}
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
          {leadingActions}
          {showInspectorToggle && (
            <button
              aria-label={inspectorOpen ? 'Hide session details' : 'Show session details'}
              className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent [&_svg]:size-3.5')}
              onClick={() => {
                triggerHaptic('tap')
                toggleInspectorOpen()
              }}
              onPointerDown={event => event.stopPropagation()}
              title={inspectorOpen ? 'Hide session details' : 'Show session details'}
              type="button"
            >
              <SlidersHorizontal />
            </button>
          )}
          <button
            aria-label={hapticsMuted ? 'Unmute haptics' : 'Mute haptics'}
            aria-pressed={hapticsMuted}
            className={cn(
              titlebarButtonClass,
              'grid place-items-center bg-transparent [&_svg]:size-3.5',
              hapticsMuted && 'bg-muted text-muted-foreground'
            )}
            onClick={toggleHaptics}
            onPointerDown={event => event.stopPropagation()}
            title={hapticsMuted ? 'Unmute haptics' : 'Mute haptics'}
            type="button"
          >
            {hapticsMuted ? <VolumeX /> : <Volume2 />}
          </button>
          <button
            aria-label="Open settings"
            className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent [&_svg]:size-3.5')}
            onClick={() => {
              triggerHaptic('open')
              onOpenSettings()
            }}
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
