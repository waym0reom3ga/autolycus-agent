import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
  useAuiState
} from '@assistant-ui/react'
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Volume2Icon,
  VolumeXIcon
} from 'lucide-react'
import { type FC, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useElapsedSeconds } from '@/components/assistant-ui/activity-timer'
import { ActivityTimerText } from '@/components/assistant-ui/activity-timer-text'
import { DirectiveText } from '@/components/assistant-ui/directive-text'
import { GeneratedImageProvider, useGeneratedImageContext } from '@/components/assistant-ui/generated-image-context'
import { ImageGenerationPlaceholder } from '@/components/assistant-ui/image-generation-placeholder'
import { Intro, type IntroProps } from '@/components/assistant-ui/intro'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
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
import { speakText } from '@/hermes'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { setThreadScrolledUp } from '@/store/thread-scroll'

const THINKING_FACES = [
  '(｡•́︿•̀｡)',
  '(◔_◔)',
  '(¬‿¬)',
  '( •_•)>⌐■-■',
  '(⌐■_■)',
  '(´･_･`)',
  '◉_◉',
  '(°ロ°)',
  '( ˘⌣˘)♡',
  'ヽ(>∀<☆)☆',
  '٩(๑❛ᴗ❛๑)۶',
  '(⊙_⊙)',
  '(¬_¬)',
  '( ͡° ͜ʖ ͡°)',
  'ಠ_ಠ'
]

const THINKING_VERBS = [
  'pondering',
  'contemplating',
  'musing',
  'cogitating',
  'ruminating',
  'deliberating',
  'mulling',
  'reflecting',
  'processing',
  'reasoning',
  'analyzing',
  'computing',
  'synthesizing',
  'formulating',
  'brainstorming'
]

type ThreadLoadingState = 'response' | 'session' | 'working'

interface MessageActionProps {
  messageId: string
  messageText: string
  onBranchInNewChat?: (messageId: string) => void
}

const BOTTOM_DISTANCE_PX = 24
let readAloudAudio: HTMLAudioElement | null = null

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - (el.scrollTop + el.clientHeight) <= BOTTOM_DISTANCE_PX
}

function partText(part: unknown): string {
  if (typeof part === 'string') {
    return part
  }

  if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
    return part.text
  }

  return ''
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
}> = ({ intro, loading, onBranchInNewChat }) => {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const messageCount = useAuiState(s => s.thread.messages.length)
  const isRunning = useAuiState(s => s.thread.isRunning)
  const lastMessageId = useAuiState(s => s.thread.messages.at(-1)?.id ?? '')
  const shouldStickToBottomRef = useRef(true)

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const nearBottom = isNearBottom(event.currentTarget)
    shouldStickToBottomRef.current = nearBottom
    setThreadScrolledUp(!nearBottom)
  }, [])

  useEffect(() => {
    return () => setThreadScrolledUp(false)
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    const force = loading === 'session'

    if (!force && !shouldStickToBottomRef.current) {
      return
    }

    viewport.scrollTop = viewport.scrollHeight
    shouldStickToBottomRef.current = true
    setThreadScrolledUp(false)
  }, [isRunning, lastMessageId, loading, messageCount])

  return (
    <GeneratedImageProvider>
      <ThreadPrimitive.Root className="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-transparent">
        <AuiIf condition={s => Boolean(intro) && s.thread.isEmpty}>{intro && <Intro {...intro} />}</AuiIf>

        <ThreadPrimitive.Viewport
          className="h-full min-h-0 overflow-y-auto overscroll-contain px-[clamp(1rem,10%,12rem)] pt-[calc(var(--vsq)*19)] scroll-smooth"
          data-slot="aui_thread-viewport"
          onScroll={handleScroll}
          ref={viewportRef}
          scrollToBottomOnInitialize
          scrollToBottomOnRunStart
          scrollToBottomOnThreadSwitch
        >
          <div className="flex w-full flex-col gap-3">
            <ThreadPrimitive.Messages>{() => <ThreadMessage onBranchInNewChat={onBranchInNewChat} />}</ThreadPrimitive.Messages>
            {loading === 'response' && <ResponseLoadingIndicator />}
            {loading === 'working' && <WorkingIndicator />}
          </div>
          <ThreadPrimitive.ViewportFooter className="h-[220px] shrink-0" />
        </ThreadPrimitive.Viewport>
        {loading === 'session' && <CenteredThreadSpinner />}
      </ThreadPrimitive.Root>
    </GeneratedImageProvider>
  )
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

