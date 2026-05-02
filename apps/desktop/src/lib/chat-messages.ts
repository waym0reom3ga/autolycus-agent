import type { ThreadMessageLike } from '@assistant-ui/react'

import { mediaDisplayLabel, mediaMarkdownHref } from '@/lib/media'
import type { SessionMessage } from '@/types/hermes'

export type ChatMessagePart = Exclude<ThreadMessageLike['content'], string>[number]

export type ChatMessage = {
  id: string
  role: SessionMessage['role']
  parts: ChatMessagePart[]
  timestamp?: number
  pending?: boolean
  branchGroupId?: string
  hidden?: boolean
}

export type GatewayEventPayload = {
  text?: string
  rendered?: string
  status?: string
  message?: string
  name?: string
  tool_id?: string
  context?: string
  preview?: string
  summary?: string
  error?: string | boolean
  inline_diff?: string
  duration_s?: number
  todos?: unknown
  model?: string
  provider?: string
  running?: boolean
  cwd?: string
  branch?: string
  personality?: string
  // clarify.request
  request_id?: string
  question?: string
  choices?: string[] | null
}

export function textPart(text: string): ChatMessagePart {
  return { type: 'text', text }
}

export function reasoningPart(text: string): ChatMessagePart {
  return { type: 'reasoning', text }
}

const MEDIA_LINE_RE =
  /(^|\n)[\t ]*[`"']?MEDIA:\s*(?<line>`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)[`"']?[\t ]*(?:\n|$)/g

const MEDIA_TAG_RE = /[`"']?MEDIA:\s*(?<inline>`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)[`"']?/g

function unquoteMediaPath(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]

  return quote && quote === trimmed.at(-1) && ['"', "'", '`'].includes(quote) ? trimmed.slice(1, -1) : trimmed
}

function mediaLink(value: string): string {
  const path = unquoteMediaPath(value)

  return `[${mediaDisplayLabel(path)}](${mediaMarkdownHref(path)})`
}

export function renderMediaTags(text: string): string {
  return text
    .replace(MEDIA_LINE_RE, (_match, lead: string, value: string) => `${lead}${mediaLink(value)}\n`)
    .replace(MEDIA_TAG_RE, (_match, value: string) => mediaLink(value))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function assistantTextPart(text: string): ChatMessagePart {
  return textPart(renderMediaTags(text))
}

export function chatMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('')
}

const ATTACHED_CONTEXT_MARKER_RE = /(?:^|\n)--- Attached Context ---\s*\n/
const CONTEXT_WARNINGS_MARKER_RE = /(?:^|\n)--- Context Warnings ---[\s\S]*$/
const CONTEXT_REF_RE = /@(file|folder|url|image|tool):(?:"[^"\n]+"|'[^'\n]+'|`[^`\n]+`|\S+)/g

function textFromUnknown(value: unknown, depth = 0): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return ''
  }

  if (depth > 2) {
    return ''
  }

  if (Array.isArray(value)) {
    return value.map(item => textFromUnknown(item, depth + 1)).join('')
  }

  if (typeof value === 'object') {
    const row = value as Record<string, unknown>
    const textValue = row.text ?? row.output_text ?? row.content ?? row.message
    const nestedText = textFromUnknown(textValue, depth + 1)

    if (nestedText) {
      return nestedText
    }

    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }

  return String(value)
}

function displayContentForMessage(role: SessionMessage['role'], content: unknown): string {
  const textContent = textFromUnknown(content)

  if (role !== 'user') {
    return textContent
  }

  const marker = textContent.match(ATTACHED_CONTEXT_MARKER_RE)

  if (!marker || marker.index === undefined) {
    return textContent.replace(CONTEXT_WARNINGS_MARKER_RE, '').trim()
  }

  const visibleText = textContent.slice(0, marker.index).replace(CONTEXT_WARNINGS_MARKER_RE, '').trim()
  const attachedContext = textContent.slice(marker.index + marker[0].length)
  const refs = [...new Set(Array.from(attachedContext.matchAll(CONTEXT_REF_RE)).map(match => match[0]))]

  return [refs.join('\n'), visibleText].filter(Boolean).join('\n\n') || visibleText
}

export function appendTextPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  const next = [...parts]
  const last = next.at(-1)

  if (last?.type === 'text') {
    next[next.length - 1] = { ...last, text: `${last.text}${delta}` }

    return next
  }

  next.push(textPart(delta))

  return next
}

export function appendAssistantTextPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  const next = appendTextPart(parts, delta)
  const last = next.at(-1)

  if (last?.type === 'text') {
    next[next.length - 1] = { ...last, text: renderMediaTags(last.text) }
  }

  return next
}

