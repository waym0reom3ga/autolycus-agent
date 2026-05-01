'use client'

import { type ToolCallMessagePartProps } from '@assistant-ui/react'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useElapsedSeconds } from '@/components/assistant-ui/activity-timer'
import { ActivityTimerText } from '@/components/assistant-ui/activity-timer-text'
import { cn } from '@/lib/utils'

const TOOL_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const TOOL_SPINNER_INTERVAL_MS = 80

function titleForTool(name: string): string {
  return (
    name
      .split('_')
      .filter(Boolean)
      .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join(' ') || name
  )
}

function toolLabel(name: string, isPending: boolean): string {
  const labels: Record<string, { done: string; pending: string }> = {
    edit_file: { done: 'Edited file', pending: 'Editing file' },
    execute_code: { done: 'Ran code', pending: 'Running code' },
    image_generate: { done: 'Generated image', pending: 'Generating image' },
    list_files: { done: 'Listed files', pending: 'Listing files' },
    read_file: { done: 'Read file', pending: 'Reading file' },
    search_files: { done: 'Searched files', pending: 'Searching files' },
    session_search_recall: { done: 'Searched session history', pending: 'Searching session history' },
    terminal: { done: 'Ran command', pending: 'Running command' },
    todo: { done: 'Updated todos', pending: 'Updating todos' },
    web_extract: { done: 'Read webpage', pending: 'Reading webpage' },
    web_search: { done: 'Searched the web', pending: 'Searching the web' },
    write_file: { done: 'Edited file', pending: 'Editing file' }
  }

  if (labels[name]) {
    return isPending ? labels[name].pending : labels[name].done
  }

  return `${isPending ? 'Using' : 'Used'} ${titleForTool(name)}`
}

function compactPreview(value: unknown, max = 72): string {
  const text =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'context' in value
        ? String((value as { context?: unknown }).context ?? '')
        : ''

  const oneLine = text.replace(/\s+/g, ' ').trim()

  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

function shouldShowInlinePreview(toolName: string): boolean {
  return !['image_generate', 'terminal', 'execute_code'].includes(toolName)
}

function contextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object' && 'context' in value) {
    return String((value as { context?: unknown }).context ?? '')
  }

  return ''
}

function prettyJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function detailLabel(toolName: string): string {
  if (toolName === 'image_generate') {
    return 'Prompt'
  }

  if (toolName === 'web_search') {
    return 'Query'
  }

  if (toolName === 'web_extract') {
    return 'URL'
  }

  if (toolName === 'terminal') {
    return 'Command'
  }

  if (toolName === 'execute_code') {
    return 'Code'
  }

  return 'Input'
}

function detailText(args: unknown, result: unknown): string {
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

export const ToolFallback = ({ toolName, args, result }: ToolCallMessagePartProps) => {
  const [open, setOpen] = useState(false)
  const isPending = result === undefined
  const [tick, setTick] = useState(0)
  const elapsed = useElapsedSeconds(isPending)
  const preview = compactPreview(args) || compactPreview(result)
  const label = toolLabel(toolName, isPending)
  const detail = detailText(args, result)
  const spinnerFrame = TOOL_SPINNER_FRAMES[tick % TOOL_SPINNER_FRAMES.length]

  useEffect(() => {
    if (!isPending) {
      return
    }

    const id = window.setInterval(() => setTick(value => value + 1), TOOL_SPINNER_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [isPending])

  return (
    <div className="mb-3 mt-1 text-sm text-muted-foreground">
      <button
        className="inline-grid max-w-full grid-cols-[0.75rem_minmax(0,auto)_minmax(0,1fr)_auto_auto] items-center gap-1 rounded-md py-0.5 pr-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <ChevronRight
          className={cn('shrink-0 text-muted-foreground/80 transition-transform', open && 'rotate-90')}
          size={12}
        />
        <span
          className={cn('shrink-0 text-xs font-medium text-foreground/70', isPending && 'shimmer text-foreground/55')}
        >
          {label}
        </span>
        {preview && shouldShowInlinePreview(toolName) && (
          <span className="min-w-0 truncate text-xs text-muted-foreground/80">{preview}</span>
        )}
        {isPending ? (
          <span aria-label="Running" className="ml-1 w-3 shrink-0 text-center text-xs text-muted-foreground/80">
            {spinnerFrame}
          </span>
        ) : null}
        {isPending && <ActivityTimerText seconds={elapsed} />}
      </button>
      {open && (
        <div className="ml-4 mt-1 max-w-full whitespace-pre-wrap wrap-anywhere border-l border-border pl-3 text-xs leading-relaxed text-muted-foreground/85">
          <span className="mr-1 font-medium text-muted-foreground/70">{detailLabel(toolName)}:</span>
          {detail}
        </div>
      )}
    </div>
  )
}

