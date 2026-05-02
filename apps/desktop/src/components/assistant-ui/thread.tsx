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
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GitBranchIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon
} from 'lucide-react'
import {
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
// Scroll behavior: delegated to `use-stick-to-bottom` (StackBlitz), the
// reference implementation that powers bolt.new and several other streaming
// chat UIs. It handles everything we care about — spring-animated catch-up,
// resize-vs-user-scroll disambiguation, wheel/touch escape, text-selection
// pause, subpixel overshoot, programmatic-scroll event suppression — via 665
// lines of well-tested edge-case handling that we should NOT hand-roll.
//
// We only own the thin glue: jump-to-bottom on session switch / send, and
// keeping `$threadScrolledUp` in sync with `isAtBottom` for the composer's
// dim-when-scrolled-away treatment.
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import spinners from 'unicode-animations'

import { useElapsedSeconds } from '@/components/assistant-ui/activity-timer'
import { ActivityTimerText } from '@/components/assistant-ui/activity-timer-text'
import { ClarifyTool } from '@/components/assistant-ui/clarify-tool'
import { DirectiveText } from '@/components/assistant-ui/directive-text'
import { GeneratedImageProvider, useGeneratedImageContext } from '@/components/assistant-ui/generated-image-context'
import { ImageGenerationPlaceholder } from '@/components/assistant-ui/image-generation-placeholder'
import { Intro, type IntroProps } from '@/components/assistant-ui/intro'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { PreviewAttachment } from '@/components/assistant-ui/preview-attachment'
import { ToolFallback } from '@/components/assistant-ui/tool-fallback'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Loader } from '@/components/ui/loader'
import { triggerHaptic } from '@/lib/haptics'
import { extractPreviewTargets } from '@/lib/preview-targets'
import { cn } from '@/lib/utils'
import { playSpeechText, stopVoicePlayback } from '@/lib/voice-playback'
import { notifyError } from '@/store/notifications'
import { setThreadScrolledUp } from '@/store/thread-scroll'
import { $voicePlayback } from '@/store/voice-playback'

const RESPONSE_SPINNER = spinners.braille

type ThreadLoadingState = 'response' | 'session'

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