export function appendReasoningPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  const next = [...parts]
  const last = next.at(-1)

  if (last?.type === 'reasoning') {
    next[next.length - 1] = { ...last, text: `${last.text}${delta}` }

    return next
  }

  next.push(reasoningPart(delta))

  return next
}

export function hasToolPart(message: ChatMessage): boolean {
  return message.parts.some(part => part.type === 'tool-call')
}

function toolId(payload: GatewayEventPayload | undefined): string {
  return payload?.tool_id || payload?.name || `tool-${Date.now()}`
}

function toolArgs(payload: GatewayEventPayload | undefined): Record<string, unknown> {
  return {
    ...(payload?.context ? { context: payload.context } : {}),
    ...(payload?.preview ? { preview: payload.preview } : {})
  }
}

function toolResult(payload: GatewayEventPayload | undefined): Record<string, unknown> {
  return {
    ...(payload?.inline_diff ? { inline_diff: payload.inline_diff } : {}),
    ...(payload?.summary ? { summary: payload.summary } : {}),
    ...(payload?.message ? { message: payload.message } : {}),
    ...(payload?.preview ? { preview: payload.preview } : {}),
    ...(payload?.duration_s !== undefined ? { duration_s: payload.duration_s } : {}),
    ...(payload?.todos ? { todos: payload.todos } : {}),
    ...(payload?.error ? { error: payload.error } : {})
  }
}

export function upsertToolPart(
  parts: ChatMessagePart[],
  payload: GatewayEventPayload | undefined,
  phase: 'running' | 'complete'
): ChatMessagePart[] {
  const id = toolId(payload)
  const name = payload?.name || 'tool'
  const next = [...parts]

  const index = next.findIndex(
    part => part.type === 'tool-call' && ((part.toolCallId && part.toolCallId === id) || part.toolName === name)
  )

  const base = {
    type: 'tool-call' as const,
    toolCallId: id,
    toolName: name,
    args: toolArgs(payload) as never,
    argsText: JSON.stringify(toolArgs(payload)),
    ...(phase === 'complete'
      ? {
          result: toolResult(payload),
          isError: Boolean(payload?.error)
        }
      : {})
  } satisfies ChatMessagePart

  if (index === -1) {
    return [...next, base]
  }

  next[index] = { ...next[index], ...base }

  return next
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> {
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

function firstNonEmptyObject(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const parsed = parseMaybeJsonObject(value)

    if (Object.keys(parsed).length > 0) {
      return parsed
    }
  }

  return {}
}

function parseStoredToolResult(content: unknown): unknown {
  if (content && typeof content === 'object') {
    return content
  }

  const textContent = textFromUnknown(content)

  if (!textContent.trim()) {
    return ''
  }

  try {
    return JSON.parse(textContent)
  } catch {
    return textContent
  }
}

function toolPartFromStoredCall(call: unknown, fallbackIndex: number): ChatMessagePart {
  const row = recordFromUnknown(call) ?? {}
  const fn = recordFromUnknown(row.function)
  const id = String(row.id || row.tool_call_id || `stored-tool-${fallbackIndex}`)

  const toolName = String(
    row.name || row.tool_name || fn?.name || (recordFromUnknown(row.input)?.name as string | undefined) || 'tool'
  )

  const args = firstNonEmptyObject(fn?.arguments, row.arguments, row.args, row.input)

  return {
    type: 'tool-call',
    toolCallId: id,
    toolName,
    args: args as never,
    argsText: Object.keys(args).length ? JSON.stringify(args) : ''
  }
}

function applyStoredToolResult(messages: ChatMessage[], toolMessage: SessionMessage): boolean {
  const toolCallId = toolMessage.tool_call_id || undefined
  const toolName = toolMessage.tool_name || toolMessage.name || 'tool'
  const content = toolMessage.content || toolMessage.text || toolMessage.context || toolMessage.name

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]

    if (message.role !== 'assistant') {
      continue
    }

    const partIndex = message.parts.findIndex(
      part =>
        part.type === 'tool-call' &&
        ((toolCallId && part.toolCallId === toolCallId) || (!toolCallId && part.toolName === toolName))
    )

    if (partIndex < 0) {
      continue
    }

    const parts = [...message.parts]
    const existing = parts[partIndex]
    parts[partIndex] = {
      ...existing,
      result: parseStoredToolResult(content),
      isError: false
    } as ChatMessagePart
    messages[i] = { ...message, parts }

    return true
  }

  return false
}

function applyStoredToolResultToParts(parts: ChatMessagePart[], toolMessage: SessionMessage): ChatMessagePart[] | null {
  const toolCallId = toolMessage.tool_call_id || undefined
  const toolName = toolMessage.tool_name || toolMessage.name || 'tool'
  const content = toolMessage.content || toolMessage.text || toolMessage.context || toolMessage.name

  const partIndex = parts.findIndex(
    part =>
      part.type === 'tool-call' &&
      ((toolCallId && part.toolCallId === toolCallId) || (!toolCallId && part.toolName === toolName))
  )

  if (partIndex < 0) {
    return null
  }

  const next = [...parts]
  const existing = next[partIndex]
  next[partIndex] = {
    ...existing,
    result: parseStoredToolResult(content),
    isError: false
  } as ChatMessagePart

  return next
}

