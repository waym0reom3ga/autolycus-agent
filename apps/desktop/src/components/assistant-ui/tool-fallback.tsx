'use client'

import { type ToolCallMessagePartProps, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { useElapsedSeconds } from '@/components/assistant-ui/activity-timer'
import { ActivityTimerText } from '@/components/assistant-ui/activity-timer-text'
import { PreviewAttachment } from '@/components/assistant-ui/preview-attachment'
import { ZoomableImage } from '@/components/assistant-ui/zoomable-image'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Command,
  FileText,
  Globe,
  LinkIcon,
  Loader2,
  Search,
  Sparkles,
  Wrench
} from '@/lib/icons'
import type { LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $toolInlineDiffs } from '@/store/tool-diffs'
import { $toolViewMode } from '@/store/tool-view'

const TOOL_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const TOOL_SPINNER_INTERVAL_MS = 80
const TOOL_DETAIL_INDENT_CLASS = 'ml-[3.25rem]'

type ToolTone = 'agent' | 'browser' | 'default' | 'file' | 'image' | 'terminal' | 'web'
type ToolStatus = 'error' | 'running' | 'success'

interface ToolPart {
  args?: unknown
  isError?: boolean
  result?: unknown
  toolCallId?: string
  toolName: string
  type: 'tool-call'
}

interface SearchResultRow {
  snippet: string
  title: string
  url: string
}

interface ToolView {
  detail: string
  detailLabel: string
  durationLabel?: string
  icon: LucideIcon
  imageUrl?: string
  inlineDiff: string
  previewTarget?: string
  rawArgs: string
  rawResult: string
  status: ToolStatus
  subtitle: string
  title: string
  tone: ToolTone
}

interface ToolMeta {
  done: string
  icon: LucideIcon
  pending: string
  tone: ToolTone
}

const TOOL_META: Record<string, ToolMeta> = {
  browser_click: { done: 'Clicked page element', pending: 'Clicking page element', icon: Globe, tone: 'browser' },
  browser_fill: { done: 'Filled form field', pending: 'Filling form field', icon: Globe, tone: 'browser' },
  browser_navigate: { done: 'Opened page', pending: 'Opening page', icon: Globe, tone: 'browser' },
  browser_snapshot: { done: 'Captured page snapshot', pending: 'Capturing page snapshot', icon: Globe, tone: 'browser' },
  browser_take_screenshot: { done: 'Captured screenshot', pending: 'Capturing screenshot', icon: Sparkles, tone: 'browser' },
  browser_type: { done: 'Typed on page', pending: 'Typing on page', icon: Globe, tone: 'browser' },
  edit_file: { done: 'Edited file', pending: 'Editing file', icon: FileText, tone: 'file' },
  execute_code: { done: 'Ran code', pending: 'Running code', icon: Command, tone: 'terminal' },
  image_generate: { done: 'Generated image', pending: 'Generating image', icon: Sparkles, tone: 'image' },
  list_files: { done: 'Listed files', pending: 'Listing files', icon: FileText, tone: 'file' },
  read_file: { done: 'Read file', pending: 'Reading file', icon: FileText, tone: 'file' },
  search_files: { done: 'Searched files', pending: 'Searching files', icon: FileText, tone: 'file' },
  session_search_recall: { done: 'Searched session history', pending: 'Searching session history', icon: Search, tone: 'agent' },
  terminal: { done: 'Ran command', pending: 'Running command', icon: Command, tone: 'terminal' },
  todo: { done: 'Updated todos', pending: 'Updating todos', icon: Wrench, tone: 'agent' },
  web_extract: { done: 'Read webpage', pending: 'Reading webpage', icon: LinkIcon, tone: 'web' },
  web_search: { done: 'Searched web', pending: 'Searching web', icon: Search, tone: 'web' },
  write_file: { done: 'Edited file', pending: 'Editing file', icon: FileText, tone: 'file' }
}

