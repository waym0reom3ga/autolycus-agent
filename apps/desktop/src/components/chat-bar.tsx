import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import {
  ComposerPrimitive,
  type Unstable_IconComponent,
  type Unstable_MentionCategory,
  type Unstable_MentionDirective,
  unstable_useMentionAdapter,
  useAui,
  useAuiState
} from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import {
  ArrowUp,
  ChevronDown,
  Clipboard,
  FileText,
  FolderOpen,
  ImageIcon,
  Link,
  type LucideIcon,
  MessageSquareText,
  Mic,
  Plus,
  X
} from 'lucide-react'
import { type ClipboardEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../lib/utils'
import { $composerAttachments, type ComposerAttachment } from '../store/composer'
import { $threadScrolledUp } from '../store/thread-scroll'

import { hermesDirectiveFormatter } from './assistant-ui/directive-text'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
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
} from './ui/dropdown-menu'
import { Input } from './ui/input'

type ContextSuggestion = { text: string; display: string; meta?: string }

export type QuickModelOption = {
  provider: string
  providerName: string
  model: string
}

export type ChatBarState = {
  model: {
    model: string
    provider: string
    canSwitch: boolean
    loading?: boolean
    quickModels?: QuickModelOption[]
  }
  tools: { enabled: boolean; label: string; suggestions?: ContextSuggestion[] }
  voice: { enabled: boolean; active: boolean }
}

type ChatBarProps = {
  busy: boolean
  disabled: boolean
  focusKey?: string | null
  state: ChatBarState
  onCancel: () => void
  onAddContextRef?: (refText: string, label?: string, detail?: string) => void
  onAddUrl?: (url: string) => void
  onPasteClipboardImage?: () => void
  onPickFiles?: () => void
  onPickFolders?: () => void
  onPickImages?: () => void
  onRemoveAttachment?: (id: string) => void
  onSubmit: (value: string) => void
}

// Stacked = controls drop below the textarea.
const STACK_AT = 500
const NARROW_VIEWPORT = '(max-width: 680px)'
const EXPAND_HEIGHT_PX = 42

const SHELL =
  'absolute bottom-0 left-1/2 z-30 w-[min(calc(100%_-_1rem),clamp(26rem,78%,56rem))] max-w-full -translate-x-1/2'

const ICON_BTN = 'h-8 w-8 shrink-0 rounded-full'

const GHOST_ICON_BTN = cn(ICON_BTN, 'text-muted-foreground hover:bg-accent hover:text-foreground')

const COMPOSER_BACKDROP_STYLE = {
  backdropFilter: 'blur(.5rem) saturate(1.18)',
  WebkitBackdropFilter: 'blur(.5rem) saturate(1.18)'
} satisfies CSSProperties

const ATTACHMENT_ICON: Record<ComposerAttachment['kind'], LucideIcon> = {
  folder: FolderOpen,
  url: Link,
  image: ImageIcon,
  file: FileText
}

const DIRECTIVE_ICONS: Record<string, Unstable_IconComponent> = {
  file: FileText,
  folder: FolderOpen,
  image: ImageIcon,
  url: Link
}

const DIRECTIVE_POPOVER_CLASS =
  'absolute bottom-24 left-1/2 z-50 w-[min(calc(100vw-1.5rem),28rem)] max-h-[min(28rem,calc(100vh-8rem))] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-2xl'

const PROMPT_SNIPPETS = [
  {
    label: 'Code review',
    text: 'Please review this for bugs, regressions, and missing tests.'
  },
  {
    label: 'Implementation plan',
    text: 'Please make a concise implementation plan before changing code.'
  },
  {
    label: 'Explain this',
    text: 'Please explain how this works and point me to the key files.'
  }
]

const ASK_PLACEHOLDERS = [
  'Hey friend, what can I help with?',
  "What's on your mind? I'm here with you.",
  'Need a hand? We can take it one step at a time.',
  'Want to walk through this bug together?',
  "Share what you're working on and we'll figure it out.",
  "Tell me where you're stuck and I'll stay with you.",
  'Duck mode: gentle debugging, together.'
]

const REF_ITEMS: Unstable_TriggerItem[] = [
  {
    id: 'file:',
    type: 'file',
    label: 'File',
    description: 'Attach a file path',
    metadata: { icon: 'file' }
  },
  {
    id: 'folder:',
    type: 'folder',
    label: 'Folder',
    description: 'Attach a folder path',
    metadata: { icon: 'folder' }
  },
  {
    id: 'url:',
    type: 'url',
    label: 'URL',
    description: 'Attach a web page',
    metadata: { icon: 'url' }
  },
  {
    id: 'image:',
    type: 'image',
    label: 'Image',
    description: 'Attach an image path',
    metadata: { icon: 'image' }
  }
]

