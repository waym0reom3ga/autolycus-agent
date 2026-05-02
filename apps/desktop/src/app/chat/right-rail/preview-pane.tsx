import { Bug, Check, Copy, ExternalLink, PanelBottom, RefreshCw, Send, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { $composerDraft, setComposerDraft } from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'
import { type PreviewTarget, setPreviewTarget } from '@/store/preview'

type PreviewWebview = HTMLElement & {
  closeDevTools?: () => void
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
const FILE_RELOAD_DEBOUNCE_MS = 200

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

export function PreviewPane({ target }: { target: PreviewTarget }) {
  const consoleBodyRef = useRef<HTMLDivElement | null>(null)
  const consoleShouldStickRef = useRef(true)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const logIdRef = useRef(0)
  const webviewRef = useRef<PreviewWebview | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [currentUrl, setCurrentUrl] = useState(target.url)
  const [devtoolsOpen, setDevtoolsOpen] = useState(false)
  const [logs, setLogs] = useState<ConsoleEntry[]>([])
  const [selectedLogIds, setSelectedLogIds] = useState<Set<number>>(() => new Set())
  const [copiedAll, setCopiedAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const visibleSelection = useMemo(() => logs.filter(log => selectedLogIds.has(log.id)), [logs, selectedLogIds])
  const sendableLogs = visibleSelection.length > 0 ? visibleSelection : logs

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

  function toggleDevTools() {
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
  }

  useEffect(() => {
    if (consoleOpen && consoleShouldStickRef.current) {
      const consoleBody = consoleBodyRef.current

      consoleBody?.scrollTo({ top: consoleBody.scrollHeight })
    }
  }, [consoleOpen, logs])

  useEffect(() => {
    if (consoleOpen) {
      consoleShouldStickRef.current = true

      const consoleBody = consoleBodyRef.current

      consoleBody?.scrollTo({ top: consoleBody.scrollHeight })
    }
  }, [consoleOpen])

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

      consoleShouldStickRef.current = isNearConsoleBottom(consoleBodyRef.current)
      setLogs(prev => [
        ...prev.slice(-199),
        {
          id: ++logIdRef.current,
          level: 1,
          message:
            changedCount === 1
              ? `File changed, reloading preview: ${compactUrl(changedUrl)}`
              : `${changedCount} file changes, reloading preview: ${compactUrl(changedUrl)}`
        }
      ])

      if (webviewRef.current?.reloadIgnoringCache) {
        webviewRef.current.reloadIgnoringCache()
      } else {
        webviewRef.current?.reload?.()
      }
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
        setLogs(prev => [
          ...prev.slice(-199),
          {
            id: ++logIdRef.current,
            level: 2,
            message: `Could not watch preview file: ${error instanceof Error ? error.message : String(error)}`
          }
        ])
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
  }, [target.kind, target.url])

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    host.replaceChildren()
    webviewRef.current = null
    setCurrentUrl(target.url)
    setDevtoolsOpen(false)
    setLogs([])
    setLoading(true)

    const webview = document.createElement('webview') as PreviewWebview
    webview.className = 'hermes-preview-webview h-full w-full flex-1 bg-background'
    webview.setAttribute('partition', 'persist:hermes-preview')
    webview.setAttribute('src', target.url)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')

    const appendLog = (entry: Omit<ConsoleEntry, 'id'>) => {
      consoleShouldStickRef.current = isNearConsoleBottom(consoleBodyRef.current)
      setLogs(prev => [...prev.slice(-199), { ...entry, id: ++logIdRef.current }])
    }

    const onConsole = (event: Event) => {
      const detail = event as Event & {
        level?: number
        line?: number
        message?: string
        sourceId?: string
      }

      appendLog({
        level: detail.level ?? 0,
        line: detail.line,
        message: detail.message || '',
        source: detail.sourceId
      })
    }

    const onNavigate = (event: Event) => {
      const detail = event as Event & { url?: string }

      if (detail.url) {
        setCurrentUrl(detail.url)
      }
    }

    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number
        errorDescription?: string
        validatedURL?: string
      }

      appendLog({
        level: 3,
        message: `Load failed${detail.errorCode ? ` (${detail.errorCode})` : ''}: ${
          detail.errorDescription || detail.validatedURL || 'unknown error'
        }`
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
  }, [target.url])

  return (
    <aside className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-transparent pb-2 pl-2 pr-3 pt-[calc(var(--titlebar-height)+0.25rem)] text-muted-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">{target.label || 'Preview'}</div>
            <div className="truncate font-mono text-[0.625rem] text-muted-foreground">{compactUrl(currentUrl)}</div>
          </div>
          <Button
            aria-label={consoleOpen ? 'Hide preview console' : 'Show preview console'}
            className="h-7 shrink-0 rounded-lg px-2 text-[0.6875rem]"
            onClick={() => setConsoleOpen(open => !open)}
            size="xs"
            title={consoleOpen ? 'Hide Console' : 'Show Console'}
            type="button"
            variant="ghost"
          >
            <PanelBottom className="size-3.5" />
            Console
            {logs.length > 0 && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-px text-[0.5625rem] text-muted-foreground">
                {logs.length}
              </span>
            )}
          </Button>
          <Button
            aria-label={devtoolsOpen ? 'Hide preview DevTools' : 'Open preview DevTools'}
            className="h-7 shrink-0 rounded-lg px-2 text-[0.6875rem]"
            onClick={toggleDevTools}
            size="xs"
            title={devtoolsOpen ? 'Hide DevTools' : 'Open DevTools'}
            type="button"
            variant="ghost"
          >
            <Bug className="size-3.5" />
            {devtoolsOpen ? 'Hide DevTools' : 'DevTools'}
          </Button>
          <Button
            aria-label="Reload preview"
            className="size-7 shrink-0 rounded-lg"
            onClick={() => webviewRef.current?.reload?.()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
          <Button
            aria-label="Open preview externally"
            className="size-7 shrink-0 rounded-lg"
            onClick={() => void window.hermesDesktop?.openExternal(currentUrl)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <Button
            aria-label="Close preview"
            className="size-7 shrink-0 rounded-lg"
            onClick={() => setPreviewTarget(null)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 bg-background" ref={hostRef} />

        {consoleOpen && (
          <div className="min-h-44 border-t border-border/60 bg-background/95">
            <div className="flex h-8 items-center justify-between border-b border-border/50 px-2">
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
            <div className="h-40 overflow-y-auto px-2 py-1.5 font-mono text-[0.6875rem] leading-relaxed" ref={consoleBodyRef}>
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
    </aside>
  )
}