const TOOL_TONE_CLASS: Record<ToolTone, string> = {
  agent: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  browser: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  default: 'bg-muted text-muted-foreground',
  file: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
  image: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  terminal: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  web: 'bg-violet-500/12 text-violet-700 dark:text-violet-300'
}

function titleForTool(name: string): string {
  const normalized = name.replace(/^browser_/, '').replace(/^web_/, '')

  return (
    normalized
      .split('_')
      .filter(Boolean)
      .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' ') || name
  )
}

const PREFIX_META: { icon: LucideIcon; prefix: string; tone: ToolTone; verb: string }[] = [
  { prefix: 'browser_', verb: 'Browser', icon: Globe, tone: 'browser' },
  { prefix: 'web_', verb: 'Web', icon: Search, tone: 'web' }
]

function toolMeta(name: string): ToolMeta {
  if (TOOL_META[name]) {
    return TOOL_META[name]
  }

  const action = titleForTool(name)
  const prefix = PREFIX_META.find(p => name.startsWith(p.prefix))

  return prefix
    ? {
        done: `${prefix.verb} ${action}`,
        pending: `Running ${prefix.verb.toLowerCase()} ${action.toLowerCase()}`,
        icon: prefix.icon,
        tone: prefix.tone
      }
    : { done: action, pending: `Running ${action.toLowerCase()}`, icon: Wrench, tone: 'default' }
}