const EDGE_NEWLINES_RE = /^[\t ]*(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+[\t ]*$/g

function trimPastedEdgeNewlines(text: string): string {
  return text.replace(EDGE_NEWLINES_RE, '')
}

export function ChatBar({
  busy,
  disabled,
  focusKey,
  state,
  onCancel,
  onAddContextRef,
  onAddUrl,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages,
  onRemoveAttachment,
  onSubmit
}: ChatBarProps) {
  const aui = useAui()
  const draft = useAuiState(s => s.composer.text)
  const attachments = useStore($composerAttachments)
  const scrolledUp = useStore($threadScrolledUp)

  const composerRef = useRef<HTMLFormElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const urlInputRef = useRef<HTMLInputElement | null>(null)

  const [urlOpen, setUrlOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [stack, setStack] = useState(false)

  const [askPlaceholder] = useState(
    () => ASK_PLACEHOLDERS[Math.floor(Math.random() * ASK_PLACEHOLDERS.length)] || 'Ask anything'
  )

  const mentionCategories = useMemo(() => buildMentionCategories(state.tools.suggestions), [state.tools.suggestions])

  const mention = unstable_useMentionAdapter({
    categories: mentionCategories,
    includeModelContextTools: false,
    formatter: hermesDirectiveFormatter,
    iconMap: DIRECTIVE_ICONS,
    fallbackIcon: FileText
  })

  const stacked = expanded || stack
  const canSubmit = busy || draft.trim().length > 0 || attachments.length > 0

  const focusInput = () => window.requestAnimationFrame(() => textareaRef.current?.focus())

  useEffect(() => {
    if (!disabled) {
      focusInput()
    }
  }, [disabled, focusKey])

  useEffect(() => {
    if (urlOpen) {
      window.requestAnimationFrame(() => urlInputRef.current?.focus())
    }
  }, [urlOpen])

  useEffect(() => {
    if (!draft) {
      setExpanded(false)

      return
    }

    if (expanded) {
      return
    }

    const wraps = (textareaRef.current?.scrollHeight ?? 0) > EXPAND_HEIGHT_PX

    if (draft.includes('\n') || wraps) {
      setExpanded(true)
    }
  }, [draft, expanded])

  useEffect(() => {
    const mq = window.matchMedia(NARROW_VIEWPORT)

    const update = () => {
      const w = composerRef.current?.getBoundingClientRect().width ?? window.innerWidth

      setStack(mq.matches || w < STACK_AT)
    }

    update()
    mq.addEventListener('change', update)
    const ro = new ResizeObserver(update)

    if (composerRef.current) {
      ro.observe(composerRef.current)
    }

    return () => {
      mq.removeEventListener('change', update)
      ro.disconnect()
    }
  }, [])

  const insertText = (text: string) => {
    const sep = draft && !draft.endsWith('\n') ? '\n' : ''
    aui.composer().setText(`${draft}${sep}${text}`)
    focusInput()
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData('text')

    if (!pastedText) {
      return
    }

    const trimmedText = trimPastedEdgeNewlines(pastedText)

    if (trimmedText === pastedText) {
      return
    }

    event.preventDefault()
    const textarea = event.currentTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    const nextDraft = textarea.value.slice(0, start) + trimmedText + textarea.value.slice(end)

    const cursor = start + trimmedText.length

    aui.composer().setText(nextDraft)
    window.requestAnimationFrame(() => {
      const current = textareaRef.current

      if (!current) {
        return
      }

      current.focus()
      current.setSelectionRange(cursor, cursor)
    })
  }

  const submitDraft = () => {
    if (busy) {
      onCancel()
    } else if (draft.trim() || attachments.length > 0) {
      onSubmit(draft)
      aui.composer().setText('')
    }

    focusInput()
  }

  const submitUrl = () => {
    const url = urlValue.trim()

    if (!url) {
      return
    }

    if (onAddUrl) {
      onAddUrl(url)
    } else {
      insertText(`@url:${url}`)
    }

    setUrlValue('')
    setUrlOpen(false)
  }

  const contextMenu = (
    <ContextMenu
      onAddContextRef={onAddContextRef}
      onInsertText={insertText}
      onOpenUrlDialog={() => setUrlOpen(true)}
      onPasteClipboardImage={onPasteClipboardImage}
      onPickFiles={onPickFiles}
      onPickFolders={onPickFolders}
      onPickImages={onPickImages}
      state={state}
    />
  )

  const controls = <ComposerControls busy={busy} canSubmit={canSubmit} disabled={disabled} state={state} />

  const input = (
    <ComposerPrimitive.Input
      className={cn(
        'min-h-8 max-h-37.5 resize-none overflow-y-auto bg-transparent pb-1 pr-1 pt-1 leading-normal text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed',
        stacked && 'pl-3',
        stacked ? 'w-full' : 'min-w-48 flex-1'
      )}
      disabled={disabled}
      onPaste={handlePaste}
      placeholder={disabled ? 'Starting Hermes...' : askPlaceholder}
      ref={textareaRef}
      rows={1}
      unstable_focusOnScrollToBottom={false}
    />
  )

  return (
    <>
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        {mentionCategories.length > 0 && (
          <DirectivePopover
            adapter={mention.adapter}
            directive={mention.directive}
            fallbackIcon={mention.fallbackIcon ?? FileText}
            iconMap={mention.iconMap ?? DIRECTIVE_ICONS}
          />
        )}
        <ComposerPrimitive.Root
          className={cn(SHELL, 'group/composer pb-4 pt-2')}
          onSubmit={e => {
            e.preventDefault()
            submitDraft()
          }}
          ref={composerRef}
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-linear-to-b from-transparent to-background/55" />
          <div className="relative w-full">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-card/1 transition-opacity duration-200 ease-out group-focus-within/composer:opacity-0"
              style={COMPOSER_BACKDROP_STYLE}
            />
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-0 rounded-[1.25rem] border border-input/70 bg-card/72 shadow-composer transition-[opacity,background-color,border-color,box-shadow] duration-200 ease-out group-focus-within/composer:border-ring/40 group-focus-within/composer:bg-card group-focus-within/composer:opacity-100 group-focus-within/composer:shadow-composer-focus',
                scrolledUp
                  ? 'opacity-60 group-hover/composer:opacity-100 group-focus-within/composer:opacity-100'
                  : 'opacity-100'
              )}
            />
            <div
              className={cn(
                'relative z-1 flex w-full flex-col gap-1.5 overflow-hidden rounded-[1.25rem] px-2 py-1.5 transition-opacity duration-200 ease-out',
                scrolledUp
                  ? 'opacity-60 group-hover/composer:opacity-100 group-focus-within/composer:opacity-100'
                  : 'opacity-100'
              )}
            >
              {attachments.length > 0 && <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />}
              {stacked ? (
                <>
                  {input}
                  <div className="flex w-full items-center gap-1.5">
                    {contextMenu}
                    {controls}
                  </div>
                </>
              ) : (
                <div className="flex w-full items-end gap-1.5">
                  {contextMenu}
                  {input}
                  {controls}
                </div>
              )}
            </div>
          </div>
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>

      <UrlDialog
        inputRef={urlInputRef}
        onChange={setUrlValue}
        onOpenChange={setUrlOpen}
        onSubmit={submitUrl}
        open={urlOpen}
        value={urlValue}
      />
    </>
  )
}

