import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
  useAuiEvent,
  useAuiState
} from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'

import { useElapsedSeconds } from '@/components/assistant-ui/activity-timer'
import { ActivityTimerText } from '@/components/assistant-ui/activity-timer-text'
import { ClarifyTool } from '@/components/assistant-ui/clarify-tool'
import { DirectiveContent, DirectiveText } from '@/components/assistant-ui/directive-text'
import { GeneratedImageProvider, useGeneratedImageContext } from '@/components/assistant-ui/generated-image-context'
import { ImageGenerationPlaceholder } from '@/components/assistant-ui/image-generation-placeholder'
import { Intro, type IntroProps } from '@/components/assistant-ui/intro'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { PreviewAttachment } from '@/components/assistant-ui/preview-attachment'
import { ToolFallback } from '@/components/assistant-ui/tool-fallback'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Loader } from '@/components/ui/loader'
import { triggerHaptic } from '@/lib/haptics'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitBranchIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon
} from '@/lib/icons'
import { extractPreviewTargets } from '@/lib/preview-targets'
import { cn } from '@/lib/utils'
import { playSpeechText, stopVoicePlayback } from '@/lib/voice-playback'
import { notifyError } from '@/store/notifications'
import { setThreadScrolledUp } from '@/store/thread-scroll'
import { $voicePlayback } from '@/store/voice-playback'

type ThreadLoadingState = 'response' | 'session'

interface StickyStateFlags {
  escapedFromLock: boolean
  isAtBottom: boolean
}

interface MessageActionProps {
  messageId: string
  messageText: string
  onBranchInNewChat?: (messageId: string) => void
}

let readAloudAudio: HTMLAudioElement | null = null

function partText(part: unknown): string {
  if (typeof part === 'string') {
    return part
  }

  if (!part || typeof part !== 'object') {
    return ''
  }

  const row = part as { text?: unknown; type?: unknown }

  return (!row.type || row.type === 'text') && typeof row.text === 'string' ? row.text : ''
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  return Array.isArray(content) ? content.map(partText).join('').trim() : ''
}

function resetStickyState(state: StickyStateFlags) {
  state.escapedFromLock = false
  state.isAtBottom = true
}

function pinElementToBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight

  return el.scrollTop
}

export const Thread: FC<{
  intro?: IntroProps
  loading?: ThreadLoadingState
  onBranchInNewChat?: (messageId: string) => void
  sessionKey?: string | null
}> = ({ intro, loading, onBranchInNewChat, sessionKey }) => {
  return (
    <GeneratedImageProvider>
      <ThreadPrimitive.Root className="relative grid h-full min-h-0 max-w-full grid-rows-[minmax(0,1fr)] overflow-hidden bg-transparent contain-[layout_paint]">
        <ThreadPrimitive.ViewportProvider>
          <StickToBottom
            className="relative h-full min-h-0 max-w-full overflow-hidden contain-[layout_paint]"
            initial="instant"
            resize="instant"
          >
            <ThreadScrollSync sessionKey={sessionKey} />
            <StickToBottom.Content
              className="scroll-auto pb-(--thread-bottom-pad) mx-auto flex w-full max-w-[calc(var(--composer-width)-2rem)] min-w-0 flex-col gap-3 px-4 pt-[calc(var(--vsq)*19)] sm:px-6 lg:px-8"
              data-slot="aui_thread-content"
              scrollClassName="overflow-x-hidden overflow-y-auto overscroll-contain"
            >
              <AuiIf condition={s => Boolean(intro) && s.thread.isEmpty}>{intro && <Intro {...intro} />}</AuiIf>
              <ThreadPrimitive.Messages
                components={{
                  AssistantMessage: () => <AssistantMessage onBranchInNewChat={onBranchInNewChat} />,
                  SystemMessage,
                  UserEditComposer,
                  UserMessage
                }}
              />
              {loading === 'response' && <ResponseLoadingIndicator />}
              <ComposerClearance />
            </StickToBottom.Content>
          </StickToBottom>
        </ThreadPrimitive.ViewportProvider>
        {loading === 'session' && <CenteredThreadSpinner />}
      </ThreadPrimitive.Root>
    </GeneratedImageProvider>
  )
}

