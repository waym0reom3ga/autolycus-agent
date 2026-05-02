import { Archive, Copy, Pencil, Pin, Trash2 } from 'lucide-react'
import type * as React from 'react'
import type { ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

interface SessionActionsMenuProps extends Pick<
  React.ComponentProps<typeof DropdownMenuContent>,
  'align' | 'sideOffset'
> {
  children: ReactNode
  title: string
  sessionId: string
  pinned?: boolean
  onPin?: () => void
  onDelete?: () => void
}

export function SessionActionsMenu({
  children,
  title,
  sessionId,
  pinned = false,
  onPin,
  onDelete,
  align = 'end',
  sideOffset = 6
}: SessionActionsMenuProps) {
  const itemClass = 'gap-2.5 text-foreground focus:bg-accent [&_svg]:size-4'

  const copyId = async () => {
    triggerHaptic('selection')

    try {
      await navigator.clipboard.writeText(sessionId)
      notify({ kind: 'success', message: 'Session ID copied', durationMs: 2_000 })
    } catch (err) {
      notifyError(err, 'Could not copy session ID')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} aria-label={`Actions for ${title}`} className="w-44" sideOffset={sideOffset}>
        <DropdownMenuItem
          className={itemClass}
          disabled={!onPin}
          onSelect={() => {
            triggerHaptic('selection')
            onPin?.()
          }}
        >
          <Pin />
          <span>{pinned ? 'Unpin' : 'Pin'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClass} onSelect={() => void copyId()}>
          <Copy />
          <span>Copy ID</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClass}>
          <Pencil />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClass}>
          <Archive />
          <span>Add to project</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-3" />
        <DropdownMenuItem
          className={cn(itemClass, 'text-destructive focus:text-destructive')}
          disabled={!onDelete}
          onSelect={() => {
            triggerHaptic('warning')
            onDelete?.()
          }}
          variant="destructive"
        >
          <Trash2 />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
