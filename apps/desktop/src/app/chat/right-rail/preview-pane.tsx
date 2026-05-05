import { useStore } from '@nanostores/react'
import type {
  ComponentProps,
  CSSProperties,
  MutableRefObject,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  RefObject
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ShikiHighlighter from 'react-shiki'
import { Streamdown } from 'streamdown'

import { HERMES_PATHS_MIME } from '@/app/chat/hooks/use-composer-actions'
import type { SetTitlebarToolGroup, TitlebarTool } from '@/app/shell/titlebar-controls'
import { CopyButton } from '@/components/ui/copy-button'
import { Bug, PanelBottom, RefreshCw, Send, Trash2, X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $composerDraft, setComposerDraft } from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'
import { $previewServerRestart, failPreviewServerRestart, type PreviewTarget } from '@/store/preview'

import { type ConsoleEntry, createPreviewConsoleState, type PreviewConsoleState } from './preview-console-state'

const SHIKI_THEME = { dark: 'github-dark-default', light: 'github-light-default' } as const

type PreviewWebview = HTMLElement & {
  closeDevTools?: () => void
  getURL?: () => string
  isDevToolsOpened?: () => boolean
  openDevTools?: () => void
  reload?: () => void
  reloadIgnoringCache?: () => void
}

interface PreviewPaneProps {
  embedded?: boolean
  onClose: () => void
  onRestartServer?: (url: string, context?: string) => Promise<string>
  reloadRequest?: number
  setTitlebarToolGroup?: SetTitlebarToolGroup
  target: PreviewTarget
}

interface PreviewLoadErrorState {
  code?: number
  description: string
  url: string
}

const consoleLevelLabel: Record<number, string> = {
  0: 'log',
  1: 'info',
  2: 'warn',
  3: 'error'
}

const consoleLevelClass: Record<number, string> = {
  0: 'text-foreground',
  1: 'text-sky-700 dark:text-sky-300',
  2: 'text-amber-700 dark:text-amber-300',
  3: 'text-destructive'
}

const CONSOLE_BOTTOM_THRESHOLD = 24
const CONSOLE_HEADER_HEIGHT = 32
const FILE_RELOAD_DEBOUNCE_MS = 200
const SERVER_RESTART_TIMEOUT_MS = 45_000
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024

function compactUrl(value: string): string {
  try {
    const url = new URL(value)

    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname)
    }

    return `${url.host}${url.pathname}${url.search}`
  } catch {
    return value
  }
}

function formatLogLine(log: ConsoleEntry): string {
  const head = `[${consoleLevelLabel[log.level] || 'log'}]`
  const tail = log.source ? ` (${compactUrl(log.source)}${log.line ? `:${log.line}` : ''})` : ''

  return `${head} ${log.message}${tail}`.trim()
}

function formatConsoleEntries(entries: ConsoleEntry[]): string {
  return entries.map(formatLogLine).join('\n')
}

function isNearConsoleBottom(element: HTMLDivElement | null): boolean {
  if (!element) {
    return true
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= CONSOLE_BOTTOM_THRESHOLD
}

function clampConsoleHeight(value: number): number {
  return Math.max(value, CONSOLE_HEADER_HEIGHT)
}

function loadErrorTitle(error: PreviewLoadErrorState): string {
  const description = error.description.toLowerCase()

  if (description.includes('module script') || description.includes('mime type')) {
    return 'Preview app failed to boot'
  }

  if (description.includes('connection') || description.includes('refused') || description.includes('not found')) {
    return 'Server not found'
  }

  return 'Preview failed to load'
}

function isModuleMimeError(message: string): boolean {
  const lower = message.toLowerCase()

  return lower.includes('failed to load module script') && lower.includes('mime type')
}

interface ConsoleRowProps {
  copyText: string
  log: ConsoleEntry
  onSend: () => void
  onToggleSelect: () => void
  selected: boolean
}

function ConsoleRow({ copyText, log, onSend, onToggleSelect, selected }: ConsoleRowProps) {
  return (
    <div
      className={cn(
        'group/row grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-transparent px-1 py-1 transition-colors hover:bg-accent/40',
        selected && 'border-border/60 bg-accent/40'
      )}
    >
      <button
        className={cn(
          'mt-0.5 cursor-pointer text-left uppercase opacity-70 transition-colors hover:opacity-100',
          consoleLevelClass[log.level] ?? consoleLevelClass[0]
        )}
        onClick={onToggleSelect}
        title={selected ? 'Deselect entry' : 'Select entry'}
        type="button"
      >
        {consoleLevelLabel[log.level] || 'log'}
      </button>
      <div className="min-w-0" data-selectable-text="true">
        <span className={cn('block wrap-break-word', consoleLevelClass[log.level] ?? consoleLevelClass[0])}>
          {log.message}
        </span>
        {log.source && (
          <span className="block truncate text-muted-foreground/60">
            {compactUrl(log.source)}
            {log.line ? `:${log.line}` : ''}
          </span>
        )}
      </div>
      <span className="opacity-0 transition-opacity group-hover/row:opacity-100">
        <CopyButton
          appearance="inline"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          errorMessage="Could not copy console output"
          iconClassName="size-3"
          label="Copy this entry"
          showLabel={false}
          text={copyText}
        />
        <button
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onSend}
          title="Send this entry to chat"
          type="button"
        >
          <Send className="size-3" />
        </button>
      </span>
    </div>
  )
}

