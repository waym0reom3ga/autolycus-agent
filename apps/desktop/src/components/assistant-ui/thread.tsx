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
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import { type FC, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { formatElapsed, useElapsedSeconds } from '@/components/assistant-ui/activity-timer'
import { DirectiveText } from '@/components/assistant-ui/directive-text'
import { GeneratedImageProvider, useGeneratedImageContext } from '@/components/assistant-ui/generated-image-context'
import { ImageGenerationPlaceholder } from '@/components/assistant-ui/image-generation-placeholder'
import { Intro, type IntroProps } from '@/components/assistant-ui/intro'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { ToolFallback } from '@/components/assistant-ui/tool-fallback'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { cn } from '@/lib/utils'
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

type ThreadLoadingState = 'response' | 'session'
const BOTTOM_DISTANCE_PX = 24

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - (el.scrollTop + el.clientHeight) <= BOTTOM_DISTANCE_PX
}

export const Thread: FC<{
  intro?: IntroProps
  loading?: ThreadLoadingState
}> = ({ intro, loading }) => {
  const [autoScroll, setAutoScroll] = useState(true)
  const previousLoading = useRef<ThreadLoadingState | undefined>(undefined)

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    const nearBottom = isNearBottom(el)
    setThreadScrolledUp(!nearBottom)

    if (nearBottom) {
      setAutoScroll(true)
    }
  }, [])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      setAutoScroll(false)
    }
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()

    if (event.clientX >= rect.right - 18) {
      setAutoScroll(false)
    }
  }, [])

  useEffect(() => {
    if (loading === 'response' && previousLoading.current !== 'response') {
      setAutoScroll(true)
    }

    previousLoading.current = loading
  }, [loading])

  useEffect(() => {
    return () => setThreadScrolledUp(false)
  }, [])

  return (
    <GeneratedImageProvider>
      <ThreadPrimitive.Root className="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-transparent">
        <AuiIf condition={s => Boolean(intro) && s.thread.isEmpty}>{intro && <Intro {...intro} />}</AuiIf>

        <ThreadPrimitive.Viewport
          autoScroll={autoScroll}
          className="h-full min-h-0 overflow-y-auto overscroll-contain px-[clamp(1rem,10%,12rem)] pb-32 pt-[calc(var(--vsq)*19)] scroll-smooth"
          data-slot="aui_thread-viewport"
          onPointerDown={handlePointerDown}
          onScroll={handleScroll}
          onWheel={handleWheel}
        >
          <div className="flex w-full flex-col gap-3">
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
            {loading === 'response' && <ResponseLoadingIndicator />}
          </div>
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
    <LoaderCircleIcon aria-hidden="true" className="size-5 animate-spin text-muted-foreground/70" />
  </div>
)

const ThreadMessage: FC = () => {
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

  return <AssistantMessage />
}

const AssistantMessage: FC = () => {
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
        <AssistantFooter />
      </div>
    </MessagePrimitive.Root>
  )
}

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
    <div
      aria-label="Hermes is loading a response"
      aria-live="polite"
      className="flex max-w-full items-center gap-2 self-start text-sm text-muted-foreground/70"
      role="status"
    >
      <span className="shimmer shimmer-repeat-delay-0 min-w-0 truncate text-muted-foreground/55">
        {face} {verb}…
      </span>
      <ActivityTimerBadge seconds={elapsed} tone={elapsed >= 20 ? 'warm' : 'muted'} />
    </div>
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
        className="inline-grid max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-1 rounded-md py-0.5 pr-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
        {pending && <ActivityTimerBadge seconds={elapsed} tone={elapsed >= 20 ? 'warm' : 'muted'} />}
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

const AssistantActionBar: FC = () => (
  <div className="relative h-6 w-13 shrink-0">
    <ActionBarPrimitive.Root
      autohide="not-last"
      autohideFloat="always"
      className="absolute inset-0 flex gap-1 text-muted-foreground data-floating:opacity-0 data-floating:transition-opacity data-floating:duration-100 data-floating:group-hover:opacity-100 data-floating:focus-within:opacity-100"
      hideWhenRunning
    >
      <ActionBarPrimitive.Copy asChild copiedDuration={2000}>
        <TooltipIconButton className="group/copy" tooltip="Copy">
          <CopyIcon className="group-data-copied/copy:hidden" />
          <CheckIcon className="hidden group-data-copied/copy:block" />
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  </div>
)

const AssistantFooter: FC = () => {
  return (
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
      <AssistantActionBar />
    </div>
  )
}

const branchButtonClass =
  'grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35'

const ActivityTimerBadge: FC<{ seconds: number; tone?: 'muted' | 'warm' }> = ({ seconds, tone = 'muted' }) => (
  <span
    className={cn(
      'shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[0.625rem] leading-none tabular-nums',
      tone === 'warm'
        ? 'border-primary/20 bg-primary/8 text-primary'
        : 'border-border/70 bg-muted/40 text-muted-foreground/80'
    )}
  >
    {formatElapsed(seconds)}
  </span>
)

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
