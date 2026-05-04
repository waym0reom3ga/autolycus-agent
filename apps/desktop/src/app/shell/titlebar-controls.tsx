import { useStore } from '@nanostores/react'
import type { ComponentProps, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { triggerHaptic } from '@/lib/haptics'
import { Command, NotebookTabs, Settings, SlidersHorizontal, Volume2, VolumeX } from '@/lib/icons'
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

interface TitlebarControlsProps extends ComponentProps<'div'> {
  commandCenterOpen: boolean
  leftTools?: readonly TitlebarTool[]
  showInspectorToggle: boolean
  tools?: readonly TitlebarTool[]
  onToggleCommandCenter: () => void
  onOpenSettings: () => void
}

export function TitlebarControls({
  commandCenterOpen,
  leftTools = [],
  showInspectorToggle,
  tools = [],
  onToggleCommandCenter,
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
      active: commandCenterOpen,
      icon: <Command size={TITLEBAR_ICON_SIZE} />,
      id: 'command-center',
      label: commandCenterOpen ? 'Close command center' : 'Open command center',
      title: commandCenterOpen ? 'Close command center' : 'Open command center',
      onSelect: () => {
        triggerHaptic('tap')
        onToggleCommandCenter()
      }
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
        className="fixed left-(--titlebar-controls-left) top-(--titlebar-controls-top) z-70 flex translate-y-[2px] flex-row items-center gap-px pointer-events-auto select-none [-webkit-app-region:no-drag]"
      >
        {leftToolbarTools
          .filter(tool => !tool.hidden)
          .map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
      </div>

      <div
        aria-label="App controls"
        className="fixed right-(--titlebar-tools-right) top-(--titlebar-controls-top) z-70 flex flex-row items-center justify-end gap-px pointer-events-auto select-none [-webkit-app-region:no-drag]"
      >
        {rightToolbarTools
          .filter(tool => !tool.hidden)
          .map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
      </div>
    </>
  )
}

function TitlebarToolButton({ navigate, tool }: { navigate: ReturnType<typeof useNavigate>; tool: TitlebarTool }) {
  const className = cn(
    titlebarButtonClass,
    'grid place-items-center bg-transparent select-none [&_svg]:size-4',
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
      aria-pressed={tool.active ?? undefined}
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