function PreviewConsoleTitlebarIcon({ consoleState }: { consoleState: PreviewConsoleState }) {
  const logCount = useStore(consoleState.$logCount)

  return (
    <>
      <PanelBottom />
      {logCount > 0 && <span className="sr-only">{logCount} console messages</span>}
    </>
  )
}

type EmptyStateTone = 'neutral' | 'warning'

const TONE_STYLES: Record<EmptyStateTone, { cube: string; primary: string }> = {
  neutral: {
    cube: 'text-muted-foreground/35',
    primary: 'border-border bg-background text-foreground hover:bg-accent'
  },
  warning: {
    cube: 'text-amber-500/70 dark:text-amber-300/70',
    primary:
      'border-amber-400/40 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-300/30 dark:bg-amber-300/15 dark:text-amber-100 dark:hover:bg-amber-300/20'
  }
}

function PreviewCubeIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={cn('size-16', className)} viewBox="0 0 64 64">
      <path
        d="M32 5 56 18.5v27L32 59 8 45.5v-27L32 5Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path
        d="M8 18.5 32 32l24-13.5M32 32v27"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path d="M20 11.75 44 25.25" fill="none" opacity="0.45" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  )
}

interface PreviewEmptyStateProps {
  body?: ReactNode
  consoleHeight?: number
  primaryAction?: { disabled?: boolean; label: string; onClick: () => void }
  secondaryAction?: { disabled?: boolean; label: string; onClick: () => void }
  title: string
  tone?: EmptyStateTone
}