export function ChatBarFallback() {
  return (
    <div className={cn(SHELL, 'bg-linear-to-b from-transparent to-background/55 pb-4 pt-2')}>
      <div className="relative h-11 w-full">
        <div className="absolute inset-0 rounded-[1.25rem] bg-card/1" style={COMPOSER_BACKDROP_STYLE} />
        <div className="absolute inset-0 rounded-[1.25rem] border border-input/70 bg-card/72 shadow-composer" />
      </div>
    </div>
  )
}

function ComposerControls({
  busy,
  canSubmit,
  disabled,
  state
}: {
  busy: boolean
  canSubmit: boolean
  disabled: boolean
  state: ChatBarState
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <VoiceButton state={state.voice} />
      <Button
        aria-label={busy ? 'Stop' : 'Send'}
        className={cn(ICON_BTN, 'p-0')}
        disabled={disabled || !canSubmit}
        type="submit"
      >
        {busy ? <span className="block size-3 rounded-[0.1875rem] bg-current" /> : <ArrowUp size={18} />}
      </Button>
    </div>
  )
}

function VoiceButton({ state }: { state: ChatBarState['voice'] }) {
  const aria = state.active ? 'Voice mode active' : 'Voice input'

  return (
    <Button
      aria-label={aria}
      className={cn(GHOST_ICON_BTN, 'data-[active=true]:bg-accent data-[active=true]:text-foreground')}
      data-active={state.active}
      disabled={!state.enabled}
      size="icon"
      title={aria}
      type="button"
      variant="ghost"
    >
      <Mic size={16} />
    </Button>
  )
}