const ThreadScrollSync: FC<{ sessionKey?: string | null }> = ({ sessionKey }) => {
  const { scrollRef, isAtBottom, state } = useStickToBottomContext()
  const sessionKeyRef = useRef<string | null>(sessionKey ?? null)

  const armedRef = useRef<ScrollBehavior | null>(null)
  const pinRafRef = useRef<number | null>(null)
  const previousScrollTopRef = useRef(0)
  const suppressNextScrollEventRef = useRef(false)

  const messageCount = useAuiState(s => s.thread.messages.length)
  const prevMessageCountRef = useRef(messageCount)

  useEffect(() => {
    setThreadScrolledUp(!isAtBottom)
  }, [isAtBottom])

  useEffect(() => {
    return () => {
      setThreadScrolledUp(false)
    }
  }, [])

  const armAndPin = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scrollRef.current

      if (!el) {
        return
      }

      armedRef.current = behavior
      resetStickyState(state)
      suppressNextScrollEventRef.current = true
      previousScrollTopRef.current = pinElementToBottom(el)
    },
    [scrollRef, state]
  )

  useEffect(() => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    const observer = new ResizeObserver(() => {
      if (pinRafRef.current !== null) {
        return
      }

      pinRafRef.current = window.requestAnimationFrame(() => {
        pinRafRef.current = null

        if (!armedRef.current) {
          return
        }

        const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)

        if (distance < 2) {
          armedRef.current = null

          return
        }

        suppressNextScrollEventRef.current = true
        previousScrollTopRef.current = pinElementToBottom(el)
      })
    })

    observer.observe(el)

    const content = el.firstElementChild

    if (content) {
      observer.observe(content)
    }

    return () => {
      observer.disconnect()

      if (pinRafRef.current !== null) {
        window.cancelAnimationFrame(pinRafRef.current)
        pinRafRef.current = null
      }
    }
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        armedRef.current = null
      }
    }

    const onTouch = () => {
      armedRef.current = null
    }

    const onScroll = () => {
      const currentTop = el.scrollTop

      if (suppressNextScrollEventRef.current) {
        suppressNextScrollEventRef.current = false
        previousScrollTopRef.current = currentTop

        return
      }

      if (currentTop + 1 < previousScrollTopRef.current) {
        armedRef.current = null
      }

      previousScrollTopRef.current = currentTop
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchmove', onTouch, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', onTouch)
      el.removeEventListener('scroll', onScroll)
    }
  }, [scrollRef])

  useEffect(() => {
    const next = sessionKey ?? null

    if (sessionKeyRef.current === next) {
      return
    }

    sessionKeyRef.current = next
    prevMessageCountRef.current = 0
    armAndPin('auto')
  }, [armAndPin, sessionKey])

  useEffect(() => {
    const prev = prevMessageCountRef.current
    prevMessageCountRef.current = messageCount

    if (prev === 0 && messageCount > 0) {
      armAndPin('auto')
    }
  }, [armAndPin, messageCount])

  useAuiEvent('thread.runStart', () => {
    armAndPin('instant')
  })

  return null
}

const COMPOSER_BREATHING_ROOM_PX = 36
const DEFAULT_COMPOSER_CLEARANCE_PX = 192