function PreviewEmptyState({
  body,
  consoleHeight = 0,
  primaryAction,
  secondaryAction,
  title,
  tone = 'neutral'
}: PreviewEmptyStateProps) {
  const styles = TONE_STYLES[tone]

  return (
    <div
      className="absolute inset-x-0 top-0 z-10 grid place-items-center bg-background px-8 py-10 text-center bottom-(--preview-error-bottom)"
      style={{ '--preview-error-bottom': `${consoleHeight}px` } as CSSProperties}
    >
      <div className="grid max-w-sm justify-items-center gap-5">
        <PreviewCubeIcon className={styles.cube} />
        <div className="grid gap-2">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {body && <div className="text-xs leading-relaxed text-muted-foreground">{body}</div>}
        </div>
        {(primaryAction || secondaryAction) && (
          <div className="grid justify-items-center gap-2">
            {primaryAction && (
              <button
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-xs transition-colors disabled:cursor-default disabled:opacity-60',
                  styles.primary
                )}
                disabled={primaryAction.disabled}
                onClick={primaryAction.onClick}
                type="button"
              >
                {primaryAction.label}
              </button>
            )}
            {secondaryAction && (
              <button
                className="text-[0.6875rem] font-medium text-muted-foreground underline decoration-muted-foreground/25 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/55 disabled:cursor-default disabled:text-muted-foreground/55 disabled:no-underline"
                disabled={secondaryAction.disabled}
                onClick={secondaryAction.onClick}
                type="button"
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewLoadError({
  consoleHeight = 0,
  error,
  onRestartServer,
  onRetry,
  restarting
}: {
  consoleHeight?: number
  error: PreviewLoadErrorState
  onRestartServer?: () => void
  onRetry: () => void
  restarting?: boolean
}) {
  return (
    <PreviewEmptyState
      body={
        <>
          <a
            className="pointer-events-auto block cursor-pointer font-mono text-muted-foreground/90 underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/70"
            href={error.url}
            onClick={event => {
              event.preventDefault()
              void window.hermesDesktop?.openExternal(error.url)
            }}
          >
            {compactUrl(error.url)}
            {error.code ? ` (${error.code})` : ''}
          </a>
          <div className="mt-1 text-[0.6875rem] text-muted-foreground/70">{error.description}</div>
        </>
      }
      consoleHeight={consoleHeight}
      primaryAction={{ label: 'Try again', onClick: onRetry }}
      secondaryAction={
        onRestartServer
          ? {
              disabled: restarting,
              label: restarting ? 'Hermes is restarting...' : 'Ask Hermes to restart the server',
              onClick: onRestartServer
            }
          : undefined
      }
      title={loadErrorTitle(error)}
    />
  )
}

function PreviewConsolePanel({
  consoleBodyRef,
  consoleShouldStickRef,
  consoleState,
  startConsoleResize
}: {
  consoleBodyRef: RefObject<HTMLDivElement | null>
  consoleShouldStickRef: MutableRefObject<boolean>
  consoleState: PreviewConsoleState
  startConsoleResize: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const consoleHeight = useStore(consoleState.$height)
  const logs = useStore(consoleState.$logs)
  const selectedLogIds = useStore(consoleState.$selectedLogIds)
  const visibleSelection = useMemo(() => logs.filter(log => selectedLogIds.has(log.id)), [logs, selectedLogIds])
  const sendableLogs = visibleSelection.length > 0 ? visibleSelection : logs
  const stickScrollRafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!consoleShouldStickRef.current) {
      return
    }

    if (stickScrollRafRef.current !== null) {
      window.cancelAnimationFrame(stickScrollRafRef.current)
      stickScrollRafRef.current = null
    }

    stickScrollRafRef.current = window.requestAnimationFrame(() => {
      stickScrollRafRef.current = null
      const consoleBody = consoleBodyRef.current
      consoleBody?.scrollTo({ top: consoleBody.scrollHeight })
    })

    return () => {
      if (stickScrollRafRef.current !== null) {
        window.cancelAnimationFrame(stickScrollRafRef.current)
        stickScrollRafRef.current = null
      }
    }
  }, [consoleBodyRef, consoleHeight, consoleShouldStickRef, logs])

  function sendLogsToComposer(entries: ConsoleEntry[]) {
    if (!entries.length) {
      return
    }

    const block = ['Preview console:', '```', ...entries.map(formatLogLine), '```'].join('\n')
    const draft = $composerDraft.get()
    const next = draft && !draft.endsWith('\n') ? `${draft}\n\n${block}` : `${draft}${block}`

    setComposerDraft(next)
    consoleState.clearSelection()
    notify({
      kind: 'success',
      title: 'Sent to chat',
      message: `${entries.length} log entr${entries.length === 1 ? 'y' : 'ies'} added to composer`
    })
  }

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex h-(--preview-console-height) min-h-8 flex-col overflow-hidden border-t border-border/60 bg-background"
      style={{ '--preview-console-height': `${consoleHeight}px` } as CSSProperties}
    >
      <div
        aria-label="Resize preview console"
        className="group absolute inset-x-0 -top-1 z-1 h-2 cursor-row-resize"
        onDoubleClick={() => consoleState.setHeight(CONSOLE_HEADER_HEIGHT)}
        onPointerDown={startConsoleResize}
        role="separator"
      >
        <span className="absolute left-1/2 top-1/2 h-0.75 w-23 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/80 opacity-0 transition-opacity duration-100 group-hover:opacity-[0.5]" />
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/50 px-2">
        <div className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
          <PanelBottom className="size-3.5" />
          Preview Console
          {selectedLogIds.size > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[0.5625rem] text-muted-foreground">
              {selectedLogIds.size} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            disabled={sendableLogs.length === 0}
            onClick={() => sendLogsToComposer(sendableLogs)}
            title={
              visibleSelection.length > 0
                ? `Send ${visibleSelection.length} selected to chat`
                : 'Send all log entries to chat'
            }
            type="button"
          >
            <Send className="size-3" />
            Send to chat
          </button>
          <CopyButton
            appearance="inline"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            disabled={sendableLogs.length === 0}
            errorMessage="Could not copy console output"
            iconClassName="size-3"
            label={visibleSelection.length > 0 ? 'Copy selected to clipboard' : 'Copy all to clipboard'}
            text={() => formatConsoleEntries(sendableLogs)}
          >
            Copy
          </CopyButton>
          <button
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            disabled={logs.length === 0}
            onClick={consoleState.clear}
            title="Clear console"
            type="button"
          >
            <Trash2 className="size-3" />
            Clear
          </button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5 font-mono text-[0.6875rem] leading-relaxed"
        ref={consoleBodyRef}
      >
        {logs.length > 0 ? (
          logs.map(log => {
            const selected = selectedLogIds.has(log.id)

            return (
              <ConsoleRow
                copyText={formatLogLine(log)}
                key={log.id}
                log={log}
                onSend={() => sendLogsToComposer([log])}
                onToggleSelect={() => consoleState.toggleSelection(log.id)}
                selected={selected}
              />
            )
          })
        ) : (
          <div className="py-2 text-muted-foreground/70">No console messages yet.</div>
        )}
      </div>
    </div>
  )
}

interface LocalPreviewState {
  binary?: boolean
  byteSize?: number
  dataUrl?: string
  error?: string
  language?: string
  loading: boolean
  text?: string
  truncated?: boolean
}

function filePathForTarget(target: PreviewTarget) {
  if (target.path) {
    return target.path
  }

  try {
    const url = new URL(target.url)

    return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : target.url
  } catch {
    return target.url
  }
}

function formatBytes(bytes: number | undefined) {
  if (!bytes) {
    return 'unknown size'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function looksBinaryBytes(bytes: Uint8Array) {
  if (!bytes.length) {
    return false
  }

  let suspicious = 0

  for (const byte of bytes.slice(0, 4096)) {
    if (byte === 0) {
      return true
    }

    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      suspicious += 1
    }
  }

  return suspicious / Math.min(bytes.length, 4096) > 0.12
}

async function readTextPreview(filePath: string) {
  if (window.hermesDesktop.readFileText) {
    try {
      return await window.hermesDesktop.readFileText(filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (!message.includes("No handler registered for 'hermes:readFileText'")) {
        throw error
      }
    }
  }

  // Back-compat for a running Electron process whose preload hasn't been
  // restarted since readFileText was added. readFileDataUrl already existed.
  const dataUrl = await window.hermesDesktop.readFileDataUrl(filePath)
  const [, metadata = '', data = ''] = dataUrl.match(/^data:([^,]*),(.*)$/) || []
  const base64 = metadata.includes(';base64')
  const mimeType = metadata.replace(/;base64$/, '') || undefined
  const raw = base64 ? atob(data) : decodeURIComponent(data)
  const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0))

  return {
    binary: looksBinaryBytes(bytes),
    byteSize: bytes.byteLength,
    mimeType,
    path: filePath,
    text: new TextDecoder().decode(bytes)
  }
}

// Lightweight markdown renderer for file previews. Streamdown does the parse;
// our components keep typography simple and route fenced code through Shiki
// without the library's copy/download/fullscreen chrome.
const MD_TAG_CLASSES = {
  h1: 'mb-3 mt-6 text-3xl font-bold leading-tight tracking-tight first:mt-0',
  h2: 'mb-2.5 mt-5 text-2xl font-semibold leading-snug tracking-tight first:mt-0',
  h3: 'mb-2 mt-4 text-xl font-semibold leading-snug first:mt-0',
  h4: 'mb-2 mt-3 text-base font-semibold leading-snug first:mt-0',
  p: 'mb-4 leading-relaxed text-foreground last:mb-0',
  ul: 'mb-4 list-disc pl-6 marker:text-muted-foreground/70 last:mb-0',
  ol: 'mb-4 list-decimal pl-6 marker:text-muted-foreground/70 last:mb-0',
  li: 'mt-1 leading-relaxed',
  blockquote: 'mb-4 border-l-2 border-border pl-3 text-muted-foreground italic last:mb-0',
  pre: 'mb-4 overflow-hidden rounded-lg border border-border bg-card font-mono text-xs leading-relaxed last:mb-0 [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-3 [&_pre]:font-mono'
} as const

function tagged<T extends keyof typeof MD_TAG_CLASSES>(Tag: T) {
  const base = MD_TAG_CLASSES[Tag]

  const Component = (({ className, ...rest }: ComponentProps<T>) => {
    const Element = Tag as React.ElementType

    return <Element className={cn(base, className)} {...rest} />
  }) as React.FC<ComponentProps<T>>

  Component.displayName = `Md.${Tag}`

  return Component
}

function MarkdownCode({ className, children, ...props }: ComponentProps<'code'>) {
  const language = /language-([^\s]+)/.exec(className || '')?.[1]

  if (!language) {
    return (
      <code
        className={cn(
          'rounded bg-muted px-1 py-0.5 font-mono text-[0.86em] text-pink-700 dark:text-pink-300',
          className
        )}
        {...props}
      >
        {children}
      </code>
    )
  }

  return (
    <ShikiHighlighter
      addDefaultStyles={false}
      as="div"
      defaultColor="light-dark()"
      delay={80}
      language={language}
      showLanguage={false}
      theme={SHIKI_THEME}
    >
      {String(children).replace(/\n$/, '')}
    </ShikiHighlighter>
  )
}

const MARKDOWN_COMPONENTS = {
  h1: tagged('h1'),
  h2: tagged('h2'),
  h3: tagged('h3'),
  h4: tagged('h4'),
  p: tagged('p'),
  ul: tagged('ul'),
  ol: tagged('ol'),
  li: tagged('li'),
  blockquote: tagged('blockquote'),
  pre: tagged('pre'),
  code: MarkdownCode
}

function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="preview-markdown mx-auto max-w-3xl px-4 py-3 text-sm text-foreground">
      <Streamdown components={MARKDOWN_COMPONENTS} controls={false} mode="static" parseIncompleteMarkdown={false}>
        {text}
      </Streamdown>
    </div>
  )
}

