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
import type { ChatBarState, ContextSuggestion } from './types'

export function ContextMenu({
  state,
  onAddContextRef,
  onInsertText,
  onOpenUrlDialog,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages
}: {
  state: ChatBarState
  onAddContextRef?: (refText: string, label?: string, detail?: string) => void
  onInsertText: (text: string) => void
  onOpenUrlDialog: () => void
  onPasteClipboardImage?: () => void
  onPickFiles?: () => void
  onPickFolders?: () => void
  onPickImages?: () => void
}) {
  const choose = (item: ContextSuggestion) =>
    onAddContextRef ? onAddContextRef(item.text, item.display, item.meta) : onInsertText(item.text)

  const suggestions = state.tools.suggestions?.slice(0, 8) ?? []

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
      <DropdownMenuContent align="start" className="w-64" side="top" sideOffset={10}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Add context</DropdownMenuLabel>
        <ContextMenuItem disabled={!onPickFiles} icon={FileText} onSelect={onPickFiles}>
          Files
        </ContextMenuItem>
        <ContextMenuItem disabled={!onPickFolders} icon={FolderOpen} onSelect={onPickFolders}>
          Folders
        </ContextMenuItem>
        <ContextMenuItem disabled={!onPickImages} icon={ImageIcon} onSelect={onPickImages}>
          Images
        </ContextMenuItem>
        <ContextMenuItem disabled={!onPasteClipboardImage} icon={Clipboard} onSelect={onPasteClipboardImage}>
          Image from clipboard
        </ContextMenuItem>
        <ContextMenuItem icon={Link} onSelect={onOpenUrlDialog}>
          URL
        </ContextMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FileText />
            <span>Suggested files</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {suggestions.length === 0 ? (
              <DropdownMenuItem disabled>
                <span className="text-muted-foreground">No suggestions</span>
              </DropdownMenuItem>
            ) : (
              suggestions.map(item => (
                <DropdownMenuItem key={item.text} onSelect={() => choose(item)}>
                  <FileText />
                  <span className="min-w-0 flex-1 truncate">{item.display}</span>
                  {item.meta && <span className="max-w-28 truncate text-xs text-muted-foreground">{item.meta}</span>}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

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