export const Thread: FC<{
  intro?: IntroProps
  loading?: ThreadLoadingState
  onBranchInNewChat?: (messageId: string) => void
  sessionKey?: string | null
}> = ({ intro, loading, onBranchInNewChat, sessionKey }) => {
  return (
    <GeneratedImageProvider>
      <ThreadPrimitive.Root className="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-transparent">
        <AuiIf condition={s => Boolean(intro) && s.thread.isEmpty}>{intro && <Intro {...intro} />}</AuiIf>

        <ThreadPrimitive.ViewportProvider>
          {/*
           * <StickToBottom> renders a wrapper <div>; <StickToBottom.Content>
           * renders an inner scroll container (inline height/width 100%) plus
           * an inner content div. So:
           *   - `className` on <StickToBottom>        = outer wrapper sizing
           *   - `scrollClassName` on <.Content>       = scroll container
           *   - `className` on <.Content>             = content (flex column)
           *
           * `initial: 'instant'`: no animation on first mount.
           * `resize: 'instant'`: during streaming, snap to bottom each token.
           *   Spring animation ('smooth') visibly lags behind fast token
           *   streams; users read that as jank. 'instant' matches ChatGPT.
           *
           * The composer is rendered OUTSIDE the scroller as `position:
           * absolute; bottom: 0` (floating glass treatment) and overlays the
           * bottom of the scroll surface. We compensate by putting a tall
           * bottom spacer (>= composer height + margin) inside the scroll
           * content so "scroll to bottom" naturally parks the last line of
           * content above the composer, not hidden behind it.
           */}
          <StickToBottom
            className="relative h-full min-h-0"
            initial="instant"
            resize="instant"
          >
            <ThreadScrollSync sessionKey={sessionKey} />
            <StickToBottom.Content
              className="mx-auto flex w-full max-w-[48rem] flex-col gap-3 px-4 pt-[calc(var(--vsq)*19)] sm:px-6 lg:px-8"
              data-slot="aui_thread-content"
              scrollClassName="overflow-y-auto overscroll-contain"
            >
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

/**
 * Scroll glue for the chat thread. Replaces hand-rolled follow logic with
 * the exact pattern that assistant-ui's own `useThreadViewportAutoScroll`
 * uses internally: **raw DOM scroll + an armed behavior ref + a
 * ResizeObserver loop that re-pins to bottom until we actually reach it.**
 *
 * Why not use the library's `scrollToBottom` for sends?
 *   - It wraps its work in `new Promise(requestAnimationFrame)` so even
 *     `animation: 'instant'` is 1+ frame async.
 *   - It does NOT clear `escapedFromLock` on call — if the user had
 *     scrolled up before sending, the library's resize handler keeps
 *     un-setting `isAtBottom` between our scroll and the next resize.
 *   - `ignoreEscapes` only blocks NEW escapes during the animation; it
 *     doesn't unstick an already-escaped state.
 *
 * The armed-ref pattern handles all of that:
 *   1. `thread.runStart` fires after the runtime has committed the user
 *      message to state (so scrollHeight already reflects it).
 *   2. We arm a ref ('instant') and write `scrollTop = scrollHeight`
 *      synchronously.
 *   3. A ResizeObserver on the content keeps re-pinning each time the
 *      DOM grows (user message paints, assistant placeholder mounts,
 *      assistant streams) until scrollTop is actually at bottom — then
 *      we disarm.
 *   4. Any wheel-up or touch-scroll-up disarms immediately so the user
 *      can always escape.
 *
 * This mirrors:
 *   - assistant-ui's `useThreadViewportAutoScroll` (scrollToBottomBehaviorRef
 *     + useOnResizeContent loop)
 *   - Vercel ai-chatbot's `useScrollToBottom` (MutationObserver + RO on
 *     container and children + isAtBottom/isUserScrolling flags)
 *
 * Must be rendered INSIDE a <StickToBottom> because useStickToBottomContext
 * reads from that component's context.
 */
const ThreadScrollSync: FC<{ sessionKey?: string | null }> = ({ sessionKey }) => {
  const { scrollRef, isAtBottom, state } = useStickToBottomContext()
  const sessionKeyRef = useRef<string | null>(sessionKey ?? null)

  // "Armed" behavior ref. Non-null = "keep chasing bottom across resize
  // ticks until we get there." Null = "user owns the viewport."
  const armedRef = useRef<ScrollBehavior | null>(null)

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

  // Slam to bottom + arm the ref. Also forces library state flags off
  // so its internal resize handler doesn't fight our re-pins.
  const armAndPin = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    armedRef.current = behavior
    // Clear the library's escape/at-bottom flags directly on the mutable
    // state object so its resize handler sees a clean follow state.
    state.escapedFromLock = false
    state.isAtBottom = true
    el.scrollTop = el.scrollHeight
  }, [scrollRef, state])

  // ResizeObserver loop — re-pins to bottom while armed, disarms when
  // actually at bottom. This is the assistant-ui pattern.
  useEffect(() => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    const observer = new ResizeObserver(() => {
      const behavior = armedRef.current

      if (!behavior) {
        return
      }

      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)

      if (distance < 2) {
        armedRef.current = null

        return
      }

      el.scrollTop = el.scrollHeight
    })

    observer.observe(el)

    const content = el.firstElementChild

    if (content) {
      observer.observe(content)
    }

    return () => observer.disconnect()
  }, [scrollRef])

  // User-intent detection — any upward gesture disarms the chase.
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

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchmove', onTouch, { passive: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', onTouch)
    }
  }, [scrollRef])

  // (1) Session switch — strong intent to see the bottom of the new thread.
  useEffect(() => {
    const next = sessionKey ?? null

    if (sessionKeyRef.current === next) {
      return
    }

    sessionKeyRef.current = next
    prevMessageCountRef.current = 0
    armAndPin('auto')
  }, [armAndPin, sessionKey])

  // (2) Bulk message load (session history arriving from storage) — pin
  // to bottom and stay armed while the thread's markdown/code/images
  // settle over the next several frames.
  useEffect(() => {
    const prev = prevMessageCountRef.current
    prevMessageCountRef.current = messageCount

    if (prev === 0 && messageCount > 0) {
      armAndPin('auto')
    }
  }, [armAndPin, messageCount])

  // (3) User send — the runtime event `thread.runStart` fires after the
  // user message has been committed to state (scrollHeight already reflects
  // it). This is the canonical signal per assistant-ui's own code. We
  // arm-and-pin synchronously in the callback, then the RO loop above
  // keeps us at bottom as the assistant message placeholder + reply stream.
  useAuiEvent('thread.runStart', () => {
    armAndPin('instant')
  })

  return null
}

/**
 * Invisible bottom spacer whose height matches the currently-measured
 * composer height (plus a small gap). Because the composer is rendered
 * OUTSIDE the scroll container as `position: absolute; bottom: 0`, "scroll
 * to bottom" would otherwise park the last content line behind it. By
 * extending the scroll content down with real (blank) space equal to the
 * composer's footprint, the library's scroll-to-scrollHeight naturally
 * leaves the last message line sitting above the composer.
 *
 * A ResizeObserver on the composer keeps the spacer in sync when the
 * textarea grows (multi-line input), attachments expand, or the composer
 * enters a focused/expanded state.
 */