function ContextMenu({
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

function ContextMenuItem({
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

function AttachmentList({
  attachments,
  onRemove
}: {
  attachments: ComposerAttachment[]
  onRemove?: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-1">
      {attachments.map(a => (
        <AttachmentPill attachment={a} key={a.id} onRemove={onRemove} />
      ))}
    </div>
  )
}

function AttachmentPill({ attachment, onRemove }: { attachment: ComposerAttachment; onRemove?: (id: string) => void }) {
  const Icon = ATTACHMENT_ICON[attachment.kind]

  return (
    <div className="group/attachment flex max-w-full items-center gap-2 rounded-2xl border border-border/70 bg-muted/35 py-1 pl-1 pr-1.5 text-xs text-foreground/90">
      {attachment.previewUrl ? (
        <img alt="" className="size-9 rounded-xl object-cover" draggable={false} src={attachment.previewUrl} />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background/70 text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate font-medium">{attachment.label}</span>
        {attachment.detail && (
          <span className="truncate text-[0.6875rem] text-muted-foreground">{attachment.detail}</span>
        )}
      </span>
      {onRemove && (
        <button
          aria-label={`Remove ${attachment.label}`}
          className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground group-hover/attachment:opacity-100"
          onClick={() => onRemove(attachment.id)}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function DirectivePopover({
  adapter,
  directive,
  fallbackIcon: Fallback,
  iconMap
}: {
  adapter: Unstable_TriggerAdapter
  directive: Unstable_MentionDirective
  fallbackIcon: Unstable_IconComponent
  iconMap: Record<string, Unstable_IconComponent>
}) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopover adapter={adapter} char="@" className={DIRECTIVE_POPOVER_CLASS}>
      <ComposerPrimitive.Unstable_TriggerPopover.Directive {...directive} />
      <ComposerPrimitive.Unstable_TriggerPopoverCategories>
        {categories => (
          <div className="grid gap-1">
            {categories.map(c => (
              <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
                categoryId={c.id}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-accent data-highlighted:bg-accent"
                key={c.id}
              >
                <span>{c.label}</span>
                <ChevronDown className="-rotate-90 size-3.5 text-muted-foreground" />
              </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
            ))}
          </div>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverCategories>
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {items => (
          <div className="grid gap-1">
            <ComposerPrimitive.Unstable_TriggerPopoverBack className="mb-1 text-xs text-muted-foreground hover:text-foreground">
              Back
            </ComposerPrimitive.Unstable_TriggerPopoverBack>
            {items.map((item, index) => {
              const Icon = directiveIcon(item, iconMap, Fallback)

              return (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent data-highlighted:bg-accent"
                  index={index}
                  item={item}
                  key={`${item.type}:${item.id}`}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{item.label}</span>
                    {item.description && (
                      <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                    )}
                  </span>
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              )
            })}
          </div>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </ComposerPrimitive.Unstable_TriggerPopover>
  )
}

function UrlDialog({
  inputRef,
  onChange,
  onOpenChange,
  onSubmit,
  open,
  value
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  open: boolean
  value: string
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add URL Context</DialogTitle>
          <DialogDescription>
            Hermes will fetch this URL via the existing @url context resolver when you send the prompt.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <Input
            onChange={e => onChange(e.target.value)}
            placeholder="https://example.com"
            ref={inputRef}
            value={value}
          />
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!value.trim()} type="submit">
              Add URL
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function buildMentionCategories(suggestions: ContextSuggestion[] | undefined): Unstable_MentionCategory[] {
  const items = (suggestions ?? [])
    .map(s => {
      const match = s.text.match(/^@(file|folder|url|image):(.+)$/)

      if (!match) {
        return null
      }

      const [, type, id] = match

      return {
        id,
        type,
        label: s.display || id,
        description: s.meta,
        metadata: { icon: type }
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return [
    { id: 'refs', label: 'Hermes refs', items: REF_ITEMS },
    ...(items.length ? [{ id: 'context', label: 'Suggested files', items }] : [])
  ]
}

function directiveIcon(
  item: Unstable_TriggerItem,
  iconMap: Record<string, Unstable_IconComponent>,
  fallback: Unstable_IconComponent
): Unstable_IconComponent {
  const meta = item.metadata as Record<string, unknown> | undefined
  const key = typeof meta?.icon === 'string' ? meta.icon : item.type

  return iconMap[key] ?? iconMap[item.type] ?? fallback
}
