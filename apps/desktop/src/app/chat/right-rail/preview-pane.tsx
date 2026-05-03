import { useStore } from '@nanostores/react'
import { Bug, Check, Copy, PanelBottom, RefreshCw, Send, Trash2, X } from 'lucide-react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SetTitlebarToolGroup, TitlebarTool } from '@/app/shell/titlebar-controls'
import { cn } from '@/lib/utils'
import { $composerDraft, setComposerDraft } from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'
import { $previewServerRestart, failPreviewServerRestart, type PreviewTarget, setPreviewTarget } from '@/store/preview'

type PreviewWebview = HTMLElement & {
  closeDevTools?: () => void
  getURL?: () => string
  isDevToolsOpened?: () => boolean
  openDevTools?: () => void
  reload?: () => void
  reloadIgnoringCache?: () => void
}

interface ConsoleEntry {
  id: number
  level: number
  line?: number
  message: string
  source?: string
}

interface PreviewPaneProps {
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
const CONSOLE_DEFAULT_HEIGHT = 240
const CONSOLE_HEADER_HEIGHT = 32
const FILE_RELOAD_DEBOUNCE_MS = 200
const SERVER_RESTART_TIMEOUT_MS = 45_000

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
  log: ConsoleEntry
  onCopy: () => void | Promise<void>
  onSend: () => void
  onToggleSelect: () => void
  selected: boolean
}