const ThreadMessage: FC<{ onBranchInNewChat?: (messageId: string) => void }> = ({ onBranchInNewChat }) => {
  const role = useAuiState(s => s.message.role)
  const isEditing = useAuiState(s => s.message.composer.isEditing)

  // The runtime synthesizes an empty assistant placeholder while isRunning is true
  // (last message is user). Rendering the full `MessagePrimitive.Root` for it adds
  // ~36px of invisible chrome (gap-2 + min-h-7 footer) which can push the
  // loading affordance too far below the user message. Skip it —
  // `ResponseLoadingIndicator` in the viewport handles the loading affordance directly.
  const isPlaceholder = useAuiState(
    s => s.message.role === 'assistant' && s.message.status?.type === 'running' && s.message.content.length === 0
  )

  if (isEditing) {
    return <EditComposer />
  }

  if (role === 'user') {
    return <UserMessage />
  }

  if (isPlaceholder) {
    return null
  }

  return <AssistantMessage onBranchInNewChat={onBranchInNewChat} />
}

const AssistantMessage: FC<{ onBranchInNewChat?: (messageId: string) => void }> = ({ onBranchInNewChat }) => {
  const messageId = useAuiState(s => s.message.id)
  const content = useAuiState(s => s.message.content)
  const messageText = messageContentText(content)

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
  const [tick, setTick] = useState(0)
  const elapsed = useElapsedSeconds()

  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 900)

    return () => window.clearInterval(id)
  }, [])

  const face = THINKING_FACES[tick % THINKING_FACES.length]
  const verb = THINKING_VERBS[tick % THINKING_VERBS.length]

  return (
    <StatusRow label="Hermes is loading a response">
      <span className="shimmer shimmer-repeat-delay-0 min-w-0 truncate text-muted-foreground/55">
        {face} {verb}…
      </span>
      <ActivityTimerText seconds={elapsed} />
    </StatusRow>
  )
}

const WorkingIndicator: FC = () => {
  const elapsed = useElapsedSeconds()

  return (
    <StatusRow label="Hermes is still working">
      <Loader className="size-4 text-muted-foreground/60" label="Still working" strokeScale={0.65} type="spiral-search" />
      <span className="shimmer min-w-0 truncate text-muted-foreground/60">Still working…</span>
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
            <ReadAloudItem text={messageText} />
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

let currentAudio: HTMLAudioElement | null = null

function stopCurrentAudio() {
  if (!currentAudio) {
    return
  }

  currentAudio.pause()
  currentAudio.src = ''
  currentAudio = null
}

const ReadAloudItem: FC<{ text: string }> = ({ text }) => {
  const [reading, setReading] = useState(false)
  const seqRef = useRef(0)

  const stop = useCallback(() => {
    seqRef.current += 1
    stopCurrentAudio()
    setReading(false)
  }, [])

  const read = useCallback(async () => {
    if (!text) {
      return
    }

    stopCurrentAudio()
    const seq = ++seqRef.current
    const isCurrent = () => seq === seqRef.current

    const finish = () => {
      if (!isCurrent()) {
        return
      }

      currentAudio = null
      setReading(false)
    }

    setReading(true)

    try {
      const { data_url } = await speakText(text)

      if (!isCurrent()) {
        return
      }

      const audio = new Audio(data_url)
      currentAudio = audio
      audio.addEventListener('ended', finish, { once: true })
      audio.addEventListener('error', finish, { once: true })
      await audio.play()
    } catch (error) {
      if (isCurrent()) {
        notifyError(error, 'Read aloud failed')
        finish()
      }
    }
  }, [text])

  const Icon = reading ? VolumeXIcon : Volume2Icon

  return (
    <DropdownMenuItem
      disabled={!reading && !text}
      onSelect={e => {
        e.preventDefault()
        void (reading ? stop() : read())
      }}
    >
      <Icon />
      {reading ? 'Stop reading' : 'Read aloud'}
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
  return (
    <MessagePrimitive.Root
      className="group flex max-w-[min(72%,34rem)] flex-col gap-2 self-end rounded-2xl border border-[color-mix(in_srgb,var(--dt-user-bubble-border)_78%,transparent)] bg-[color-mix(in_srgb,var(--dt-user-bubble)_94%,transparent)] px-3 py-2"
      data-role="user"
      data-slot="aui_user-message-root"
    >
      <div className="wrap-anywhere whitespace-pre-line leading-[1.48] text-foreground/95">
        <MessagePrimitive.Parts components={{ Text: DirectiveText }} />
      </div>
    </MessagePrimitive.Root>
  )
}

const EditComposer: FC = () => {
  // Editing requires a real onEdit implementation against Hermes history.
  // Hide the edit composer until that contract is implemented.
  return null
}
