'use client'

import { type ToolCallMessagePartProps, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'

import { useElapsedSeconds } from '@/components/assistant-ui/activity-timer'
import { ActivityTimerText } from '@/components/assistant-ui/activity-timer-text'
import { PreviewAttachment } from '@/components/assistant-ui/preview-attachment'
import { ZoomableImage } from '@/components/assistant-ui/zoomable-image'
import { CopyButton } from '@/components/ui/copy-button'
import { FadeText } from '@/components/ui/fade-text'
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
import { $toolDisclosureStates, $toolViewMode, setToolDisclosureOpen } from '@/store/tool-view'

// Indent tool detail content via box-sizing-honoring padding, not margin.
// Margin-left + max-w-full causes the box to overflow its parent by the
// margin amount, which makes wide tool content (preview cards, diffs)
// extend past the chat column when right-side panes are open.
const TOOL_DETAIL_INDENT_CLASS = 'w-full pl-[1.5rem] pr-2'

type ToolTone = 'agent' | 'browser' | 'default' | 'file' | 'image' | 'terminal' | 'web'
type ToolStatus = 'error' | 'running' | 'success' | 'warning'

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
  browser_snapshot: {
    done: 'Captured page snapshot',
    pending: 'Capturing page snapshot',
    icon: Globe,
    tone: 'browser'
  },
  browser_take_screenshot: {
    done: 'Captured screenshot',
    pending: 'Capturing screenshot',
    icon: Sparkles,
    tone: 'browser'
  },
  browser_type: { done: 'Typed on page', pending: 'Typing on page', icon: Globe, tone: 'browser' },
  edit_file: { done: 'Edited file', pending: 'Editing file', icon: FileText, tone: 'file' },
  execute_code: { done: 'Ran code', pending: 'Running code', icon: Command, tone: 'terminal' },
  image_generate: { done: 'Generated image', pending: 'Generating image', icon: Sparkles, tone: 'image' },
  list_files: { done: 'Listed files', pending: 'Listing files', icon: FileText, tone: 'file' },
  read_file: { done: 'Read file', pending: 'Reading file', icon: FileText, tone: 'file' },
  search_files: { done: 'Searched files', pending: 'Searching files', icon: FileText, tone: 'file' },
  session_search_recall: {
    done: 'Searched session history',
    pending: 'Searching session history',
    icon: Search,
    tone: 'agent'
  },
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

const STATUS_ICON_CLASS: Record<ToolStatus, string> = {
  error: 'bg-destructive/12 text-destructive',
  running: '',
  success: '',
  warning: 'bg-amber-500/14 text-amber-700 dark:text-amber-300'
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
  let raw: unknown
  if (typeof value === 'string') {
    raw = value
  } else {
    raw = parseMaybeObject(value).context
  }
  if (typeof raw !== 'string') {
    if (raw == null) {
      raw = ''
    } else {
      try {
        raw = JSON.stringify(raw)
      } catch {
        raw = String(raw)
      }
    }
  }
  const line = (raw as string).replace(/\s+/g, ' ').trim()

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

function stableHash(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index)
  }

  return Math.abs(hash).toString(36)
}

function toolPartDisclosureId(part: ToolPart): string {
  if (part.toolCallId) {
    return `tool:${part.toolCallId}`
  }

  return `tool:${part.toolName}:${stableHash(JSON.stringify(part.args ?? ''))}`
}

