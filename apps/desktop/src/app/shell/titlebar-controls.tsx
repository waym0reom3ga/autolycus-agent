import { useStore } from '@nanostores/react'
import { NotebookTabs, Search, Settings, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react'
import type { ReactNode } from 'react'
import type * as React from 'react'
import { useNavigate } from 'react-router-dom'

import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $hapticsMuted, toggleHapticsMuted } from '@/store/haptics'
import { $inspectorOpen, $sidebarOpen, toggleInspectorOpen, toggleSidebarOpen } from '@/store/layout'

import { TITLEBAR_ICON_SIZE, titlebarButtonClass } from './titlebar'

export interface TitlebarTool {
  id: string
  label: string
  active?: boolean
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  icon: ReactNode
  onSelect?: () => void
  title?: string
  to?: string
}

export type TitlebarToolSide = 'left' | 'right'
export type SetTitlebarToolGroup = (id: string, tools: readonly TitlebarTool[], side?: TitlebarToolSide) => void

interface TitlebarControlsProps extends React.ComponentProps<'div'> {
  leftTools?: readonly TitlebarTool[]
  settingsOpen: boolean
  showInspectorToggle: boolean
  tools?: readonly TitlebarTool[]
  onOpenSettings: () => void
}

export function TitlebarControls({
  leftTools = [],
  settingsOpen,
  showInspectorToggle,
  tools = [],
  onOpenSettings
}: TitlebarControlsProps) {
  const navigate = useNavigate()
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

  const leftToolbarTools: TitlebarTool[] = [
    {
      icon: <NotebookTabs />,
      id: 'sidebar',
      label: sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
      onSelect: () => {
        triggerHaptic('tap')
        toggleSidebarOpen()
      }
    },
    {
      icon: <Search size={TITLEBAR_ICON_SIZE} />,
      id: 'search',
      label: 'Search'
    },
    ...leftTools
  ]

  const rightToolbarTools: TitlebarTool[] = [
    ...tools,
    {
      active: inspectorOpen,
      hidden: !showInspectorToggle,
      icon: <SlidersHorizontal />,
      id: 'session-details',
      label: inspectorOpen ? 'Hide session details' : 'Show session details',
      onSelect: () => {
        triggerHaptic('tap')
        toggleInspectorOpen()
      }
    },
    {
      active: hapticsMuted,
      icon: hapticsMuted ? <VolumeX /> : <Volume2 />,
      id: 'haptics',
      label: hapticsMuted ? 'Unmute haptics' : 'Mute haptics',
      onSelect: toggleHaptics
    },
    {
      icon: <Settings />,
      id: 'settings',
      label: 'Open settings',
      onSelect: () => {
        triggerHaptic('open')
        onOpenSettings()
      }
    }
  ]

  return (
    <>
      <div
        aria-label="Window controls"
        className="fixed left-(--titlebar-controls-left) top-(--titlebar-controls-top) z-2147483647 flex translate-y-[2px] flex-row items-center gap-px pointer-events-auto [-webkit-app-region:no-drag]"
      >
        {leftToolbarTools
          .filter(tool => !tool.hidden)
          .map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
      </div>

      {!settingsOpen && (
        <div
          aria-label="App controls"
          className="fixed right-(--titlebar-tools-right) top-(--titlebar-controls-top) z-2147483647 flex flex-row items-center justify-end gap-px pointer-events-auto [-webkit-app-region:no-drag]"
        >
          {rightToolbarTools
            .filter(tool => !tool.hidden)
            .map(tool => (
              <TitlebarToolButton
                key={tool.id}
                navigate={navigate}
                tool={tool}
              />
            ))}
        </div>
      )}
    </>
  )
}

function TitlebarToolButton({
  navigate,
  tool
}: {
  navigate: ReturnType<typeof useNavigate>
  tool: TitlebarTool
}) {
  const className = cn(
    titlebarButtonClass,
    'grid place-items-center bg-transparent [&_svg]:size-3.5',
    tool.active && 'bg-muted text-muted-foreground',
    tool.className
  )

  if (tool.href) {
    return (
      <a
        aria-label={tool.label}
        className={className}
        href={tool.href}
        onPointerDown={event => event.stopPropagation()}
        rel="noreferrer"
        target="_blank"
        title={tool.title ?? tool.label}
      >
        {tool.icon}
      </a>
    )
  }

  return (
    <button
      aria-label={tool.label}
      aria-pressed={tool.active}
      className={className}
      disabled={tool.disabled}
      onClick={() => {
        if (tool.to) {
          navigate(tool.to)
        }

        tool.onSelect?.()
      }}
      onPointerDown={event => event.stopPropagation()}
      title={tool.title ?? tool.label}
      type="button"
    >
      {tool.icon}
    </button>
  )
}