function PreviewToggle({ asSource, onToggle }: { asSource: boolean; onToggle: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex justify-end border-b border-border/40 bg-background/90 px-3 py-1 backdrop-blur">
      <button
        className="text-[0.625rem] font-bold text-muted-foreground underline decoration-muted-foreground/25 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/55"
        onClick={onToggle}
        type="button"
      >
        {asSource ? 'PREVIEW' : 'SOURCE'}
      </button>
    </div>
  )
}

// Gutter and Shiki output share `font-mono text-xs leading-relaxed py-3` so
// each line aligns vertically. The selection overlay relies on the same
// `text-xs * leading-relaxed = 1.21875rem` line-height to position itself.
const SOURCE_LINE_HEIGHT_REM = 1.21875
const SOURCE_PAD_Y_REM = 0.75

interface LineSelection {
  end: number
  start: number
}

function startLineDrag(event: ReactDragEvent<HTMLElement>, filePath: string, { end, start }: LineSelection) {
  const lineEnd = end > start ? end : undefined
  const label = lineEnd ? `${filePath}:${start}-${end}` : `${filePath}:${start}`

  event.dataTransfer.setData(HERMES_PATHS_MIME, JSON.stringify([{ line: start, lineEnd, path: filePath }]))
  event.dataTransfer.setData('text/plain', label)
  event.dataTransfer.effectAllowed = 'copy'
}

