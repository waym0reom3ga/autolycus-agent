import { MoreVertical } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import type { SessionInfo } from '@/hermes'
import { sessionTitle } from '@/lib/chat-runtime'
import { triggerHaptic } from '@/lib/haptics'
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
  isWorking: boolean
  onDelete: () => void
  onPin: () => void
  onResume: () => void
}

export function SidebarSessionRow({
  session,
  isPinned,
  isSelected,
  isWorking,
  onDelete,
  onPin,
  onResume
}: SidebarSessionRowProps) {
  const title = sessionTitle(session)

  return (
    <div
      className={cn(
        sidebarSessionRowClass,
        sidebarSessionFadeClass,
        isSelected && 'bg-accent',
        isWorking && 'text-foreground'
      )}
      data-working={isWorking ? 'true' : undefined}
    >
      <button
        className="z-0 flex min-w-0 items-center gap-1.5 bg-transparent py-1 pl-2 text-left"
        onClick={event => {
          if (event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            triggerHaptic('selection')
            onPin()

            return
          }

          onResume()
        }}
        type="button"
      >
        {isWorking && (
          <span
            aria-label="Session running"
            className="relative size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_0.625rem_color-mix(in_srgb,var(--primary)_65%,transparent)] before:absolute before:inset-0 before:rounded-full before:bg-primary before:opacity-75 before:content-[''] before:animate-ping"
            role="status"
          />
        )}
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