const COMPOSER_BREATHING_ROOM_PX = 20

const ComposerClearance: FC = () => {
  const [height, setHeight] = useState<number>(() => {
    // Sensible default until the observer wires up (~ 8rem).
    if (typeof document === 'undefined') return 128
    const composer = document.querySelector<HTMLElement>('[data-slot="composer-root"]')

    return composer ? composer.getBoundingClientRect().height + COMPOSER_BREATHING_ROOM_PX : 128
  })

  useEffect(() => {
    const composer = document.querySelector<HTMLElement>('[data-slot="composer-root"]')

    if (!composer) {
      return
    }

    const apply = () => {
      const h = composer.getBoundingClientRect().height

      setHeight(prev => {
        const next = Math.round(h + COMPOSER_BREATHING_ROOM_PX)

        return Math.abs(prev - next) < 1 ? prev : next
      })
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(composer)

    return () => observer.disconnect()
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
      className="size-12 text-primary/70"
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
  const previewTargets = pickPrimaryPreviewTarget(extractPreviewTargets(messageText))
  const isPlaceholder = useAuiState(s => s.message.status?.type === 'running' && s.message.content.length === 0)

  if (isPlaceholder) {
    return null
  }

  return (
    <MessagePrimitive.Root
      className="group flex w-full flex-col gap-2 self-start"
      data-role="assistant"
      data-slot="aui_assistant-message-root"
    >
      <div className="wrap-anywhere text-pretty text-foreground" data-slot="aui_assistant-message-content">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: ReasoningPart,
            tools: { Fallback: ChainToolFallback }
          }}
        />
        {previewTargets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previewTargets.map(target => (
              <PreviewAttachment key={target} target={target} />
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
      <div className="min-h-6">
        <AssistantFooter messageId={messageId} messageText={messageText} onBranchInNewChat={onBranchInNewChat} />
      </div>
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
  const [frame, setFrame] = useState(0)
  const elapsed = useElapsedSeconds()

  useEffect(() => {
    const id = window.setInterval(
      () => setFrame(current => (current + 1) % RESPONSE_SPINNER.frames.length),
      RESPONSE_SPINNER.interval
    )

    return () => window.clearInterval(id)
  }, [])

  return (
    <StatusRow label="Hermes is loading a response">
      <span aria-hidden="true" className="font-mono text-base leading-none text-muted-foreground/60">
        {RESPONSE_SPINNER.frames[frame]}
      </span>
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
    <div className="mb-3 text-sm text-muted-foreground">
      <button
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pr-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <ChevronRightIcon
          className={cn('size-3 shrink-0 text-muted-foreground/80 transition-transform', open && 'rotate-90')}
        />
        <span
          className={cn('shrink-0 text-xs font-medium text-foreground/70', pending && 'shimmer text-foreground/55')}
        >
          Thinking
        </span>
        {pending && <ActivityTimerText seconds={elapsed} />}
      </button>
      {open && <div className="ml-4 mt-1 max-w-full wrap-anywhere border-l border-border pl-3">{children}</div>}
    </div>
  )
}

const ReasoningPart: FC<{ text: string; status?: { type: string } }> = ({ text, status }) => (
  <div className="mb-1 mt-1">
    <ThinkingDisclosure pending={status?.type === 'running'}>
      <div
        className={cn(
          'whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/85',
          status?.type === 'running' && 'shimmer text-muted-foreground/55'
        )}
      >
        {text}
      </div>
    </ThinkingDisclosure>
  </div>
)

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
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    if (!text) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      triggerHaptic('selection')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      notifyError(error, 'Copy failed')
    }
  }, [text])

  return (
    <TooltipIconButton disabled={!text} onClick={() => void copy()} tooltip={copied ? 'Copied' : 'Copy'}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </TooltipIconButton>
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
  <div className="flex min-h-6 flex-col items-start gap-1">
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

const UserMessage: FC = () => {
  const content = useAuiState(s => s.message.content)
  const messageText = messageContentText(content)

  return (
    <MessagePrimitive.Root
      className="group flex max-w-[min(72%,34rem)] flex-col items-end gap-2 self-end"
      data-role="user"
      data-slot="aui_user-message-root"
    >
      <div className="wrap-anywhere whitespace-pre-line rounded-2xl border border-[color-mix(in_srgb,var(--dt-user-bubble-border)_78%,transparent)] bg-[color-mix(in_srgb,var(--dt-user-bubble)_94%,transparent)] px-3 py-2 leading-[1.48] text-foreground/95">
        <MessagePrimitive.Parts components={{ Text: DirectiveText }} />
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
      className="min-h-8 w-full resize-none bg-transparent leading-[1.48] text-foreground/95 outline-none"
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