function SourceView({ filePath, language, text }: { filePath: string; language: string; text: string }) {
  const lineCount = useMemo(() => Math.max(1, text.split('\n').length), [text])
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const inSelection = (line: number) => selection != null && line >= selection.start && line <= selection.end

  const handleLineClick = (event: ReactMouseEvent, line: number) => {
    if (event.shiftKey && selection) {
      setSelection({ end: Math.max(selection.end, line), start: Math.min(selection.start, line) })

      return
    }

    if (selection?.start === line && selection.end === line) {
      setSelection(null)

      return
    }

    setSelection({ end: line, start: line })
  }

  const handleDragStart = (event: ReactDragEvent<HTMLElement>, line: number) => {
    startLineDrag(event, filePath, inSelection(line) && selection ? selection : { end: line, start: line })
  }

  return (
    <div className="grid min-w-max grid-cols-[auto_minmax(0,1fr)] font-mono text-xs leading-relaxed">
      <div className="select-none py-3 text-right text-muted-foreground/55">
        {Array.from({ length: lineCount }, (_, index) => {
          const line = index + 1
          const selected = inSelection(line)

          return (
            <div
              className={cn(
                'cursor-pointer px-3 tabular-nums transition-colors',
                selected
                  ? 'bg-amber-200/45 text-amber-900 dark:bg-amber-300/20 dark:text-amber-100'
                  : 'hover:text-foreground'
              )}
              draggable
              key={line}
              onClick={event => handleLineClick(event, line)}
              onDragStart={event => handleDragStart(event, line)}
              title="Click to select · shift-click to extend · drag to composer"
            >
              {line}
            </div>
          )
        })}
      </div>
      <div className="relative [&_pre]:m-0 [&_pre]:px-3 [&_pre]:py-3">
        {selection && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-amber-200/35 dark:bg-amber-300/10"
            style={{
              top: `calc(${SOURCE_PAD_Y_REM}rem + ${selection.start - 1} * ${SOURCE_LINE_HEIGHT_REM}rem)`,
              height: `calc(${selection.end - selection.start + 1} * ${SOURCE_LINE_HEIGHT_REM}rem)`
            }}
          />
        )}
        <ShikiHighlighter
          addDefaultStyles={false}
          as="div"
          defaultColor="light-dark()"
          delay={80}
          language={language || 'text'}
          showLanguage={false}
          theme={SHIKI_THEME}
        >
          {text}
        </ShikiHighlighter>
      </div>
    </div>
  )
}

