import { useStore } from '@nanostores/react'
import type { ComponentProps, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { triggerHaptic } from '@/lib/haptics'
import { FolderOpen, NotebookTabs, Settings, Volume2, VolumeX } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $hapticsMuted, toggleHapticsMuted } from '@/store/haptics'
import { $fileBrowserOpen, $sidebarOpen, toggleFileBrowserOpen, toggleSidebarOpen } from '@/store/layout'

import { titlebarButtonClass } from './titlebar'

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
  leftTools?: readonly TitlebarTool[]
  tools?: readonly TitlebarTool[]
  onOpenSettings: () => void
}

export function TitlebarControls({ leftTools = [], tools = [], onOpenSettings }: TitlebarControlsProps) {
  const navigate = useNavigate()
  const hapticsMuted = useStore($hapticsMuted)
  const fileBrowserOpen = useStore($fileBrowserOpen)
  const sidebarOpen = useStore($sidebarOpen)

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
    ...leftTools
  ]

  // Static system tools — always pinned to the screen's right edge.
  const systemTools: TitlebarTool[] = [
    {
      active: fileBrowserOpen,
      icon: <FolderOpen />,
      id: 'file-browser',
      label: fileBrowserOpen ? 'Hide file browser' : 'Show file browser',
      onSelect: () => {
        triggerHaptic('tap')
        toggleFileBrowserOpen()
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

  const visibleSystemTools = systemTools.filter(tool => !tool.hidden)
  const visiblePaneTools = tools.filter(tool => !tool.hidden)

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

      {/*
        Pane-scoped tools (preview's monitor / devtools / refresh / X) render
        as their own fixed cluster. AppShell sets --shell-preview-toolbar-gap
        to either the static cluster's width (file-browser closed → cluster
        sits flush against system tools) or the file-browser pane's width
        (file-browser open → cluster sits flush against the file-browser pane,
        i.e. at the preview pane's right edge). No margin hacks needed.
      */}
      {visiblePaneTools.length > 0 && (
        <div
          aria-label="Pane controls"
          className="fixed top-(--titlebar-controls-top) right-[calc(var(--titlebar-tools-right)+var(--shell-preview-toolbar-gap,0))] z-70 flex flex-row items-center gap-px pointer-events-auto select-none [-webkit-app-region:no-drag]"
        >
          {visiblePaneTools.map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
        </div>
      )}

      <div
        aria-label="App controls"
        className="fixed right-(--titlebar-tools-right) top-(--titlebar-controls-top) z-70 flex flex-row items-center justify-end gap-px pointer-events-auto select-none [-webkit-app-region:no-drag]"
      >
        {visibleSystemTools.map(tool => (
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