const ComposerClearance: FC = () => {
  const [height, setHeight] = useState<number>(() => {
    if (typeof document === 'undefined') {
      return DEFAULT_COMPOSER_CLEARANCE_PX
    }

    const composer = document.querySelector<HTMLElement>('[data-slot="composer-root"]')

    return composer
      ? composer.getBoundingClientRect().height + COMPOSER_BREATHING_ROOM_PX
      : DEFAULT_COMPOSER_CLEARANCE_PX
  })

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    let composerObserver: ResizeObserver | null = null
    let observedComposer: HTMLElement | null = null

    const apply = (composer: HTMLElement) => {
      const h = composer.getBoundingClientRect().height

      setHeight(prev => {
        const next = Math.round(h + COMPOSER_BREATHING_ROOM_PX)

        return Math.abs(prev - next) < 1 ? prev : next
      })
    }

    const bindComposer = () => {
      if (typeof document === 'undefined') {
        return false
      }

      const composer = document.querySelector<HTMLElement>('[data-slot="composer-root"]')

      if (!composer || composer === observedComposer) {
        return false
      }

      observedComposer = composer
      apply(composer)
      composerObserver?.disconnect()
      composerObserver = new ResizeObserver(() => apply(composer))
      composerObserver.observe(composer)

      return true
    }

    bindComposer()
    let bindRaf: number | null = null
    let bindAttempts = 0

    const tryBindComposer = () => {
      if (bindComposer()) {
        return
      }

      if (bindAttempts >= 120) {
        return
      }

      bindAttempts += 1
      bindRaf = window.requestAnimationFrame(tryBindComposer)
    }

    tryBindComposer()

    return () => {
      composerObserver?.disconnect()

      if (bindRaf !== null) {
        window.cancelAnimationFrame(bindRaf)
      }
    }
  }, [])

  return <div aria-hidden="true" className="shrink-0" style={{ height: `${height}px` }} />
}

function pickPrimaryPreviewTarget(targets: string[]): string[] {
  if (targets.length <= 1) {
    return targets
  }

  const localUrl = targets.find(value => /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(value))

  return [localUrl || targets[targets.length - 1]]
}

const CenteredThreadSpinner: FC = () => (
  <div
    aria-label="Loading session"
    className="pointer-events-none absolute inset-0 z-1 grid place-items-center"
    role="status"
  >
    <Loader
      aria-hidden="true"
      className="size-12 text-midground/70"
      pathSteps={220}
      role="presentation"
      strokeScale={0.72}
      type="rose-curve"
    />
  </div>
)

const AssistantMessage: FC<{ onBranchInNewChat?: (messageId: string) => void }> = ({ onBranchInNewChat }) => {
  const messageId = useAuiState(s => s.message.id)
  const content = useAuiState(s => s.message.content)
  const messageText = messageContentText(content)

  const previewTargets = useMemo(() => {
    if (!messageText || !/(https?:\/\/|file:\/\/)/i.test(messageText)) {
      return []
    }

    return pickPrimaryPreviewTarget(extractPreviewTargets(messageText))
  }, [messageText])

  const isPlaceholder = useAuiState(s => s.message.status?.type === 'running' && s.message.content.length === 0)

  if (isPlaceholder) {
    return null
  }

  return (
    <MessagePrimitive.Root
      className="group flex w-full min-w-0 max-w-full flex-col gap-2 self-start overflow-hidden"
      data-role="assistant"
      data-slot="aui_assistant-message-root"
    >
      <div
        className="wrap-anywhere min-w-0 max-w-full overflow-hidden text-pretty text-base leading-(--dt-line-height) text-foreground"
        data-slot="aui_assistant-message-content"
      >
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: ReasoningTextPart,
            ReasoningGroup: ReasoningAccordionGroup,
            tools: { Fallback: ChainToolFallback }
          }}
        />
        {previewTargets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previewTargets.map(target => (
              <PreviewAttachment key={target} source="explicit-link" target={target} />
            ))}
          </div>
        )}
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root
            className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
      {messageText.trim().length > 0 && (
        <div className="min-h-6">
          <AssistantFooter messageId={messageId} messageText={messageText} onBranchInNewChat={onBranchInNewChat} />
        </div>
      )}
    </MessagePrimitive.Root>
  )
}

const STATUS_ROW_CLASS = 'flex max-w-full items-center gap-2 self-start text-sm text-muted-foreground/70'

const StatusRow: FC<{ children: ReactNode; label: string }> = ({ children, label }) => (
  <div aria-label={label} aria-live="polite" className={STATUS_ROW_CLASS} role="status">
    {children}
  </div>
)

const ResponseLoadingIndicator: FC = () => {
  const elapsed = useElapsedSeconds()

  return (
    <StatusRow label="Hermes is loading a response">
      <span aria-hidden="true" className="dither inline-block size-3 rounded-[2px] text-midground/80 animate-pulse" />
      <ActivityTimerText seconds={elapsed} />
    </StatusRow>
  )
}