function storedToolMessagePart(toolMessage: SessionMessage, fallbackIndex: number): ChatMessagePart {
  const name = toolMessage.tool_name || toolMessage.name || 'tool'
  const context = textFromUnknown(toolMessage.context || toolMessage.text || toolMessage.content || '')
  const args = context ? { context } : {}

  return {
    type: 'tool-call',
    toolCallId: toolMessage.tool_call_id || `stored-tool-message-${fallbackIndex}`,
    toolName: name,
    args: args as never,
    argsText: Object.keys(args).length ? JSON.stringify(args) : '',
    result: context ? { context } : {},
    isError: false
  }
}

function withUniqueToolCallIds(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>()

  return messages.map(message => {
    let changed = false

    const parts = message.parts.map((part, index) => {
      if (part.type !== 'tool-call') {
        return part
      }

      const id = part.toolCallId || `${message.id}-tool-${index}`

      if (!seen.has(id)) {
        seen.add(id)

        if (part.toolCallId) {
          return part
        }

        changed = true

        return { ...part, toolCallId: id } as ChatMessagePart
      }

      changed = true
      const uniqueId = `${id}-${message.id}-${index}`
      seen.add(uniqueId)

      return { ...part, toolCallId: uniqueId } as ChatMessagePart
    })

    return changed ? { ...message, parts } : message
  })
}

export function toChatMessages(messages: SessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  let pendingToolParts: ChatMessagePart[] = []
  let pendingToolTimestamp: number | undefined

  const flushPendingTools = (index: number) => {
    if (!pendingToolParts.length) {
      return
    }

    result.push({
      id: `${pendingToolTimestamp || Date.now()}-${index}-tools`,
      role: 'assistant',
      parts: pendingToolParts,
      timestamp: pendingToolTimestamp
    })
    pendingToolParts = []
    pendingToolTimestamp = undefined
  }

  messages.forEach((message, index) => {
    if (message.role === 'tool') {
      const updatedPendingToolParts = applyStoredToolResultToParts(pendingToolParts, message)

      if (updatedPendingToolParts) {
        pendingToolParts = updatedPendingToolParts

        return
      }

      if (applyStoredToolResult(result, message)) {
        return
      }

      pendingToolParts = [...pendingToolParts, storedToolMessagePart(message, index)]
      pendingToolTimestamp ??= message.timestamp

      return
    }

    const content = message.content || message.text || message.context || message.name
    const displayContent = displayContentForMessage(message.role, content)
    const parts: ChatMessagePart[] = []

    const reasoning =
      message.reasoning ||
      message.reasoning_content ||
      (typeof message.reasoning_details === 'string' ? message.reasoning_details : '')

    if (reasoning && message.role === 'assistant') {
      parts.push(reasoningPart(reasoning))
    }

    if (displayContent) {
      parts.push(message.role === 'assistant' ? assistantTextPart(displayContent) : textPart(displayContent))
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      parts.push(...message.tool_calls.map((call, callIndex) => toolPartFromStoredCall(call, callIndex)))
    }

    if (!parts.length) {
      return
    }

    const isToolOnlyAssistant =
      message.role === 'assistant' && parts.length > 0 && parts.every(part => part.type === 'tool-call')

    if (isToolOnlyAssistant) {
      pendingToolParts = [...pendingToolParts, ...parts]
      pendingToolTimestamp ??= message.timestamp

      return
    }

    if (message.role === 'assistant' && pendingToolParts.length) {
      const last = result.at(-1)

      if (last?.role === 'assistant') {
        last.parts = [...last.parts, ...pendingToolParts, ...parts]
        last.timestamp = message.timestamp ?? last.timestamp
        pendingToolParts = []
        pendingToolTimestamp = undefined

        return
      }

      parts.unshift(...pendingToolParts)
      pendingToolParts = []
      pendingToolTimestamp = undefined
    } else if (message.role !== 'assistant') {
      flushPendingTools(index)
    }

    result.push({
      id: `${message.timestamp || Date.now()}-${index}-${message.role}`,
      role: message.role,
      parts,
      timestamp: message.timestamp
    })
  })
  flushPendingTools(messages.length)

  return withUniqueToolCallIds(
    result.filter(m => chatMessageText(m).trim() || m.parts.some(part => part.type !== 'text'))
  )
}

export function branchGroupForUser(userMessage: ChatMessage): string {
  return `branch:${userMessage.id}`
}