function ConsoleRow({ log, onCopy, onSend, onToggleSelect, selected }: ConsoleRowProps) {
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
        <button
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => void onCopy()}
          title="Copy this entry"
          type="button"
        >
          <Copy className="size-3" />
        </button>
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
    <div
      className="absolute inset-x-0 top-0 z-10 grid place-items-center bg-background px-6 text-center bottom-(--preview-error-bottom)"
      style={{ '--preview-error-bottom': `${consoleHeight}px` } as CSSProperties}
    >
      <div className="grid max-w-72 justify-items-center gap-4">
        <svg aria-hidden="true" className="size-16 text-muted-foreground/35" viewBox="0 0 64 64">
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
        <div className="grid gap-1.5">
          <div className="text-sm font-medium text-foreground">{loadErrorTitle(error)}</div>
          <div className="text-xs leading-5 text-muted-foreground">
            <a
              className="pointer-events-auto cursor-pointer font-mono text-muted-foreground/90 underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/70"
              href={error.url}
              onClick={event => {
                event.preventDefault()
                void window.hermesDesktop?.openExternal(error.url)
              }}
            >
              {compactUrl(error.url)}
            </a>
            {error.code ? ` (${error.code})` : ''}
          </div>
          <div className="text-[0.6875rem] leading-5 text-muted-foreground/70">{error.description}</div>
        </div>
        <div className="grid justify-items-center gap-2">
          <button
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
          {onRestartServer && (
            <button
              className="text-[0.6875rem] font-medium text-muted-foreground underline decoration-muted-foreground/25 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/55 disabled:cursor-default disabled:text-muted-foreground/55 disabled:no-underline"
              disabled={restarting}
              onClick={onRestartServer}
              type="button"
            >
              {restarting ? 'Hermes is restarting...' : 'Ask Hermes to restart the server'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

async function writeClipboardText(text: string) {
  if (!text) {
    return
  }

  if (window.hermesDesktop?.writeClipboard) {
    await window.hermesDesktop.writeClipboard(text)

    return
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
  }
}

export function PreviewPane({
  onRestartServer,
  reloadRequest = 0,
  setTitlebarToolGroup,
  target
}: PreviewPaneProps) {
  const consoleBodyRef = useRef<HTMLDivElement | null>(null)
  const consoleShouldStickRef = useRef(true)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const logIdRef = useRef(0)
  const lastReloadRequestRef = useRef(reloadRequest)
  const lastRestartEventRef = useRef('')
  const previewContentRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<PreviewWebview | null>(null)
  const previewServerRestart = useStore($previewServerRestart)
  const [consoleHeight, setConsoleHeight] = useState(CONSOLE_DEFAULT_HEIGHT)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [currentUrl, setCurrentUrl] = useState(target.url)
  const [devtoolsOpen, setDevtoolsOpen] = useState(false)
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  const [selectedLogIds, setSelectedLogIds] = useState<Set<number>>(() => new Set())
  const [copiedAll, setCopiedAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PreviewLoadErrorState | null>(null)
  const visibleSelection = useMemo(() => logs.filter(log => selectedLogIds.has(log.id)), [logs, selectedLogIds])
  const sendableLogs = visibleSelection.length > 0 ? visibleSelection : logs
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

        setConsoleHeight(clampConsoleHeight(startHeight + startY - moveEvent.clientY))
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
    [consoleHeight]
  )

  const reloadPreview = useCallback(() => {
    setLoadError(null)

    if (webviewRef.current?.reloadIgnoringCache) {
      webviewRef.current.reloadIgnoringCache()
    } else {
      webviewRef.current?.reload?.()
    }
  }, [])

  const appendConsoleEntry = useCallback((entry: Omit<ConsoleEntry, 'id'>) => {
    consoleShouldStickRef.current = isNearConsoleBottom(consoleBodyRef.current)
    setLogs(prev => [...prev.slice(-199), { ...entry, id: ++logIdRef.current }])
  }, [])

  const restartServer = useCallback(async () => {
    if (!onRestartServer) {
      return
    }

    try {
      const context = logs.slice(-12).map(formatLogLine).join('\n')
      const taskId = await onRestartServer(currentUrl, context || undefined)

      appendConsoleEntry({
        level: 1,
        message: `Hermes is looking for a preview server to restart (${taskId})`
      })
    } catch (error) {
      appendConsoleEntry({
        level: 2,
        message: `Could not start server restart: ${error instanceof Error ? error.message : String(error)}`
      })
      notifyError(error, 'Server restart failed')
    }
  }, [appendConsoleEntry, currentUrl, logs, onRestartServer])

  function toggleLogSelection(id: number) {
    setSelectedLogIds(prev => {
      const next = new Set(prev)

      if (!next.delete(id)) {
        next.add(id)
      }

      return next
    })
  }

  async function copyConsoleText(entries: ConsoleEntry[], successMessage: string) {
    if (!entries.length) {
      return
    }

    try {
      await writeClipboardText(entries.map(formatLogLine).join('\n'))
      notify({ kind: 'success', title: 'Console copied', message: successMessage })
    } catch (error) {
      notifyError(error, 'Could not copy console output')
    }
  }

  function sendLogsToComposer(entries: ConsoleEntry[]) {
    if (!entries.length) {
      return
    }

    const block = ['Preview console:', '```', ...entries.map(formatLogLine), '```'].join('\n')
    const draft = $composerDraft.get()
    const next = draft && !draft.endsWith('\n') ? `${draft}\n\n${block}` : `${draft}${block}`

    setComposerDraft(next)
    setSelectedLogIds(new Set())
    notify({
      kind: 'success',
      title: 'Sent to chat',
      message: `${entries.length} log entr${entries.length === 1 ? 'y' : 'ies'} added to composer`
    })
  }

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
      {
        active: consoleOpen,
        icon: (
          <>
            <PanelBottom />
            {logs.length > 0 && <span className="sr-only">{logs.length} console messages</span>}
          </>
        ),
        id: 'preview-console',
        label: consoleOpen ? 'Hide preview console' : 'Show preview console',
        onSelect: () => setConsoleOpen(open => !open)
      },
      {
        active: devtoolsOpen,
        icon: <Bug />,
        id: 'preview-devtools',
        label: devtoolsOpen ? 'Hide preview DevTools' : 'Open preview DevTools',
        onSelect: toggleDevTools
      },
      {
        icon: <RefreshCw className={cn(loading && 'animate-spin')} />,
        id: 'preview-reload',
        label: 'Reload preview',
        onSelect: reloadPreview
      },
      {
        className: 'mr-(--shell-preview-toolbar-gap)',
        icon: <X />,
        id: 'preview-close',
        label: 'Close preview',
        onSelect: () => setPreviewTarget(null)
      }
    ]

    setTitlebarToolGroup('preview', tools)

    return () => setTitlebarToolGroup('preview', [])
  }, [consoleOpen, currentUrl, devtoolsOpen, loading, logs.length, reloadPreview, setTitlebarToolGroup, toggleDevTools])

  useEffect(() => {
    if (consoleOpen && consoleShouldStickRef.current) {
      const consoleBody = consoleBodyRef.current

      consoleBody?.scrollTo({ top: consoleBody.scrollHeight })
    }
  }, [consoleHeight, consoleOpen, logs])

  useEffect(() => {
    if (consoleOpen) {
      consoleShouldStickRef.current = true

      const consoleBody = consoleBodyRef.current

      consoleBody?.scrollTo({ top: consoleBody.scrollHeight })
    }
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
    if (target.kind !== 'file' || !window.hermesDesktop?.watchPreviewFile || !window.hermesDesktop?.onPreviewFileChanged) {
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
    setLogs([])
    setLoading(true)

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
  }, [appendConsoleEntry, target.url])

  return (
    <aside className="relative flex h-screen w-full min-w-0 flex-col overflow-hidden border-l border-border/60 bg-background text-muted-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

        <div className="pointer-events-auto relative min-h-0 flex-1 overflow-hidden bg-background" ref={previewContentRef}>
          <div
            className={cn('absolute inset-0 flex bg-background', loadError && 'pointer-events-none opacity-0')}
            ref={hostRef}
          />
          {loadError && (
            <PreviewLoadError
              consoleHeight={consoleOpen ? consoleHeight : 0}
              error={loadError}
              onRestartServer={target.kind === 'url' && onRestartServer ? () => void restartServer() : undefined}
              onRetry={reloadPreview}
              restarting={restartingServer}
            />
          )}

          {consoleOpen && (
            <div
              className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex h-(--preview-console-height) min-h-8 flex-col overflow-hidden border-t border-border/60 bg-background"
              style={{ '--preview-console-height': `${consoleHeight}px` } as CSSProperties}
            >
              <div
                aria-label="Resize preview console"
                className="group absolute inset-x-0 -top-1 z-1 h-2 cursor-row-resize"
                onDoubleClick={() => setConsoleHeight(CONSOLE_HEADER_HEIGHT)}
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
                  <button
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                    disabled={sendableLogs.length === 0}
                    onClick={async () => {
                      await copyConsoleText(
                        sendableLogs,
                        visibleSelection.length > 0 ? `${visibleSelection.length} selected entries` : 'All console entries'
                      )
                      setCopiedAll(true)
                      setTimeout(() => setCopiedAll(false), 1500)
                    }}
                    title={visibleSelection.length > 0 ? 'Copy selected to clipboard' : 'Copy all to clipboard'}
                    type="button"
                  >
                    {copiedAll ? <Check className="size-3" /> : <Copy className="size-3" />}
                    Copy
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                    disabled={logs.length === 0}
                    onClick={() => {
                      setLogs([])
                      setSelectedLogIds(new Set())
                    }}
                    title="Clear console"
                    type="button"
                  >
                    <Trash2 className="size-3" />
                    Clear
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5 font-mono text-[0.6875rem] leading-relaxed" ref={consoleBodyRef}>
                {logs.length > 0 ? (
                  logs.map(log => {
                    const selected = selectedLogIds.has(log.id)

                    return (
                      <ConsoleRow
                        key={log.id}
                        log={log}
                        onCopy={() => copyConsoleText([log], 'Log entry copied')}
                        onSend={() => sendLogsToComposer([log])}
                        onToggleSelect={() => toggleLogSelection(log.id)}
                        selected={selected}
                      />
                    )
                  })
                ) : (
                  <div className="py-2 text-muted-foreground/70">No console messages yet.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