const ImageGenerateTool: FC<ToolCallMessagePartProps> = ({ result }) => {
  const generatedImage = useGeneratedImageContext()
  const running = result === undefined

  useEffect(() => {
    generatedImage?.setPending(running)
  }, [generatedImage, running])

  if (!running) {
    return null
  }

  return (
    <div className="mt-2">
      <ImageGenerationPlaceholder />
    </div>
  )
}

const ChainToolFallback: FC<ToolCallMessagePartProps> = props => {
  if (props.toolName === 'image_generate') {
    return <ImageGenerateTool {...props} />
  }

  if (props.toolName === 'clarify') {
    return <ClarifyTool {...props} />
  }

  return <ToolFallback {...props} />
}

const ThinkingDisclosure: FC<{
  children: ReactNode
  pending?: boolean
}> = ({ children, pending = false }) => {
  const [open, setOpen] = useState(false)
  const elapsed = useElapsedSeconds(pending)

  return (
    <div className="text-sm text-muted-foreground" data-slot="tool-block">
      <button
        aria-expanded={open}
        className="group/thinking-row grid w-full min-w-0 cursor-pointer grid-cols-[var(--message-text-indent)_minmax(0,1fr)] items-start py-0.5 pr-2 text-left text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--dt-midground)_8%,transparent)] hover:text-foreground"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <span className="flex h-[1.1rem] items-center justify-center">
          <ChevronRightIcon
            className={cn(
              'size-3 text-muted-foreground/55 transition-transform group-hover/thinking-row:text-muted-foreground/85',
              open && 'rotate-90'
            )}
          />
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              'text-[0.78rem] font-medium leading-[1.1rem] text-foreground/75',
              pending && 'shimmer text-foreground/55'
            )}
          >
            Thinking
          </span>
          {pending && (
            <ActivityTimerText className="text-[0.625rem] tabular-nums text-muted-foreground/55" seconds={elapsed} />
          )}
        </span>
      </button>
      {open && (
        <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden pl-(--message-text-indent) pr-2 wrap-anywhere pb-1">{children}</div>
      )}
    </div>
  )
}

const ReasoningAccordionGroup: FC<{ children?: ReactNode; endIndex: number; startIndex: number }> = ({ children }) => {
  const pending = useAuiState(s => s.message.status?.type === 'running')

  return <ThinkingDisclosure pending={pending}>{children}</ThinkingDisclosure>
}

const ReasoningTextPart: FC<{ text: string; status?: { type: string } }> = ({ text, status }) => {
  const displayText = text.trimStart()

  return (
    <div
      className={cn(
        'whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/85',
        status?.type === 'running' && 'shimmer text-muted-foreground/55'
      )}
      data-slot="aui_reasoning-text"
    >
      {displayText}
    </div>
  )
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

const SHORT_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short'
})

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function formatMessageTimestamp(value: Date | string | number | undefined): string {
  if (!value) {
    return ''
  }

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const dayDelta = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)

  if (dayDelta === 0) {
    return `Today, ${TIME_FMT.format(date)}`
  }

  if (dayDelta === 1) {
    return `Yesterday, ${TIME_FMT.format(date)}`
  }

  return SHORT_FMT.format(date)
}

const ACTION_BAR_CLASS = cn(
  'absolute inset-0 flex gap-1 text-muted-foreground opacity-0 transition-opacity duration-100',
  'pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100',
  'focus-within:pointer-events-auto focus-within:opacity-100'
)

