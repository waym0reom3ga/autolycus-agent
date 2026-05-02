'use client'

import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment, Unstable_TriggerItem } from '@assistant-ui/core'
import type { TextMessagePartComponent, TextMessagePartProps } from '@assistant-ui/react'
import { AtSign, FileText, FolderOpen, ImageIcon, Link as LinkIcon, Wrench } from 'lucide-react'
import type { ComponentType, FC } from 'react'
import { Fragment, useMemo } from 'react'

import { cn } from '@/lib/utils'

const HERMES_REF_TYPES = ['file', 'folder', 'url', 'image', 'tool'] as const
type HermesRefType = (typeof HERMES_REF_TYPES)[number]

const ICONS: Record<HermesRefType, ComponentType<{ className?: string }>> = {
  file: FileText,
  folder: FolderOpen,
  url: LinkIcon,
  image: ImageIcon,
  tool: Wrench
}

/**
 * Parses our composer's `@type:value` references into directive segments
 * so they render as inline chips in user messages instead of raw text.
 *
 * Supported types: file, folder, url, image. Anything else stays plain text.
 *
 * Mirrors the Python `agent/context_references.REFERENCE_PATTERN` syntax:
 * the value may be wrapped in backticks, single quotes, or double quotes so
 * paths with spaces/parens/etc. survive parsing intact.
 */
const CANONICAL_DIRECTIVE_RE = /:([\w-]{1,64})\[([^\]\n]{1,1024})\](?:\{name=([^}\n]{1,1024})\})?/g

const HERMES_DIRECTIVE_RE = new RegExp(
  '@(file|folder|url|image|tool):(' +
    '`[^`\\n]+`' +
    '|"[^"\\n]+"' +
    "|'[^'\\n]+'" +
    '|\\S+' +
    ')',
  'g'
)

const TRAILING_PUNCTUATION_RE = /[,.;!?]+$/

function unwrapRefValue(raw: string): string {
  if (raw.length < 2) {
    return raw
  }

  const head = raw[0]
  const tail = raw[raw.length - 1]

  if ((head === '`' && tail === '`') || (head === '"' && tail === '"') || (head === "'" && tail === "'")) {
    return raw.slice(1, -1)
  }

  return raw.replace(TRAILING_PUNCTUATION_RE, '')
}

function needsQuoting(value: string): boolean {
  return /[\s()\[\]{}<>"'`]/.test(value)
}

export function formatRefValue(value: string): string {
  if (!needsQuoting(value)) {
    return value
  }

  if (!value.includes('`')) {
    return `\`${value}\``
  }

  if (!value.includes('"')) {
    return `"${value}"`
  }

  if (!value.includes("'")) {
    return `'${value}'`
  }

  return value
}

export const hermesDirectiveFormatter: Unstable_DirectiveFormatter = {
  serialize(item: Unstable_TriggerItem): string {
    if (item.id === `${item.type}:`) {
      return `@${item.id}`
    }

    return `@${item.type}:${formatRefValue(item.id)}`
  },
  parse(text: string): readonly Unstable_DirectiveSegment[] {
    return parseDirectiveText(text)
  }
}

function parseDirectiveText(text: string): Unstable_DirectiveSegment[] {
  const matches = [
    ...Array.from(text.matchAll(CANONICAL_DIRECTIVE_RE)).map(match => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      type: match[1] || 'tool',
      label: match[2] || match[3] || '',
      id: match[3] || match[2] || ''
    })),
    ...Array.from(text.matchAll(HERMES_DIRECTIVE_RE)).map(match => {
      const id = unwrapRefValue(match[2] || '')

      return {
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        type: match[1] || 'file',
        label: shortLabel(match[1] as HermesRefType, id),
        id
      }
    })
  ]
    .filter(match => match.id)
    .sort((a, b) => a.start - b.start)

  const segments: Unstable_DirectiveSegment[] = []
  let cursor = 0

  for (const match of matches) {
    if (match.start < cursor) {
      continue
    }

    if (match.start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, match.start) })
    }

    segments.push({
      kind: 'mention',
      type: match.type,
      label: match.label,
      id: match.id
    })
    cursor = match.end
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) })
  }

  return segments
}

function shortLabel(type: HermesRefType, id: string): string {
  if (type === 'url') {
    try {
      const parsed = new URL(id)

      return parsed.hostname || id
    } catch {
      return id
    }
  }

  const tail = id.split(/[\\/]/).filter(Boolean).pop()

  return tail || id
}

/**
 * Renders a text message part with our directive segments as inline chips.
 * Unknown directive types fall through as plain text.
 */
export const DirectiveText: TextMessagePartComponent = ({ text }: TextMessagePartProps) => {
  const segments = useMemo(() => hermesDirectiveFormatter.parse(text ?? ''), [text])

  return (
    <span className="whitespace-pre-line" data-slot="aui_directive-text">
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <Fragment key={`t-${index}`}>{segment.text}</Fragment>
        ) : (
          <DirectiveChip id={segment.id} key={`m-${index}-${segment.id}`} label={segment.label} type={segment.type} />
        )
      )}
    </span>
  )
}

const DirectiveChip: FC<{
  type: string
  label: string
  id: string
}> = ({ type, label, id }) => {
  const Icon = ICONS[type as HermesRefType] ?? AtSign

  return (
    <span
      className={cn(
        'mx-0.5 inline-flex max-w-64 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--dt-primary)_16%,transparent)] px-2 py-0.5 align-[0.02em] text-[0.92em] font-semibold leading-tight text-primary ring-1 ring-inset ring-primary/10'
      )}
      data-directive-id={id}
      data-directive-type={type}
      data-slot="aui_directive-chip"
      title={id}
    >
      {Icon && <Icon className="size-3.5 shrink-0 text-primary" />}
      <span className="truncate">{label}</span>
    </span>
  )
}
