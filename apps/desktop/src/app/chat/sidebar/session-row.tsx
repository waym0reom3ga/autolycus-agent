import { MoreVertical } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import type { SessionInfo } from '@/hermes'
import { sessionTitle } from '@/lib/chat-runtime'
import { cn } from '@/lib/utils'

import { SessionActionsMenu } from './session-actions-menu'

export const sidebarSessionRowClass =
  'group relative grid min-h-7 grid-cols-[minmax(0,1fr)_1.5rem] items-center rounded-lg transition-colors duration-300 ease-out hover:bg-accent hover:transition-none'

export const sidebarSessionFadeClass =
  'after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-1 after:w-18 after:rounded-[inherit] after:bg-linear-to-r after:from-transparent after:via-[color-mix(in_srgb,var(--dt-sidebar-bg)_78%,transparent)] after:to-[color-mix(in_srgb,var(--dt-sidebar-bg)_96%,transparent)] after:opacity-0 after:transition-opacity after:duration-200 after:ease-out hover:after:opacity-100 focus-within:after:opacity-100'

interface SidebarSessionRowProps extends React.ComponentProps<'div'> {
  session: SessionInfo
  isPinned: boolean
  isSelected: boolean
  onDelete: () => void
  onPin: () => void
  onResume: () => void
}

export function SidebarSessionRow({
  session,
  isPinned,
  isSelected,
  onDelete,
  onPin,
  onResume
}: SidebarSessionRowProps) {
  const title = sessionTitle(session)

  return (
    <div className={cn(sidebarSessionRowClass, sidebarSessionFadeClass, isSelected && 'bg-accent')}>
      <button
        className="z-0 flex min-w-0 items-center bg-transparent py-1 pl-2 text-left"
        onClick={event => {
          if (event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            onPin()

            return
          }

          onResume()
        }}
        type="button"
      >
        <span className="truncate text-sm font-medium text-foreground/90">{title}</span>
      </button>
      <div className="relative z-2 grid w-6 place-items-center">
        <SessionActionsMenu onDelete={onDelete} onPin={onPin} pinned={isPinned} title={title}>
          <Button
            aria-label={`Actions for ${title}`}
            className="size-6 rounded-md bg-transparent text-transparent transition-colors duration-150 hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground group-hover:text-muted-foreground"
            size="icon"
            title="Session actions"
            variant="ghost"
          >
            <MoreVertical size={15} />
          </Button>
        </SessionActionsMenu>
      </div>
    </div>
  )
}