const AssistantActionBar: FC<MessageActionProps> = ({ messageId, messageText, onBranchInNewChat }) => {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative h-6 w-20 shrink-0">
      <ActionBarPrimitive.Root
        className={cn(ACTION_BAR_CLASS, menuOpen && 'pointer-events-auto opacity-100')}
        hideWhenRunning
      >
        <CopyMessageButton text={messageText} />
        <ActionBarPrimitive.Reload asChild>
          <TooltipIconButton onClick={() => triggerHaptic('submit')} tooltip="Refresh">
            <RefreshCwIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Reload>
        <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
          <DropdownMenuTrigger asChild>
            <TooltipIconButton tooltip="More actions">
              <MoreHorizontalIcon />
            </TooltipIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()} sideOffset={6}>
            <MessageTimestamp />
            <DropdownMenuItem onSelect={() => onBranchInNewChat?.(messageId)}>
              <GitBranchIcon />
              Branch in new chat
            </DropdownMenuItem>
            <ReadAloudItem messageId={messageId} text={messageText} />
          </DropdownMenuContent>
        </DropdownMenu>
      </ActionBarPrimitive.Root>
    </div>
  )
}

const CopyMessageButton: FC<{ text: string }> = ({ text }) => {
  return (
    <CopyButton
      appearance="icon"
      buttonSize="icon"
      className="aui-button-icon size-6 p-1"
      disabled={!text}
      label="Copy"
      text={text}
    />
  )
}

const ReadAloudItem: FC<{ messageId: string; text: string }> = ({ messageId, text }) => {
  const voicePlayback = useStore($voicePlayback)

  const readAloudStatus =
    voicePlayback.source === 'read-aloud' && voicePlayback.messageId === messageId ? voicePlayback.status : 'idle'

  const isPreparing = readAloudStatus === 'preparing'
  const isSpeaking = readAloudStatus === 'speaking'
  const anyPlaybackActive = voicePlayback.status !== 'idle'
  const Icon = isPreparing ? Loader2Icon : isSpeaking ? VolumeXIcon : Volume2Icon

  const read = useCallback(async () => {
    if (!text || $voicePlayback.get().status !== 'idle') {
      return
    }

    try {
      await playSpeechText(text, { messageId, source: 'read-aloud' })
    } catch (error) {
      notifyError(error, 'Read aloud failed')
    }
  }, [messageId, text])

  return (
    <DropdownMenuItem
      disabled={isPreparing || (!isSpeaking && (anyPlaybackActive || !text))}
      onSelect={e => {
        e.preventDefault()
        void (isSpeaking ? stopVoicePlayback() : read())
      }}
    >
      <Icon className={isPreparing ? 'animate-spin' : undefined} />
      {isPreparing ? 'Preparing audio...' : isSpeaking ? 'Stop reading' : 'Read aloud'}
    </DropdownMenuItem>
  )
}

const MessageTimestamp: FC = () => {
  const createdAt = useAuiState(s => s.message.createdAt)
  const label = formatMessageTimestamp(createdAt)

  if (!label) {
    return null
  }

  return <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label}</DropdownMenuLabel>
}

const AssistantFooter: FC<MessageActionProps> = props => (
  <div className="flex min-h-6 flex-col items-start gap-1 pl-(--message-text-indent)">
    <BranchPickerPrimitive.Root
      className="inline-flex h-6 items-center gap-1 text-xs text-muted-foreground"
      hideWhenSingleBranch
    >
      <BranchPickerPrimitive.Previous className={branchButtonClass}>
        <ChevronLeftIcon className="size-3.5" />
      </BranchPickerPrimitive.Previous>
      <span className="tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next className={branchButtonClass}>
        <ChevronRightIcon className="size-3.5" />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
    <AssistantActionBar {...props} />
  </div>
)

const branchButtonClass =
  'grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35'

const EMPTY_ATTACHMENT_REFS: string[] = []

function messageAttachmentRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return EMPTY_ATTACHMENT_REFS
  }

  return value.every(ref => typeof ref === 'string') ? value : EMPTY_ATTACHMENT_REFS
}

