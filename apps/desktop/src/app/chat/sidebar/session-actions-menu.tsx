import { IconBookmark, IconBookmarkFilled, IconCircleX, IconFileDownload, IconPencil } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { renameSession } from '@/hermes'
import { triggerHaptic } from '@/lib/haptics'
import { exportSession } from '@/lib/session-export'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { setSessions } from '@/store/session'

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
  const [renameOpen, setRenameOpen] = useState(false)

  return (
    <>
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
            {pinned ? <IconBookmarkFilled /> : <IconBookmark />}
            <span>{pinned ? 'Unpin' : 'Pin'}</span>
          </DropdownMenuItem>
          <CopyButton
            appearance="menu-item"
            className={itemClass}
            disabled={!sessionId}
            errorMessage="Could not copy session ID"
            label="Copy ID"
            text={sessionId}
          />
          <DropdownMenuItem
            className={itemClass}
            disabled={!sessionId}
            onSelect={() => {
              triggerHaptic('selection')
              void exportSession(sessionId, { title })
            }}
          >
            <IconFileDownload />
            <span>Export</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={itemClass}
            disabled={!sessionId}
            onSelect={() => {
              triggerHaptic('selection')
              setRenameOpen(true)
            }}
          >
            <IconPencil />
            <span>Rename</span>
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
            <IconCircleX />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameSessionDialog currentTitle={title} onOpenChange={setRenameOpen} open={renameOpen} sessionId={sessionId} />
    </>
  )
}

interface RenameSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentTitle: string
}

function RenameSessionDialog({ open, onOpenChange, sessionId, currentTitle }: RenameSessionDialogProps) {
  const [value, setValue] = useState(currentTitle)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(currentTitle)
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [currentTitle, open])

  const submit = async () => {
    const next = value.trim()

    if (!sessionId || submitting) {
      return
    }

    if (next === currentTitle.trim()) {
      onOpenChange(false)

      return
    }

    setSubmitting(true)

    try {
      const result = await renameSession(sessionId, next)
      const finalTitle = result.title || next || ''
      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: finalTitle || null } : s)))
      notify({ kind: 'success', message: 'Renamed', durationMs: 2_000 })
      onOpenChange(false)
    } catch (err) {
      notifyError(err, 'Rename failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>Give this chat a memorable title. Leave empty to clear.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          disabled={submitting}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              onOpenChange(false)
            }
          }}
          placeholder="Untitled session"
          ref={inputRef}
          value={value}
        />
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={submitting} onClick={() => void submit()} type="button">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
