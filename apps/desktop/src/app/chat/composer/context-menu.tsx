import { Clipboard, FileText, FolderOpen, ImageIcon, Link, type LucideIcon, MessageSquareText, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { GHOST_ICON_BTN, PROMPT_SNIPPETS } from './constants'
import type { ChatBarState } from './types'

export function ContextMenu({
  state,
  onInsertText,
  onOpenUrlDialog,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages
}: {
  state: ChatBarState
  onInsertText: (text: string) => void
  onOpenUrlDialog: () => void
  onPasteClipboardImage?: () => void
  onPickFiles?: () => void
  onPickFolders?: () => void
  onPickImages?: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={state.tools.label}
          className={cn(GHOST_ICON_BTN, 'data-[state=open]:bg-accent data-[state=open]:text-foreground')}
          disabled={!state.tools.enabled}
          size="icon"
          title={state.tools.label}
          type="button"
          variant="ghost"
        >
          <Plus size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" side="top" sideOffset={10}>
        <DropdownMenuLabel className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground/85">
          Attach
        </DropdownMenuLabel>
        <ContextMenuItem disabled={!onPickFiles} icon={FileText} onSelect={onPickFiles}>
          Files…
        </ContextMenuItem>
        <ContextMenuItem disabled={!onPickFolders} icon={FolderOpen} onSelect={onPickFolders}>
          Folder…
        </ContextMenuItem>
        <ContextMenuItem disabled={!onPickImages} icon={ImageIcon} onSelect={onPickImages}>
          Images…
        </ContextMenuItem>
        <ContextMenuItem disabled={!onPasteClipboardImage} icon={Clipboard} onSelect={onPasteClipboardImage}>
          Paste image
        </ContextMenuItem>
        <ContextMenuItem icon={Link} onSelect={onOpenUrlDialog}>
          URL…
        </ContextMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <MessageSquareText />
            <span>Prompt snippets</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {PROMPT_SNIPPETS.map(snippet => (
              <ContextMenuItem icon={MessageSquareText} key={snippet.label} onSelect={() => onInsertText(snippet.text)}>
                {snippet.label}
              </ContextMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <div className="px-2 py-1 text-[0.7rem] text-muted-foreground/80">
          Tip: type <kbd className="rounded bg-muted/70 px-1 py-px font-mono text-[0.65rem]">@</kbd> to reference files
          inline.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ContextMenuItem({
  children,
  disabled,
  icon: Icon,
  onSelect
}: {
  children: string
  disabled?: boolean
  icon: LucideIcon
  onSelect?: () => void
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      <Icon />
      <span>{children}</span>
    </DropdownMenuItem>
  )
}