const UserMessage: FC = () => {
  const content = useAuiState(s => s.message.content)
  const messageText = messageContentText(content)

  const attachmentRefs = useAuiState(s => {
    const custom = (s.message.metadata?.custom ?? {}) as { attachmentRefs?: unknown }

    return messageAttachmentRefs(custom.attachmentRefs)
  })

  const hasBody = messageText.trim().length > 0

  return (
    <MessagePrimitive.Root
      className="group flex min-w-0 max-w-[min(72%,34rem)] flex-col items-end gap-2 self-end overflow-hidden"
      data-role="user"
      data-slot="aui_user-message-root"
    >
      <div className="flex min-w-0 max-w-full flex-col gap-1.5 overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--dt-user-bubble-border)_78%,transparent)] bg-[color-mix(in_srgb,var(--dt-user-bubble)_94%,transparent)] px-3 py-2 text-base leading-(--dt-line-height) text-foreground/95">
        {attachmentRefs.length > 0 && (
          <div className="-mx-1 flex flex-wrap gap-1 border-b border-border/45 pb-1.5">
            <DirectiveContent text={attachmentRefs.join(' ')} />
          </div>
        )}
        {hasBody && (
          <div className="wrap-anywhere whitespace-pre-line">
            <MessagePrimitive.Parts components={{ Text: DirectiveText }} />
          </div>
        )}
      </div>
      <div className="min-h-6">
        <UserActionBar messageText={messageText} />
      </div>
    </MessagePrimitive.Root>
  )
}

const UserActionBar: FC<{ messageText: string }> = ({ messageText }) => (
  <div className="relative h-6 w-14 shrink-0">
    <ActionBarPrimitive.Root className={ACTION_BAR_CLASS} hideWhenRunning>
      <CopyMessageButton text={messageText} />
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton onClick={() => triggerHaptic('selection')} tooltip="Edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  </div>
)

const SLASH_STATUS_RE = /^slash:(?<command>\/[^\n]+)\n(?<output>[\s\S]*)$/

const SystemMessage: FC = () => {
  const text = useAuiState(s => messageContentText(s.message.content))

  if (!text) {
    return null
  }

  const slashStatus = text.match(SLASH_STATUS_RE)

  if (slashStatus?.groups) {
    return (
      <MessagePrimitive.Root
        className="max-w-[min(86%,44rem)] self-center px-2 py-0.5 text-center text-[0.6875rem] leading-5 text-muted-foreground/60"
        data-role="system"
        data-slot="aui_system-message-root"
      >
        <span className="font-mono text-muted-foreground/55">{slashStatus.groups.command}</span>
        <span className="mx-1.5 text-muted-foreground/35">·</span>
        <span className="whitespace-pre-wrap">{slashStatus.groups.output.trim()}</span>
      </MessagePrimitive.Root>
    )
  }

  return (
    <MessagePrimitive.Root
      className="max-w-[min(86%,44rem)] self-center px-2 py-0.5 text-center text-[0.6875rem] leading-5 text-muted-foreground/55"
      data-role="system"
      data-slot="aui_system-message-root"
    >
      <span className="whitespace-pre-wrap">{text}</span>
    </MessagePrimitive.Root>
  )
}

const UserEditComposer: FC = () => (
  <ComposerPrimitive.Root
    className="flex min-w-[min(18rem,72vw)] max-w-[min(72%,34rem)] flex-col gap-1.5 self-end rounded-2xl border border-[color-mix(in_srgb,var(--dt-user-bubble-border)_88%,transparent)] bg-[color-mix(in_srgb,var(--dt-user-bubble)_98%,transparent)] px-3 py-2 shadow-sm"
    data-slot="aui_edit-composer-root"
  >
    <ComposerPrimitive.Input
      autoFocus
      className="min-h-8 w-full resize-none bg-transparent text-base leading-(--dt-line-height) text-foreground/95 outline-none"
      rows={1}
      submitMode="enter"
      unstable_focusOnScrollToBottom={false}
    />
    <div className="flex justify-end gap-1">
      <ComposerPrimitive.Cancel asChild>
        <TooltipIconButton tooltip="Cancel edit">
          <XIcon />
        </TooltipIconButton>
      </ComposerPrimitive.Cancel>
      <ComposerPrimitive.Send asChild>
        <TooltipIconButton onClick={() => triggerHaptic('submit')} tooltip="Send edit">
          <CheckIcon />
        </TooltipIconButton>
      </ComposerPrimitive.Send>
    </div>
  </ComposerPrimitive.Root>
)