function LocalFilePreview({ reloadKey, target }: { reloadKey: number; target: PreviewTarget }) {
  const [state, setState] = useState<LocalPreviewState>({ loading: true })
  const [forcePreview, setForcePreview] = useState(false)
  const [renderMarkdownAsSource, setRenderMarkdownAsSource] = useState(false)
  const filePath = filePathForTarget(target)
  const isImage = target.previewKind === 'image'

  // HTML files are rendered as source code, not in a webview — so they take
  // the same path as plain text files. `previewKind === 'binary'` arrives
  // when the file is forcibly previewed past the binary refusal screen.
  const isText = target.previewKind === 'text' || target.previewKind === 'binary' || target.previewKind === 'html'

  const blockedByTarget = !isImage && !forcePreview && (target.binary || target.large)

  useEffect(() => {
    let active = true

    async function load() {
      if (blockedByTarget) {
        setState({ loading: false })

        return
      }

      if (!isImage && !isText) {
        setState({ loading: false })

        return
      }

      setState({ loading: true })

      try {
        if (isImage) {
          const dataUrl = await window.hermesDesktop.readFileDataUrl(filePath)

          if (active) {
            setState({ dataUrl, loading: false })
          }

          return
        }

        const result = await readTextPreview(filePath)

        if (active) {
          const shouldBlock = !forcePreview && (result.binary || (result.byteSize ?? 0) > TEXT_PREVIEW_MAX_BYTES)

          setState({
            binary: result.binary,
            byteSize: result.byteSize,
            language: result.language || target.language || 'text',
            loading: false,
            text: shouldBlock ? undefined : result.text,
            truncated: result.truncated
          })
        }
      } catch (error) {
        if (active) {
          setState({
            error: error instanceof Error ? error.message : String(error),
            loading: false
          })
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [blockedByTarget, filePath, forcePreview, isImage, isText, reloadKey, target.language])

  if (state.loading) {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">Loading preview…</div>
  }

  if (state.error) {
    return <PreviewEmptyState body={state.error} title="Preview unavailable" />
  }

  if (
    !isImage &&
    !forcePreview &&
    (target.binary || target.large || state.binary || (state.byteSize ?? 0) > TEXT_PREVIEW_MAX_BYTES)
  ) {
    const binary = target.binary || state.binary
    const size = target.byteSize || state.byteSize

    return (
      <PreviewEmptyState
        body={
          binary
            ? `Previewing ${target.label} may show unreadable text.`
            : `${target.label} is ${formatBytes(size)}. Hermes will only show the first 512 KB.`
        }
        primaryAction={{ label: 'Preview anyway', onClick: () => setForcePreview(true) }}
        title={binary ? 'This looks like a binary file' : 'This file is large'}
        tone="warning"
      />
    )
  }

  if (isImage && state.dataUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto bg-[color-mix(in_srgb,var(--dt-card)_42%,transparent)] p-4">
        <img
          alt={target.label}
          className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
          draggable={false}
          src={state.dataUrl}
        />
      </div>
    )
  }

  if (isText && state.text !== undefined) {
    const isMarkdown = (state.language || target.language) === 'markdown'
    const showRendered = isMarkdown && !renderMarkdownAsSource

    return (
      <div className="h-full overflow-auto bg-background">
        {state.truncated && (
          <div className="border-b border-border/60 bg-muted/35 px-3 py-1.5 text-[0.68rem] text-muted-foreground">
            Showing first 512 KB.
          </div>
        )}
        {isMarkdown && <PreviewToggle asSource={!showRendered} onToggle={() => setRenderMarkdownAsSource(s => !s)} />}
        {showRendered ? (
          <MarkdownPreview text={state.text} />
        ) : (
          <SourceView filePath={filePath} language={state.language || 'text'} text={state.text} />
        )}
      </div>
    )
  }

  return (
    <PreviewEmptyState
      body={`${target.mimeType || 'This file type'} can still be attached as context.`}
      title="No inline preview"
    />
  )
}

const TITLEBAR_GROUP_ID = 'preview'

export function PreviewPane({
  embedded = false,
  onClose,
  onRestartServer,
  reloadRequest = 0,
  setTitlebarToolGroup,
  target
}: PreviewPaneProps) {
  const [consoleState] = useState(() => createPreviewConsoleState())
  const consoleBodyRef = useRef<HTMLDivElement | null>(null)
  const consoleShouldStickRef = useRef(true)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const lastReloadRequestRef = useRef(reloadRequest)
  const lastRestartEventRef = useRef('')
  const previewContentRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<PreviewWebview | null>(null)
  const previewServerRestart = useStore($previewServerRestart)
  const consoleHeight = useStore(consoleState.$height)
  const consoleOpen = useStore(consoleState.$open)
  const [currentUrl, setCurrentUrl] = useState(target.url)
  const [devtoolsOpen, setDevtoolsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PreviewLoadErrorState | null>(null)
  const [localReloadKey, setLocalReloadKey] = useState(0)
  const isWebPreview = target.kind === 'url' || (target.previewKind === 'html' && target.renderMode !== 'source')
  const currentLabel = compactUrl(currentUrl)

  const previewLabel =
    target.label && target.label.replace(/\/$/, '') !== currentLabel.replace(/\/$/, '') ? target.label : currentLabel

  const restartingServer =
    previewServerRestart?.status === 'running' &&
    (previewServerRestart.url === target.url || previewServerRestart.url === currentUrl)

  const startConsoleResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()

      const handle = event.currentTarget
      const pointerId = event.pointerId
      const startY = event.clientY
      const startHeight = consoleHeight
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      let active = true

      handle.setPointerCapture?.(pointerId)

      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (moveEvent: PointerEvent) => {
        if (!active) {
          return
        }

        consoleState.setHeight(clampConsoleHeight(startHeight + startY - moveEvent.clientY))
      }

      const cleanup = () => {
        if (!active) {
          return
        }

        active = false
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        handle.releasePointerCapture?.(pointerId)
        window.removeEventListener('pointermove', handleMove, true)
        window.removeEventListener('pointerup', cleanup, true)
        window.removeEventListener('pointercancel', cleanup, true)
        window.removeEventListener('blur', cleanup)
        handle.removeEventListener('lostpointercapture', cleanup)
      }

      window.addEventListener('pointermove', handleMove, true)
      window.addEventListener('pointerup', cleanup, true)
      window.addEventListener('pointercancel', cleanup, true)
      window.addEventListener('blur', cleanup)
      handle.addEventListener('lostpointercapture', cleanup)
    },
    [consoleHeight, consoleState]
  )

  const reloadPreview = useCallback(() => {
    setLoadError(null)

    if (!isWebPreview) {
      setLocalReloadKey(key => key + 1)

      return
    }

    if (webviewRef.current?.reloadIgnoringCache) {
      webviewRef.current.reloadIgnoringCache()
    } else {
      webviewRef.current?.reload?.()
    }
  }, [isWebPreview])

  const appendConsoleEntry = useCallback(
    (entry: Omit<ConsoleEntry, 'id'>) => {
      consoleShouldStickRef.current = isNearConsoleBottom(consoleBodyRef.current)
      consoleState.append(entry)
    },
    [consoleState]
  )

  const restartServer = useCallback(async () => {
    if (!onRestartServer) {
      return
    }

    // Auto-open the preview console so the user can see progress events
    // streaming back from the background agent. Without this, clicking
    // "Ask Hermes to restart the server" looked like it did nothing —
    // the work was happening, but in a collapsed pane.
    consoleState.setOpen(true)

    try {
      const context = consoleState.$logs.get().slice(-12).map(formatLogLine).join('\n')
      const taskId = await onRestartServer(currentUrl, context || undefined)

      appendConsoleEntry({
        level: 1,
        message: `Hermes is looking for a preview server to restart (${taskId})`
      })

      notify({
        kind: 'info',
        title: 'Restarting preview server',
        message: 'Hermes is working in the background. Watch the preview console for progress.',
        durationMs: 4000
      })
    } catch (error) {
      appendConsoleEntry({
        level: 2,
        message: `Could not start server restart: ${error instanceof Error ? error.message : String(error)}`
      })
      notifyError(error, 'Server restart failed')
    }
  }, [appendConsoleEntry, consoleState, currentUrl, onRestartServer])

  const toggleDevTools = useCallback(() => {
    const webview = webviewRef.current

    if (!webview?.openDevTools) {
      return
    }

    if (webview.isDevToolsOpened?.()) {
      webview.closeDevTools?.()
      setDevtoolsOpen(false)

      return
    }

    webview.openDevTools()
    setDevtoolsOpen(true)
  }, [])

  useEffect(() => {
    if (!setTitlebarToolGroup) {
      return
    }

    const tools: TitlebarTool[] = [
      ...(isWebPreview
        ? [
            {
              active: consoleOpen,
              icon: <PreviewConsoleTitlebarIcon consoleState={consoleState} />,
              id: `${TITLEBAR_GROUP_ID}-console`,
              label: consoleOpen ? 'Hide preview console' : 'Show preview console',
              onSelect: () => consoleState.setOpen(open => !open)
            },
            {
              active: devtoolsOpen,
              icon: <Bug />,
              id: `${TITLEBAR_GROUP_ID}-devtools`,
              label: devtoolsOpen ? 'Hide preview DevTools' : 'Open preview DevTools',
              onSelect: toggleDevTools
            }
          ]
        : []),
      {
        icon: <RefreshCw className={cn(loading && 'animate-spin')} />,
        id: `${TITLEBAR_GROUP_ID}-reload`,
        label: 'Reload preview',
        onSelect: reloadPreview
      },
      {
        icon: <X />,
        id: `${TITLEBAR_GROUP_ID}-close`,
        label: 'Close preview',
        onSelect: onClose
      }
    ]

    setTitlebarToolGroup(TITLEBAR_GROUP_ID, tools)

    return () => setTitlebarToolGroup(TITLEBAR_GROUP_ID, [])
  }, [
    consoleOpen,
    consoleState,
    devtoolsOpen,
    isWebPreview,
    loading,
    onClose,
    reloadPreview,
    setTitlebarToolGroup,
    toggleDevTools
  ])

  useEffect(() => {
    if (!consoleOpen) {
      return
    }

    consoleShouldStickRef.current = true

    const handle = window.requestAnimationFrame(() => {
      const consoleBody = consoleBodyRef.current
      consoleBody?.scrollTo({ top: consoleBody.scrollHeight })
    })

    return () => window.cancelAnimationFrame(handle)
  }, [consoleOpen])

  useEffect(() => {
    if (
      !previewServerRestart ||
      !previewServerRestart.message ||
      (previewServerRestart.url !== target.url && previewServerRestart.url !== currentUrl)
    ) {
      return
    }

    const eventKey = `${previewServerRestart.taskId}:${previewServerRestart.status}:${previewServerRestart.message || ''}`

    if (eventKey === lastRestartEventRef.current) {
      return
    }

    lastRestartEventRef.current = eventKey
    appendConsoleEntry({
      level: previewServerRestart.status === 'error' ? 2 : 1,
      message:
        previewServerRestart.status === 'running'
          ? previewServerRestart.message
          : previewServerRestart.status === 'complete'
            ? `Hermes finished restarting the preview server${
                previewServerRestart.message ? `: ${previewServerRestart.message}` : ''
              }`
            : `Server restart failed: ${previewServerRestart.message || 'unknown error'}`
    })

    if (previewServerRestart.status === 'complete') {
      reloadPreview()
      notify({
        kind: 'success',
        title: 'Preview server restarted',
        message: previewServerRestart.message?.slice(0, 160) || 'Reloading the preview now.',
        durationMs: 3500
      })
    } else if (previewServerRestart.status === 'error') {
      notify({
        kind: 'warning',
        title: 'Preview restart failed',
        message: previewServerRestart.message?.slice(0, 200) || 'Hermes could not restart the server.',
        durationMs: 6000
      })
    }
  }, [appendConsoleEntry, currentUrl, previewServerRestart, reloadPreview, target.url])

  useEffect(() => {
    if (!restartingServer || !previewServerRestart) {
      return
    }

    const taskId = previewServerRestart.taskId

    const timer = window.setTimeout(() => {
      failPreviewServerRestart(
        taskId,
        'Hermes is still working, but no restart result has arrived yet. The server command may be running in the foreground.'
      )
    }, SERVER_RESTART_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [previewServerRestart, restartingServer])

  useEffect(() => {
    if (reloadRequest === lastReloadRequestRef.current) {
      return
    }

    lastReloadRequestRef.current = reloadRequest

    if (target.kind !== 'url') {
      return
    }

    appendConsoleEntry({
      level: 1,
      message: 'Workspace changed, reloading preview'
    })
    reloadPreview()
  }, [appendConsoleEntry, reloadPreview, reloadRequest, target.kind])

  useEffect(() => {
    if (
      target.kind !== 'file' ||
      !window.hermesDesktop?.watchPreviewFile ||
      !window.hermesDesktop?.onPreviewFileChanged
    ) {
      return
    }

    let active = true
    let pendingReloadCount = 0
    let pendingReloadUrl = ''
    let reloadTimer: ReturnType<typeof setTimeout> | null = null
    let watchId = ''

    const flushReload = () => {
      if (!active || pendingReloadCount === 0) {
        return
      }

      const changedCount = pendingReloadCount
      const changedUrl = pendingReloadUrl

      pendingReloadCount = 0
      pendingReloadUrl = ''

      appendConsoleEntry({
        level: 1,
        message:
          changedCount === 1
            ? `File changed, reloading preview: ${compactUrl(changedUrl)}`
            : `${changedCount} file changes, reloading preview: ${compactUrl(changedUrl)}`
      })

      reloadPreview()
    }

    const unsubscribe = window.hermesDesktop.onPreviewFileChanged(payload => {
      if (!active || payload.id !== watchId) {
        return
      }

      pendingReloadCount += 1
      pendingReloadUrl = payload.url

      if (reloadTimer) {
        clearTimeout(reloadTimer)
      }

      reloadTimer = setTimeout(() => {
        reloadTimer = null
        flushReload()
      }, FILE_RELOAD_DEBOUNCE_MS)
    })

    void window.hermesDesktop
      .watchPreviewFile(target.url)
      .then(watch => {
        if (!active) {
          void window.hermesDesktop?.stopPreviewFileWatch?.(watch.id)

          return
        }

        watchId = watch.id
      })
      .catch(error => {
        appendConsoleEntry({
          level: 2,
          message: `Could not watch preview file: ${error instanceof Error ? error.message : String(error)}`
        })
      })

    return () => {
      active = false
      unsubscribe()

      if (reloadTimer) {
        clearTimeout(reloadTimer)
      }

      if (watchId) {
        void window.hermesDesktop?.stopPreviewFileWatch?.(watchId)
      }
    }
  }, [appendConsoleEntry, reloadPreview, target.kind, target.url])

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    host.replaceChildren()
    webviewRef.current = null
    setCurrentUrl(target.url)
    setDevtoolsOpen(false)
    setLoadError(null)
    consoleState.reset()
    setLoading(true)

    if (!isWebPreview) {
      setLoading(false)

      return
    }

    const webview = document.createElement('webview') as PreviewWebview
    webview.className = 'hermes-preview-webview h-full w-full flex-1 bg-background'
    webview.setAttribute('partition', 'persist:hermes-preview')
    webview.setAttribute('src', target.url)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')

    const onConsole = (event: Event) => {
      const detail = event as Event & {
        level?: number
        line?: number
        message?: string
        sourceId?: string
      }

      const message = detail.message || ''

      appendConsoleEntry({
        level: detail.level ?? 0,
        line: detail.line,
        message,
        source: detail.sourceId
      })

      if ((detail.level ?? 0) >= 3 && isModuleMimeError(message)) {
        setLoadError({
          description:
            'Module scripts are being served with the wrong MIME type. This usually means a static file server is serving a Vite/React app instead of the project dev server.',
          url: webview.getURL?.() || target.url
        })
        setLoading(false)
      }
    }

    const onNavigate = (event: Event) => {
      const detail = event as Event & { url?: string }

      if (detail.url) {
        setLoadError(null)
        setCurrentUrl(detail.url)
      }
    }

    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number
        errorDescription?: string
        validatedURL?: string
      }

      const errorCode = detail.errorCode

      if (errorCode === -3) {
        return
      }

      appendConsoleEntry({
        level: 3,
        message: `Load failed${errorCode ? ` (${errorCode})` : ''}: ${
          detail.errorDescription || detail.validatedURL || 'unknown error'
        }`
      })
      setLoadError({
        code: errorCode,
        description: detail.errorDescription || 'The preview page could not be reached.',
        url: detail.validatedURL || webview.getURL?.() || target.url
      })
      setLoading(false)
    }

    const onStart = () => setLoading(true)
    const onStop = () => setLoading(false)

    webview.addEventListener('console-message', onConsole)
    webview.addEventListener('did-fail-load', onFail)
    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-navigate-in-page', onNavigate)
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    host.appendChild(webview)
    webviewRef.current = webview

    return () => {
      webview.removeEventListener('console-message', onConsole)
      webview.removeEventListener('did-fail-load', onFail)
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-navigate-in-page', onNavigate)
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
      webview.remove()
    }
  }, [appendConsoleEntry, consoleState, isWebPreview, target.url])

  return (
    <aside className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-background text-muted-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!embedded && (
          <div className="pointer-events-none flex min-h-(--titlebar-height) items-center gap-1.5 border-b border-border/60 bg-background px-2 py-1">
            <div className="min-w-0 flex-1">
              <a
                className="pointer-events-auto inline max-w-full cursor-pointer truncate text-left text-xs font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                href={currentUrl}
                rel="noreferrer"
                target="_blank"
                title={`Open ${currentUrl}`}
              >
                {previewLabel || 'Preview'}
              </a>
            </div>
          </div>
        )}

        <div
          className="pointer-events-auto relative min-h-0 flex-1 overflow-hidden bg-background"
          ref={previewContentRef}
        >
          <div
            className={cn(
              'absolute inset-0 flex bg-background',
              (!isWebPreview || loadError) && 'pointer-events-none opacity-0'
            )}
            ref={hostRef}
          />
          {!isWebPreview && <LocalFilePreview reloadKey={localReloadKey} target={target} />}
          {loadError && (
            <PreviewLoadError
              consoleHeight={consoleOpen ? consoleHeight : 0}
              error={loadError}
              onRestartServer={target.kind === 'url' && onRestartServer ? () => void restartServer() : undefined}
              onRetry={reloadPreview}
              restarting={restartingServer}
            />
          )}

          {isWebPreview && consoleOpen && (
            <PreviewConsolePanel
              consoleBodyRef={consoleBodyRef}
              consoleShouldStickRef={consoleShouldStickRef}
              consoleState={consoleState}
              startConsoleResize={startConsoleResize}
            />
          )}
        </div>
      </div>
    </aside>
  )
}