function compactPreview(value: unknown, max = 72): string {
  const raw = typeof value === 'string' ? value : (parseMaybeObject(value).context as string | undefined) || ''
  const line = raw.replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function contextValue(value: unknown): string {
  const row = parseMaybeObject(value)

  if (typeof row.context === 'string') {
    return row.context
  }

  if (typeof row.preview === 'string') {
    return row.preview
  }

  return typeof value === 'string' ? value : ''
}

function prettyJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function parseMaybeObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  if (typeof value !== 'string' || !value.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(value)

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function numberValue(value: unknown): null | number {
  const n = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(n) ? n : null
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function looksLikePath(value: string): boolean {
  return /^file:\/\//i.test(value) || /^(?:\/|\.{1,2}\/|~\/).+/.test(value)
}

function isPreviewableTarget(target: string): boolean {
  return Boolean(
    target &&
      (/^file:\/\//i.test(target) ||
        /^(?:\/|\.{1,2}\/|~\/).+\.html?$/i.test(target) ||
        /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(target))
  )
}

const URL_PATTERN = /https?:\/\/[^\s'"<>)\]]+/i

function findFirstUrl(...sources: unknown[]): string {
  for (const src of sources) {
    if (typeof src === 'string') {
      const m = src.match(URL_PATTERN)

      if (m) {
        return m[0]
      }
    } else if (src && typeof src === 'object') {
      for (const v of Object.values(src as Record<string, unknown>)) {
        const found = findFirstUrl(v)

        if (found) {
          return found
        }
      }
    }
  }

  return ''
}

function hostnameOf(value: string): string {
  try {
    const url = new URL(value)

    return `${url.hostname}${url.pathname && url.pathname !== '/' ? url.pathname : ''}`
  } catch {
    return value
  }
}

function looksRedundant(title: string, detail: string): boolean {
  if (!detail) {
    return true
  }

  const norm = (input: string) => input.toLowerCase().replace(/\s+/g, ' ').trim()

  return norm(title) === norm(detail)
}

function summarizeBrowserSnapshot(snapshot: string): string {
  const count = (re: RegExp) => snapshot.match(re)?.length ?? 0

  const stats = [
    `${count(/button\s+"[^"]+"/g)} buttons`,
    `${count(/link\s+"[^"]+"/g)} links`,
    `${count(/(?:textbox|combobox|searchbox)\s+"[^"]+"/g)} inputs`
  ].join(' · ')

  const labels = Array.from(snapshot.matchAll(/(?:button|link|combobox|textbox)\s+"([^"]+)"/g))
    .map(m => m[1].trim())
    .filter(Boolean)
    .slice(0, 4)

  return labels.length ? `${stats}\nTop controls: ${labels.join(', ')}` : stats
}

function firstStringField(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function extractSearchResults(result: unknown): SearchResultRow[] {
  const row = parseMaybeObject(result)
  const list = (Array.isArray(row.results) ? row.results : Array.isArray(row.items) ? row.items : Array.isArray(row.data) ? row.data : []) as unknown[]

  return list
    .map(item => {
      const r = parseMaybeObject(item)

      return {
        title: firstStringField(r, ['title', 'name']),
        url: firstStringField(r, ['url', 'href', 'link']),
        snippet: firstStringField(r, ['snippet', 'description', 'body'])
      }
    })
    .filter(hit => hit.title || hit.url)
    .slice(0, 3)
}

function toolErrorText(part: ToolPart, result: Record<string, unknown>): string {
  if (part.isError) {
    return 'Tool returned an error.'
  }

  if (typeof result.error === 'string' && result.error.trim()) {
    return result.error.trim()
  }

  if (result.success === false) {
    return firstStringField(result, ['message', 'reason']) || 'Tool returned success=false.'
  }

  const exit = numberValue(result.exit_code)

  return exit !== null && exit !== 0 ? `Command failed with exit code ${exit}.` : ''
}

function toolStatus(part: ToolPart, resultRecord: Record<string, unknown>): ToolStatus {
  if (part.result === undefined) {
    return 'running'
  }

  return toolErrorText(part, resultRecord) ? 'error' : 'success'
}

function durationLabel(resultRecord: Record<string, unknown>): string | undefined {
  const seconds = numberValue(resultRecord.duration_s)

  if (seconds === null || seconds < 0) {
    return undefined
  }

  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
}

function toolPreviewTarget(toolName: string, args: Record<string, unknown>, result: Record<string, unknown>): string {
  const direct =
    firstStringField(result, ['preview', 'url', 'target']) ||
    firstStringField(args, ['preview', 'url', 'target', 'path', 'file', 'filepath']) ||
    firstStringField(result, ['path', 'file', 'filepath'])

  if (direct && (looksLikeUrl(direct) || looksLikePath(direct))) {
    return direct
  }

  if (toolName === 'browser_navigate' || toolName === 'web_extract' || toolName === 'web_search') {
    const explicit = firstStringField(args, ['url', 'search_term', 'query']) || firstStringField(result, ['url'])

    return looksLikeUrl(explicit) ? explicit : findFirstUrl(args, result)
  }

  return ''
}

function toolImageUrl(args: Record<string, unknown>, result: Record<string, unknown>): string {
  const candidate =
    firstStringField(result, ['image_url', 'url', 'path', 'image_path']) ||
    firstStringField(args, ['image_url', 'url', 'path'])

  if (!candidate) {
    return ''
  }

  return candidate.toLowerCase().startsWith('data:image/') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(candidate)
    ? candidate
    : ''
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
}

function stripInlineDiffChrome(value: string): string {
  return value
    ? stripAnsi(value)
        .replace(/^\s*┊\s*review diff\s*\n/i, '')
        .trim()
    : ''
}

function inlineDiffFromResult(result: unknown): string {
  const value = parseMaybeObject(result).inline_diff

  return typeof value === 'string' ? stripInlineDiffChrome(value) : ''
}

function fallbackDetailText(args: unknown, result: unknown): string {
  const argContext = contextValue(args)
  const resultContext = contextValue(result)

  if (resultContext && resultContext !== argContext) {
    return resultContext
  }

  if (argContext) {
    return argContext
  }

  if (result !== undefined) {
    return prettyJson(result)
  }

  return prettyJson(args)
}

function toolSubtitle(part: ToolPart, argsRecord: Record<string, unknown>, resultRecord: Record<string, unknown>): string {
  const toolName = part.toolName

  if (toolName === 'browser_navigate') {
    const url =
      firstStringField(argsRecord, ['url', 'target']) ||
      firstStringField(resultRecord, ['url']) ||
      findFirstUrl(argsRecord, resultRecord)

    return url ? hostnameOf(url) : 'Navigated in browser'
  }

  if (toolName === 'browser_snapshot') {
    const snapshot = firstStringField(resultRecord, ['snapshot'])

    return snapshot ? summarizeBrowserSnapshot(snapshot) : 'Captured a browser accessibility snapshot'
  }

  if (toolName === 'browser_click') {
    const clicked = firstStringField(resultRecord, ['clicked']) || firstStringField(argsRecord, ['ref', 'target'])

    if (!clicked) {
      return 'Clicked on page'
    }

    return clicked.startsWith('@') ? `Clicked page element (internal ref ${clicked})` : `Clicked ${clicked}`
  }

  if (toolName === 'browser_fill' || toolName === 'browser_type') {
    const field = firstStringField(argsRecord, ['label', 'field', 'ref', 'target'])
    const value = firstStringField(argsRecord, ['value', 'text'])

    return [field && `Field: ${field}`, value && `Value: ${compactPreview(value, 42)}`].filter(Boolean).join(' · ') || 'Filled page input'
  }

  if (toolName === 'web_search') {
    const query = firstStringField(argsRecord, ['search_term', 'query']) || contextValue(argsRecord)

    return query ? `Query: ${query}` : 'Queried web sources'
  }

  if (toolName === 'terminal' || toolName === 'execute_code') {
    const command = firstStringField(argsRecord, ['command', 'code']) || contextValue(argsRecord)

    return command ? compactPreview(command, 120) : 'Executed command'
  }

  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') {
    const path = firstStringField(argsRecord, ['path', 'file', 'filepath'])

    return path || fallbackDetailText(argsRecord, resultRecord)
  }

  if (toolName === 'web_extract') {
    const url =
      firstStringField(argsRecord, ['url']) ||
      firstStringField(resultRecord, ['url']) ||
      findFirstUrl(argsRecord, resultRecord)

    return url ? hostnameOf(url) : 'Fetched webpage'
  }

  return compactPreview(resultRecord, 120) || compactPreview(argsRecord, 120) || fallbackDetailText(argsRecord, resultRecord)
}

function toolDetailLabel(toolName: string): string {
  if (toolName === 'web_search') {
    return 'Search results'
  }

  if (toolName === 'browser_snapshot') {
    return 'Snapshot summary'
  }

  if (toolName === 'terminal' || toolName === 'execute_code') {
    return 'Command output'
  }

  return ''
}

function toolDetailText(part: ToolPart, argsRecord: Record<string, unknown>, resultRecord: Record<string, unknown>): string {
  if (part.toolName === 'browser_snapshot') {
    const snapshot = firstStringField(resultRecord, ['snapshot'])

    return snapshot ? summarizeBrowserSnapshot(snapshot) : fallbackDetailText(argsRecord, resultRecord)
  }

  if (part.toolName === 'web_search') {
    const hits = extractSearchResults(part.result)

    if (hits.length) {
      return hits
        .map(hit => [hit.title, hit.url, hit.snippet].filter(Boolean).join('\n'))
        .join('\n\n')
    }
  }

  if (part.toolName === 'terminal' || part.toolName === 'execute_code') {
    const output = firstStringField(resultRecord, ['output', 'stdout', 'stderr'])

    const lines = Array.isArray(resultRecord.lines)
      ? resultRecord.lines.filter((line): line is string => typeof line === 'string').join('\n')
      : ''

    if (output || lines) {
      return [output, lines].filter(Boolean).join('\n')
    }
  }

  if (part.toolName === 'web_extract') {
    const summary = firstStringField(resultRecord, ['summary', 'message'])

    if (summary) {
      return summary.replace(/\s*in\s+\d+(?:\.\d+)?s\s*$/i, '').trim()
    }
  }

  return fallbackDetailText(argsRecord, resultRecord)
}

function dynamicTitle(
  part: ToolPart,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  fallback: string
): string {
  const verb = (gerund: string, past: string) => (part.result === undefined ? gerund : past)

  if (part.toolName === 'web_extract') {
    const url = findFirstUrl(args, result)

    return url ? `${verb('Reading', 'Read')} ${hostnameOf(url)}` : fallback
  }

  if (part.toolName === 'browser_navigate') {
    const url = findFirstUrl(args, result)

    return url ? `${verb('Opening', 'Opened')} ${hostnameOf(url)}` : fallback
  }

  if (part.toolName === 'web_search') {
    const query = firstStringField(args, ['search_term', 'query']) || contextValue(args)

    return query ? `${verb('Searching', 'Searched')} “${compactPreview(query, 48)}”` : fallback
  }

  return fallback
}

function buildToolView(part: ToolPart, inlineDiff: string): ToolView {
  const argsRecord = parseMaybeObject(part.args)
  const resultRecord = parseMaybeObject(part.result)
  const meta = toolMeta(part.toolName)
  const status = toolStatus(part, resultRecord)
  const error = toolErrorText(part, resultRecord)
  const baseTitle = part.result === undefined ? meta.pending : meta.done
  const title = dynamicTitle(part, argsRecord, resultRecord, baseTitle)
  const titleEnriched = title !== baseTitle
  const baseSubtitle = error || toolSubtitle(part, argsRecord, resultRecord)
  const subtitle = titleEnriched && !error ? '' : baseSubtitle

  return {
    detail: error || toolDetailText(part, argsRecord, resultRecord),
    detailLabel: error ? 'Error' : toolDetailLabel(part.toolName),
    durationLabel: durationLabel(resultRecord),
    icon: meta.icon,
    imageUrl: toolImageUrl(argsRecord, resultRecord),
    inlineDiff,
    previewTarget: toolPreviewTarget(part.toolName, argsRecord, resultRecord),
    rawArgs: prettyJson(part.args),
    rawResult: prettyJson(part.result),
    status,
    subtitle,
    title,
    tone: meta.tone
  }
}

function isToolPart(part: unknown): part is ToolPart {
  if (!part || typeof part !== 'object') {
    return false
  }

  const row = part as Record<string, unknown>

  return row.type === 'tool-call' && typeof row.toolName === 'string'
}

function groupToolParts(content: unknown): ToolPart[][] {
  if (!Array.isArray(content)) {
    return []
  }

  const groups: ToolPart[][] = []
  let current: ToolPart[] = []

  for (const part of content) {
    if (isToolPart(part)) {
      current.push(part)

      continue
    }

    if (current.length) {
      groups.push(current)
      current = []
    }
  }

  if (current.length) {
    groups.push(current)
  }

  return groups
}

function groupStatus(parts: ToolPart[]): ToolStatus {
  if (parts.some(p => p.result === undefined)) {
    return 'running'
  }

  return parts.some(p => toolStatus(p, parseMaybeObject(p.result)) === 'error') ? 'error' : 'success'
}

function groupTitle(parts: ToolPart[]): string {
  const prefix = PREFIX_META.find(p => parts.every(part => part.toolName.startsWith(p.prefix)))
  const verb = prefix?.verb || 'Tool'

  return `${verb} actions · ${parts.length} steps`
}

const STATUS_DOT_CLASS: Record<ToolStatus, string> = {
  error: 'bg-destructive',
  running: 'bg-muted-foreground/55 animate-pulse',
  success: 'bg-emerald-500'
}

function statusDot(status: ToolStatus): ReactNode {
  return (
    <span
      aria-label={status === 'error' ? 'Error' : status === 'running' ? 'Running' : 'Done'}
      className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[status])}
    />
  )
}

function statusBadge(status: ToolStatus): ReactNode {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Running
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[0.625rem] font-medium text-destructive">
        <AlertCircle className="size-3" />
        Error
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="size-3" />
      Done
    </span>
  )
}

interface ToolEntryProps {
  embedded?: boolean
  part: ToolPart
}

function ToolEntry({ embedded = false, part }: ToolEntryProps) {
  const [open, setOpen] = useState(false)
  const isPending = part.result === undefined
  const [tick, setTick] = useState(0)
  const elapsed = useElapsedSeconds(isPending)
  const toolViewMode = useStore($toolViewMode)
  const preview = compactPreview(part.args) || compactPreview(part.result)
  const liveDiffs = useStore($toolInlineDiffs)
  const sideDiff = part.toolCallId ? liveDiffs[part.toolCallId] || '' : ''
  const inlineDiff = stripInlineDiffChrome(sideDiff) || inlineDiffFromResult(part.result)
  const view = useMemo(() => buildToolView(part, inlineDiff), [inlineDiff, part])
  const spinnerFrame = TOOL_SPINNER_FRAMES[tick % TOOL_SPINNER_FRAMES.length]

  useEffect(() => {
    if (!isPending) {
      return
    }

    const id = window.setInterval(() => setTick(value => value + 1), TOOL_SPINNER_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [isPending])

  return (
    <div
      className={cn(
        'text-sm text-muted-foreground',
        embedded ? 'my-0 border-0 bg-transparent' : 'mb-2 mt-1 rounded-lg border border-border/70 bg-card/50',
        !embedded && open && 'mb-3'
      )}
    >
      <button
        className="inline-grid w-full max-w-full grid-cols-[0.75rem_auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-accent/45 hover:text-foreground"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <ChevronRight
          className={cn('shrink-0 text-muted-foreground/80 transition-transform', open && 'rotate-90')}
          size={12}
        />
        <span className={cn('grid size-6 place-items-center rounded-md', TOOL_TONE_CLASS[view.tone])}>
          <view.icon className="size-3.5" />
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              'block truncate text-xs font-medium text-foreground/90',
              isPending && 'shimmer text-foreground/60'
            )}
          >
            {view.title}
          </span>
          {view.subtitle && (
            <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-[0.7rem] leading-relaxed text-muted-foreground/80">
              {toolViewMode === 'technical' ? preview || view.subtitle : view.subtitle}
            </span>
          )}
        </span>
        {isPending ? (
          embedded ? (
            statusDot('running')
          ) : (
            <span aria-label="Running" className="ml-1 w-3 shrink-0 text-center text-xs text-muted-foreground/80">
              {spinnerFrame}
            </span>
          )
        ) : embedded ? (
          statusDot(view.status)
        ) : (
          statusBadge(view.status)
        )}
        {isPending && !embedded && <ActivityTimerText seconds={elapsed} />}
        {!isPending && view.durationLabel && (
          <span className="text-[0.625rem] font-medium text-muted-foreground/75">{view.durationLabel}</span>
        )}
      </button>
      {open && (
        <div className={cn(TOOL_DETAIL_INDENT_CLASS, 'mt-2 mr-2 grid gap-2 pb-3')}>
          {view.previewTarget && isPreviewableTarget(view.previewTarget) && (
            <PreviewAttachment target={view.previewTarget} />
          )}
          {view.imageUrl && (
            <div className="max-w-[18rem] overflow-hidden rounded-lg border border-border/70">
              <ZoomableImage alt="Tool output" className="h-auto w-full object-cover" src={view.imageUrl} />
            </div>
          )}
          {!looksRedundant(view.title, view.detail) && !looksRedundant(view.subtitle, view.detail) && (
            <div className="max-w-full rounded-md bg-muted/35 px-2.5 py-1.5 whitespace-pre-wrap wrap-anywhere text-xs leading-relaxed text-muted-foreground/85">
              {view.detailLabel && (
                <span className="mr-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">
                  {view.detailLabel}
                </span>
              )}
              <span>{view.detail}</span>
            </div>
          )}
          {toolViewMode === 'technical' && (
            <div className="grid gap-2">
              <JsonSection label="Input" value={view.rawArgs} />
              {part.result !== undefined && <JsonSection label="Output" value={view.rawResult} />}
            </div>
          )}
        </div>
      )}
      {view.inlineDiff && <InlineDiff text={view.inlineDiff} />}
    </div>
  )
}

function JsonSection({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[0.65rem] font-medium tracking-[0.08em] text-muted-foreground/75 uppercase">{label}</div>
      <pre className="max-h-56 overflow-auto rounded-md border border-border/70 bg-background/65 p-2 font-mono text-[0.65rem] leading-relaxed text-muted-foreground/90">
        {value}
      </pre>
    </div>
  )
}

function ToolGroup({ parts }: { parts: ToolPart[] }) {
  const [open, setOpen] = useState(parts.some(part => part.result === undefined))
  const status = groupStatus(parts)

  const tailSummary = useMemo(() => {
    const tail = parts.at(-1)

    return tail ? buildToolView(tail, '').subtitle : ''
  }, [parts])

  return (
    <div className={cn('mb-2 mt-1 rounded-lg border border-border/70 bg-card/45', open && 'mb-3')}>
      <button
        className="inline-grid w-full grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/45"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <ChevronRight className={cn('shrink-0 text-muted-foreground/80 transition-transform', open && 'rotate-90')} size={12} />
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-foreground/90">{groupTitle(parts)}</span>
          {tailSummary && (
            <span className="line-clamp-1 block text-[0.68rem] text-muted-foreground/75">{tailSummary.replace(/\n+/g, ' · ')}</span>
          )}
        </span>
        {statusBadge(status)}
      </button>
      {open && (
        <div className="mt-1 divide-y divide-border/55 overflow-hidden pb-1">
          {parts.map(part => (
            <ToolEntry embedded key={part.toolCallId || `${part.toolName}-${JSON.stringify(part.args)}`} part={part} />
          ))}
        </div>
      )}
    </div>
  )
}

export const ToolFallback = ({ toolCallId, toolName, args, isError, result }: ToolCallMessagePartProps) => {
  const messageContent = useAuiState(state => state.message.content as unknown)
  const groups = useMemo(() => groupToolParts(messageContent), [messageContent])

  const currentPart: ToolPart = {
    args,
    isError,
    result,
    toolCallId,
    toolName,
    type: 'tool-call'
  }

  if (!toolCallId) {
    return <ToolEntry part={currentPart} />
  }

  const group = groups.find(parts => parts.some(part => part.toolCallId === toolCallId))

  if (!group || group.length <= 1) {
    return <ToolEntry part={currentPart} />
  }

  if (group[0]?.toolCallId !== toolCallId) {
    return null
  }

  return <ToolGroup parts={group} />
}

function InlineDiff({ text }: { text: string }) {
  return (
    <pre className="ml-4 mt-2 max-h-96 max-w-full overflow-auto rounded-lg border border-border/60 bg-background/70 px-3 py-2 font-mono text-[0.6875rem] leading-relaxed">
      {text.split('\n').map((line, index) => {
        const added = line.startsWith('+') && !line.startsWith('+++')
        const removed = line.startsWith('-') && !line.startsWith('---')
        const hunk = line.startsWith('@@')
        const fileHeader = line.startsWith('---') || line.startsWith('+++') || / → /.test(line.slice(0, 60))

        return (
          <span
            className={cn(
              'block min-w-max whitespace-pre',
              added && 'text-emerald-700 dark:text-emerald-300',
              removed && 'text-rose-700 dark:text-rose-300',
              hunk && 'text-sky-700 dark:text-sky-300',
              !added && !removed && !hunk && fileHeader && 'text-muted-foreground/80'
            )}
            key={`${index}-${line}`}
          >
            {line || ' '}
          </span>
        )
      })}
    </pre>
  )
}