function toolGroupDisclosureId(parts: ToolPart[]): string {
  return `tool-group:${parts.map(toolPartDisclosureId).join('|')}`
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

  const list = (
    Array.isArray(row.results)
      ? row.results
      : Array.isArray(row.items)
        ? row.items
        : Array.isArray(row.data)
          ? row.data
          : []
  ) as unknown[]

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

  if (toolName === 'write_file' || toolName === 'edit_file') {
    return htmlPathFromInlineDiff(firstStringField(result, ['inline_diff']))
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

function htmlPathFromInlineDiff(value: string): string {
  const cleaned = stripInlineDiffChrome(value)

  for (const match of cleaned.matchAll(/(?:^|\s)(?:[ab]\/)?([^\s]+\.html?)(?=\s|$)/gi)) {
    const candidate = match[1]?.trim()

    if (candidate) {
      return candidate
    }
  }

  return ''
}

function stripDividerLines(value: string): string {
  return value
    .split('\n')
    .filter(line => !/^[-=]{3,}\s*$/.test(line.trim()))
    .join('\n')
    .trim()
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

function toolSubtitle(
  part: ToolPart,
  argsRecord: Record<string, unknown>,
  resultRecord: Record<string, unknown>
): string {
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

    return (
      [field && `Field: ${field}`, value && `Value: ${compactPreview(value, 42)}`].filter(Boolean).join(' · ') ||
      'Filled page input'
    )
  }

  if (toolName === 'web_search') {
    const query = firstStringField(argsRecord, ['search_term', 'query']) || contextValue(argsRecord)

    return query ? `Query: ${query}` : 'Queried web sources'
  }

  if (toolName === 'terminal' || toolName === 'execute_code') {
    const output = firstStringField(resultRecord, ['output', 'stdout', 'stderr'])

    const lines = Array.isArray(resultRecord.lines)
      ? resultRecord.lines.filter((line): line is string => typeof line === 'string').join('\n')
      : ''

    const previewSource = (output || lines).trim()

    if (previewSource) {
      const firstMeaningfulLine = previewSource
        .split('\n')
        .map(line => line.trim())
        .find(line => line.length > 0)

      if (firstMeaningfulLine) {
        return compactPreview(firstMeaningfulLine, 160)
      }
    }

    const command = firstStringField(argsRecord, ['command', 'code']) || contextValue(argsRecord)

    return command ? compactPreview(command, 120) : 'Executed command'
  }

  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') {
    const path =
      firstStringField(argsRecord, ['path', 'file', 'filepath']) ||
      htmlPathFromInlineDiff(firstStringField(resultRecord, ['inline_diff']))

    return (
      path ||
      (firstStringField(resultRecord, ['inline_diff']) ? 'Changed file' : fallbackDetailText(argsRecord, resultRecord))
    )
  }

  if (toolName === 'web_extract') {
    const url =
      firstStringField(argsRecord, ['url']) ||
      firstStringField(resultRecord, ['url']) ||
      findFirstUrl(argsRecord, resultRecord)

    return url ? hostnameOf(url) : 'Fetched webpage'
  }

  return (
    compactPreview(resultRecord, 120) || compactPreview(argsRecord, 120) || fallbackDetailText(argsRecord, resultRecord)
  )
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

function toolDetailText(
  part: ToolPart,
  argsRecord: Record<string, unknown>,
  resultRecord: Record<string, unknown>
): string {
  if (part.toolName === 'browser_snapshot') {
    const snapshot = firstStringField(resultRecord, ['snapshot'])

    return snapshot ? summarizeBrowserSnapshot(snapshot) : fallbackDetailText(argsRecord, resultRecord)
  }

  if (part.toolName === 'web_search') {
    const hits = extractSearchResults(part.result)

    if (hits.length) {
      return hits.map(hit => [hit.title, hit.url, hit.snippet].filter(Boolean).join('\n')).join('\n\n')
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
    const direct = firstStringField(resultRecord, ['content', 'text', 'markdown', 'body', 'summary', 'message'])

    if (direct) {
      return direct.replace(/\s*in\s+\d+(?:\.\d+)?s\s*$/i, '').trim()
    }

    const results = Array.isArray(resultRecord.results) ? resultRecord.results : []

    const aggregated = results
      .map(item => {
        const row = parseMaybeObject(item)

        return firstStringField(row, ['content', 'text', 'markdown', 'body'])
      })
      .filter(Boolean)
      .join('\n\n---\n\n')

    if (aggregated) {
      return aggregated
    }
  }

  if (part.toolName === 'read_file') {
    const content = firstStringField(resultRecord, ['content', 'text', 'data', 'body'])

    if (content) {
      return content
    }
  }

  if (part.toolName === 'write_file' || part.toolName === 'edit_file') {
    return inlineDiffFromResult(part.result) ? '' : fallbackDetailText(argsRecord, resultRecord)
  }

  return fallbackDetailText(argsRecord, resultRecord)
}

/**
 * Pick the most useful single string for the user to copy from this tool
 * call.
 *
 * Heuristic: prefer the substantive *output* (the thing the user actually
 * sees in the expanded panel) over the meta target (URL, path, query). The
 * old behavior was the reverse, which meant clicking copy on a `read_file`
 * row that had just dumped a 400-line file would copy "src/foo.ts" instead
 * of the file. Tools where the meta is genuinely more useful than the
 * output (e.g. a search query) keep their meta-first behavior.
 */
function toolCopyPayload(part: ToolPart, view: ToolView): { label: string; text: string } {
  const args = parseMaybeObject(part.args)
  const result = parseMaybeObject(part.result)
  const detail = view.detail.trim()
  const hasSubstantialOutput = detail.length > 16

  if (part.toolName === 'terminal' || part.toolName === 'execute_code') {
    if (hasSubstantialOutput) {
      return { label: 'Copy output', text: detail }
    }

    const command = firstStringField(args, ['command', 'code']) || contextValue(args)

    if (command) {
      return { label: 'Copy command', text: command }
    }
  }

  if (part.toolName === 'web_extract') {
    if (hasSubstantialOutput) {
      return { label: 'Copy content', text: detail }
    }

    const url = firstStringField(args, ['url', 'target']) || findFirstUrl(args, result)

    if (url) {
      return { label: 'Copy URL', text: url }
    }
  }

  if (part.toolName === 'browser_navigate') {
    const url = firstStringField(args, ['url', 'target']) || findFirstUrl(args, result)

    if (url) {
      return { label: 'Copy URL', text: url }
    }
  }

  if (part.toolName === 'web_search') {
    const query = firstStringField(args, ['search_term', 'query']) || contextValue(args)

    if (query) {
      return { label: 'Copy query', text: query }
    }
  }

  if (part.toolName === 'read_file') {
    if (hasSubstantialOutput) {
      return { label: 'Copy file', text: detail }
    }

    const path = firstStringField(args, ['path', 'file', 'filepath'])

    if (path) {
      return { label: 'Copy path', text: path }
    }
  }

  if (part.toolName === 'write_file' || part.toolName === 'edit_file') {
    const path = firstStringField(args, ['path', 'file', 'filepath'])

    if (path) {
      return { label: 'Copy path', text: path }
    }
  }

  if (detail) {
    return { label: 'Copy output', text: detail }
  }

  return { label: 'Copy', text: view.title }
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

  if (part.toolName === 'terminal' || part.toolName === 'execute_code') {
    const command = firstStringField(args, ['command', 'code']) || contextValue(args)

    if (command) {
      const verbText = part.toolName === 'execute_code' ? verb('Running code', 'Ran code') : verb('Running', 'Ran')

      return `${verbText} · ${compactPreview(command, 160)}`
    }
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
  const keepSubtitleWithTitle = part.toolName === 'terminal' || part.toolName === 'execute_code'
  const subtitle = titleEnriched && !error && !keepSubtitleWithTitle ? '' : baseSubtitle
  const detailBody = stripDividerLines(toolDetailText(part, argsRecord, resultRecord))

  const detail = error
    ? [error, detailBody]
        .filter(Boolean)
        .filter((value, index, list) => list.findIndex(entry => entry.trim() === value.trim()) === index)
        .join('\n\n')
    : detailBody

  return {
    detail,
    detailLabel: error ? 'Error details' : toolDetailLabel(part.toolName),
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

  const statuses = parts.map(part => toolStatus(part, parseMaybeObject(part.result)))
  const hasError = statuses.includes('error')

  if (!hasError) {
    return 'success'
  }

  return statuses.at(-1) === 'success' ? 'warning' : 'error'
}

function groupTitle(parts: ToolPart[]): string {
  const prefix = PREFIX_META.find(p => parts.every(part => part.toolName.startsWith(p.prefix)))
  const verb = prefix?.verb || 'Tool'

  return `${verb} actions · ${parts.length} steps`
}

const STATUS_DOT_CLASS: Record<ToolStatus, string> = {
  error: 'bg-destructive',
  running: 'bg-muted-foreground/55 animate-pulse',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500'
}

const STATUS_LABEL: Record<ToolStatus, string> = {
  error: 'Error',
  running: 'Running',
  success: 'Done',
  warning: 'Recovered'
}

function statusDot(status: ToolStatus): ReactNode {
  return (
    <span
      aria-label={STATUS_LABEL[status]}
      className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[status])}
    />
  )
}

function statusGlyph(status: ToolStatus): ReactNode {
  if (status === 'running') {
    return <Loader2 aria-label="Running" className="size-3.5 shrink-0 animate-spin text-muted-foreground/80" />
  }

  if (status === 'error') {
    return <AlertCircle aria-label="Error" className="size-3.5 shrink-0 text-destructive" />
  }

  if (status === 'warning') {
    return <AlertCircle aria-label="Recovered" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
  }

  return <CheckCircle2 aria-label="Done" className="size-3.5 shrink-0 text-emerald-600/85 dark:text-emerald-400/85" />
}

interface ToolEntryProps {
  embedded?: boolean
  part: ToolPart
}

function ToolEntry({ embedded = false, part }: ToolEntryProps) {
  const isPending = part.result === undefined
  const elapsed = useElapsedSeconds(isPending)
  const toolViewMode = useStore($toolViewMode)
  const disclosureStates = useStore($toolDisclosureStates)
  const disclosureId = toolPartDisclosureId(part)
  const open = disclosureStates[disclosureId] ?? false
  const preview = compactPreview(part.args) || compactPreview(part.result)
  const liveDiffs = useStore($toolInlineDiffs)
  const sideDiff = part.toolCallId ? liveDiffs[part.toolCallId] || '' : ''
  const inlineDiff = stripInlineDiffChrome(sideDiff) || inlineDiffFromResult(part.result)
  const view = useMemo(() => buildToolView(part, inlineDiff), [inlineDiff, part])

  const detailSections = useMemo(() => {
    if (!view.detail) {
      return { body: '', summary: '' }
    }

    if (view.status !== 'error') {
      return { body: view.detail, summary: '' }
    }

    const chunks = view.detail
      .split(/\n\s*\n+/)
      .map(chunk => chunk.trim())
      .filter(Boolean)

    const [summary = '', ...rest] = chunks
    const subtitleNorm = view.subtitle.trim().toLowerCase()
    const summaryDuplicatesSubtitle = summary && summary.toLowerCase() === subtitleNorm

    if (summaryDuplicatesSubtitle) {
      return { body: rest.join('\n\n').trim(), summary: '' }
    }

    return { body: rest.join('\n\n').trim(), summary }
  }, [view.detail, view.status, view.subtitle])

  const detailMatchesSubtitle = looksRedundant(view.subtitle, view.detail)

  const showDetail =
    (view.status === 'error' && Boolean(detailSections.summary || detailSections.body)) ||
    (view.status !== 'error' &&
      Boolean(view.detail) &&
      !looksRedundant(view.title, view.detail) &&
      !detailMatchesSubtitle)

  const renderDetailAsCode =
    view.status !== 'error' &&
    (part.toolName === 'terminal' ||
      part.toolName === 'execute_code' ||
      part.toolName === 'read_file' ||
      part.toolName === 'web_extract')

  const hasExpandableContent = Boolean(
    (view.previewTarget && isPreviewableTarget(view.previewTarget)) ||
    view.imageUrl ||
    showDetail ||
    toolViewMode === 'technical'
  )

  const isTerminalLike = part.toolName === 'terminal' || part.toolName === 'execute_code'
  const subtitleText = view.subtitle ? (toolViewMode === 'technical' ? preview || view.subtitle : view.subtitle) : ''
  const subtitleIsSingleLine = !subtitleText.includes('\n')
  const showStatusGlyph = isPending || view.status === 'error' || view.status === 'warning'
  const copyAction = useMemo(() => toolCopyPayload(part, view), [part, view])

  return (
    <div className="min-w-0 max-w-full overflow-hidden text-sm text-muted-foreground" data-slot="tool-block">
      <div
        className={cn(
          'group/tool-row relative flex w-full max-w-full min-w-0 items-start rounded-md text-muted-foreground transition-colors',
          hasExpandableContent && 'hover:bg-accent/35 hover:text-foreground'
        )}
      >
        <button
          aria-expanded={hasExpandableContent ? open : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-start gap-2 px-2 py-0.5 text-left',
            hasExpandableContent ? 'cursor-pointer' : 'cursor-default'
          )}
          disabled={!hasExpandableContent}
          onClick={hasExpandableContent ? () => setToolDisclosureOpen(disclosureId, !open) : undefined}
          type="button"
        >
          <span className="flex h-[1.1rem] shrink-0 items-center">
            {hasExpandableContent ? (
              <ChevronRight
                className={cn(
                  'size-3 text-muted-foreground/55 transition-transform group-hover/tool-row:text-muted-foreground/85',
                  open && 'rotate-90'
                )}
              />
            ) : (
              <span aria-hidden="true" className="size-3" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              {showStatusGlyph && (
                <span className="flex h-[1.1rem] shrink-0 items-center">
                  {statusGlyph(isPending ? 'running' : view.status)}
                </span>
              )}
              <FadeText
                className={cn(
                  'text-[0.78rem] font-medium leading-[1.1rem] text-foreground/85',
                  isPending && 'shimmer text-foreground/55',
                  view.status === 'error' && 'text-destructive',
                  view.status === 'warning' && 'text-amber-700 dark:text-amber-300'
                )}
              >
                {view.title}
              </FadeText>
              {!isPending && view.durationLabel && (
                <span className="shrink-0 text-[0.625rem] tabular-nums text-muted-foreground/55">
                  {view.durationLabel}
                </span>
              )}
            </span>
            {subtitleText &&
              (subtitleIsSingleLine ? (
                <FadeText
                  className={cn(
                    'text-[0.7rem] leading-[1.05rem] text-muted-foreground/70',
                    isTerminalLike && 'font-mono text-[0.68rem]'
                  )}
                >
                  {subtitleText}
                </FadeText>
              ) : (
                <span
                  className={cn(
                    'line-clamp-2 block whitespace-pre-wrap text-[0.7rem] leading-[1.05rem] text-muted-foreground/70',
                    isTerminalLike && 'font-mono text-[0.68rem]'
                  )}
                >
                  {subtitleText}
                </span>
              ))}
          </span>
        </button>
        {isPending && !embedded && (
          <ActivityTimerText
            className="flex h-[1.1rem] shrink-0 items-center pr-2 text-[0.625rem] tabular-nums text-muted-foreground/55"
            seconds={elapsed}
          />
        )}
        {!isPending && copyAction.text && (
          <CopyButton
            appearance="tool-row"
            className="absolute right-1 top-0.5"
            label={copyAction.label}
            stopPropagation
            text={copyAction.text}
          />
        )}
      </div>
      {open && (
        <div className={cn(TOOL_DETAIL_INDENT_CLASS, 'mt-2 grid min-w-0 max-w-full gap-2 overflow-hidden pb-2')}>
          {!embedded && view.previewTarget && isPreviewableTarget(view.previewTarget) && (
            <PreviewAttachment source="tool-result" target={view.previewTarget} />
          )}
          {view.imageUrl && (
            <div className="max-w-72 overflow-hidden rounded-lg border border-border/70">
              <ZoomableImage alt="Tool output" className="h-auto w-full object-cover" src={view.imageUrl} />
            </div>
          )}
          {showDetail &&
            (view.status === 'error' ? (
              detailSections.summary || detailSections.body ? (
                <div className="max-w-full text-xs leading-relaxed text-destructive">
                  {detailSections.summary && <p className="font-medium">{detailSections.summary}</p>}
                  {detailSections.body && (
                    <pre
                      className={cn(
                        'max-h-56 overflow-auto whitespace-pre-wrap wrap-anywhere font-mono text-[0.7rem] leading-[1.55] text-destructive/90',
                        detailSections.summary && 'mt-1.5'
                      )}
                    >
                      {detailSections.body}
                    </pre>
                  )}
                </div>
              ) : null
            ) : (
              <div className="max-w-full text-xs leading-relaxed text-muted-foreground/90">
                {view.detailLabel && (
                  <p className="mb-1 text-[0.66rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/65">
                    {view.detailLabel}
                  </p>
                )}
                {renderDetailAsCode ? (
                  <pre className="max-h-56 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere border-l-2 border-border/50 pl-3 font-mono text-[0.7rem] leading-[1.55] text-foreground/85">
                    {view.detail}
                  </pre>
                ) : (
                  <p className="whitespace-pre-wrap wrap-anywhere">{view.detail}</p>
                )}
              </div>
            ))}
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
      <div className="mb-1 text-[0.65rem] font-medium tracking-[0.08em] text-muted-foreground/75 uppercase">
        {label}
      </div>
      <pre className="max-h-56 max-w-full overflow-auto rounded-md border border-border/70 bg-background/65 p-2 font-mono text-[0.65rem] leading-relaxed text-muted-foreground/90">
        {value}
      </pre>
    </div>
  )
}

function groupPreviewTargets(parts: ToolPart[]): string[] {
  const seen = new Set<string>()
  const targets: string[] = []

  for (const part of parts) {
    const view = buildToolView(part, inlineDiffFromResult(part.result))
    const target = view.previewTarget

    if (target && isPreviewableTarget(target) && !seen.has(target)) {
      seen.add(target)
      targets.push(target)
    }
  }

  return targets
}

function ToolGroup({ parts }: { parts: ToolPart[] }) {
  const isRunning = parts.some(part => part.result === undefined)
  const disclosureStates = useStore($toolDisclosureStates)
  const disclosureId = toolGroupDisclosureId(parts)
  const open = disclosureStates[disclosureId] ?? isRunning
  // Auto-collapse once the whole turn settles. While streaming, keep open
  // so the user can watch progress; on completion we fold it down to a
  // single Activity row, matching the webui pattern.
  const wasRunningRef = useRef(isRunning)

  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      setToolDisclosureOpen(disclosureId, false)
    }

    wasRunningRef.current = isRunning
  }, [disclosureId, isRunning])

  const status = groupStatus(parts)

  const failedStepCount = useMemo(
    () => parts.filter(part => toolStatus(part, parseMaybeObject(part.result)) === 'error').length,
    [parts]
  )

  const totalDurationLabel = useMemo(() => {
    const seconds = parts.reduce((sum, part) => {
      const value = numberValue(parseMaybeObject(part.result).duration_s)

      return sum + (value && value > 0 ? value : 0)
    }, 0)

    if (!seconds) {
      return ''
    }

    return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`
  }, [parts])

  const statusSummary =
    status === 'running' || failedStepCount === 0
      ? ''
      : status === 'warning'
        ? failedStepCount === 1
          ? 'Recovered after 1 failed step'
          : `Recovered after ${failedStepCount} failed steps`
        : failedStepCount === 1
          ? '1 step failed'
          : `${failedStepCount} steps failed`

  const tailSummary = useMemo(() => {
    const tail = parts.at(-1)

    return tail ? buildToolView(tail, '').subtitle : ''
  }, [parts])

  const groupCopyText = useMemo(() => {
    return parts
      .map(part => {
        const view = buildToolView(part, '')
        const lines = [view.title]

        if (view.subtitle && view.subtitle !== view.title) {
          lines.push(view.subtitle)
        }

        if (view.detail && view.detail !== view.subtitle) {
          lines.push(view.detail)
        }

        return lines.join('\n')
      })
      .join('\n\n')
  }, [parts])

  const showGroupStatusGlyph = status !== 'success'
  const previewTargets = useMemo(() => groupPreviewTargets(parts), [parts])

  return (
    <div className="min-w-0 max-w-full overflow-hidden" data-slot="tool-block">
      <div className="group/tool-row relative flex w-full max-w-full min-w-0 items-start rounded-md text-muted-foreground transition-colors hover:bg-accent/35 hover:text-foreground">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-0.5 text-left"
          onClick={() => setToolDisclosureOpen(disclosureId, !open)}
          type="button"
        >
          <span className="flex h-[1.1rem] shrink-0 items-center">
            <ChevronRight
              className={cn(
                'size-3 text-muted-foreground/55 transition-transform group-hover/tool-row:text-muted-foreground/85',
                open && 'rotate-90'
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              {showGroupStatusGlyph && (
                <span className="flex h-[1.1rem] shrink-0 items-center">{statusGlyph(status)}</span>
              )}
              <FadeText
                className={cn(
                  'text-[0.78rem] font-medium leading-[1.1rem] text-foreground/85',
                  status === 'error' && 'text-destructive',
                  status === 'warning' && 'text-amber-700 dark:text-amber-300'
                )}
              >
                {groupTitle(parts)}
              </FadeText>
              {totalDurationLabel && (
                <span className="shrink-0 text-[0.625rem] tabular-nums text-muted-foreground/55">
                  {totalDurationLabel}
                </span>
              )}
            </span>
            {tailSummary && (
              <FadeText className="text-[0.7rem] leading-[1.05rem] text-muted-foreground/70">
                {tailSummary.replace(/\n+/g, ' · ')}
              </FadeText>
            )}
            {statusSummary && (
              <FadeText
                className={cn(
                  'text-[0.68rem] leading-[1.05rem]',
                  status === 'warning' ? 'text-amber-700/80 dark:text-amber-300/85' : 'text-destructive/85'
                )}
              >
                {statusSummary}
              </FadeText>
            )}
          </span>
        </button>
        {!isRunning && groupCopyText && (
          <CopyButton
            appearance="tool-row"
            className="absolute right-1 top-0.5"
            label="Copy activity"
            stopPropagation
            text={groupCopyText}
          />
        )}
      </div>
      {previewTargets.length > 0 && (
        <div className={cn(TOOL_DETAIL_INDENT_CLASS, 'mt-2 grid min-w-0 max-w-full gap-2 overflow-hidden')}>
          {previewTargets.map(target => (
            <PreviewAttachment key={target} source="tool-result" target={target} />
          ))}
        </div>
      )}
      {open && (
        <div className={cn(TOOL_DETAIL_INDENT_CLASS, 'mt-0.5 min-w-0 max-w-full overflow-hidden')}>
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
    <pre className="mt-2 max-h-96 max-w-full min-w-0 overflow-auto rounded-lg border border-border/60 bg-background/70 px-3 py-2 font-mono text-[0.6875rem] leading-relaxed">
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
