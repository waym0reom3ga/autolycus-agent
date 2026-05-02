'use client'

import { type StreamdownTextComponents, StreamdownTextPrimitive } from '@assistant-ui/react-streamdown'
import { code } from '@streamdown/code'
import { Check, Copy } from 'lucide-react'
import { type ComponentProps, memo, useEffect, useMemo, useState } from 'react'

import { PreviewAttachment } from '@/components/assistant-ui/preview-attachment'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { ZoomableImage } from '@/components/assistant-ui/zoomable-image'
import { triggerHaptic } from '@/lib/haptics'
import {
  filePathFromMediaPath,
  mediaExternalUrl,
  mediaKind,
  mediaMime,
  mediaName,
  mediaPathFromMarkdownHref
} from '@/lib/media'
import { isLikelyProseCodeBlock, isLikelyProseFence, sanitizeLanguageTag } from '@/lib/markdown-code'
import { previewTargetFromMarkdownHref, stripPreviewTargets } from '@/lib/preview-targets'
import { cn } from '@/lib/utils'

/**
 * Strip provider/model "thinking" blocks before markdown render.
 *
 * Some Hermes providers stream raw `<think>…</think>` and similar into
 * assistant text. Proper reasoning UI uses dedicated `reasoning.*` parts.
 */
const REASONING_BLOCK_RE = /<(think|thinking|reasoning|scratchpad|analysis)>[\s\S]*?<\/\1>\s*/gi
const PREVIEW_MARKER_RE = /\[Preview:[^\]]+\]\(#preview[:/][^)]+\)/gi

const FENCE_LINE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/
const MIDLINE_FENCE_RE = /([^\n])(`{3,}|~{3,})(?=\s|$)/g
const EMPTY_FENCE_BLOCK_RE = /(^|\n)[ \t]*(?:`{3,}|~{3,})[^\n]*\n[ \t]*(?:`{3,}|~{3,})[ \t]*(?=\n|$)/g

function stripMidlineFenceStarts(text: string): string {
  // Providers often stream inline fence noise like `200.``` http://...`.
  // A real fenced block must start at the beginning of a line; anything
  // mid-line should be treated as literal/prose and never allowed to create
  // an empty Streamdown code-card shell.
  return text.replace(MIDLINE_FENCE_RE, '$1')
}

function stripEmptyFenceBlocks(text: string): string {
  // Remove already-balanced but empty fences before Streamdown sees them.
  // Returning null from our CodeHeader/SyntaxHighlighter is not enough: the
  // code plugin still renders its outer code-block wrapper, producing the
  // blank bordered element seen during streaming.
  return text.replace(EMPTY_FENCE_BLOCK_RE, '$1')
}

function pushProseFence(out: string[], indent: string, info: string, lines: string[]) {
  if (info) {
    out.push(`${indent}${info}`.trimEnd())
  }

  out.push(...lines)
}

function findClosingFence(lines: string[], start: number, marker: string): number {
  for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
    const closeMatch = (lines[cursor] || '').match(FENCE_LINE_RE)

    if (!closeMatch) {
      continue
    }

    const closeMarker = closeMatch[2] || ''
    const closeInfo = (closeMatch[3] || '').trim()

    if (!closeInfo && closeMarker[0] === marker[0] && closeMarker.length >= marker.length) {
      return cursor
    }
  }

  return -1
}

function normalizeFenceBlocks(text: string): string {
  const sourceLines = text.split('\n')
  const out: string[] = []
  let index = 0

  while (index < sourceLines.length) {
    const line = sourceLines[index] || ''
    const match = line.match(FENCE_LINE_RE)

    if (!match) {
      out.push(line)
      index += 1
      continue
    }

    const indent = match[1] || ''
    const marker = match[2] || '```'
    const infoRaw = (match[3] || '').trim()
    const languageToken = infoRaw.split(/\s+/, 1)[0] || ''
    const language = sanitizeLanguageTag(languageToken)
    const openerValid = !infoRaw || Boolean(language)

    if (!openerValid) {
      out.push(`${indent}${infoRaw}`.trimEnd())
      index += 1
      continue
    }

    const closeIndex = findClosingFence(sourceLines, index, marker)
    const bodyLines = sourceLines.slice(index + 1, closeIndex === -1 ? sourceLines.length : closeIndex)
    const body = bodyLines.join('\n')

    if (closeIndex !== -1 && !body.trim()) {
      // Empty fenced block: drop both delimiters. This prevents Streamdown's
      // code plugin from rendering an empty shell/card.
      index = closeIndex + 1
      continue
    }

    if (closeIndex === -1) {
      if (!body.trim()) {
        index += 1
        continue
      }

      if (isLikelyProseFence(infoRaw, body)) {
        pushProseFence(out, indent, infoRaw, bodyLines)
      } else {
        out.push(`${indent}${marker}${language}`)
        out.push(...bodyLines)
      }

      break
    }

    if (isLikelyProseFence(infoRaw, body)) {
      pushProseFence(out, indent, infoRaw, bodyLines)
      index = closeIndex + 1
      continue
    }

    out.push(`${indent}${marker}${language}`)
    out.push(...bodyLines)
    out.push(`${indent}${marker}`)
    index = closeIndex + 1
  }

  return out.join('\n')
}

export function preprocessMarkdown(text: string): string {
  const cleaned = text.replace(REASONING_BLOCK_RE, '').replace(PREVIEW_MARKER_RE, '')
  const normalizedFences = normalizeFenceBlocks(stripMidlineFenceStarts(cleaned))
  const strippedEmptyFences = stripEmptyFenceBlocks(normalizedFences)

  return strippedEmptyFences
    .split(/((?:```|~~~)[\s\S]*?(?:```|~~~))/g)
    .map(part => (/^(?:```|~~~)/.test(part) ? part : stripPreviewTargets(part)))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
}

function CodeHeader({ language, code }: { language?: string; code?: string }) {
  const [copied, setCopied] = useState(false)
  const normalizedCode = (code ?? '').replace(/^\n+/, '').trimEnd()

  // Streamdown can transiently parse stray backticks / incomplete fences as
  // an empty code block while text is streaming, e.g. "200.``` http://...".
  // Rendering our header + empty body for that looks like a giant blank
  // code card. Hide the whole block until there's actual code content.
  if (!normalizedCode.trim() || isLikelyProseCodeBlock(language, normalizedCode)) {
    return null
  }

  async function handleCopy() {
    if (!normalizedCode) {
      return
    }

    try {
      if (window.hermesDesktop?.writeClipboard) {
        await window.hermesDesktop.writeClipboard(normalizedCode)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalizedCode)
      }

      triggerHaptic('selection')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Best-effort copy; silent failure is OK for a chat surface.
    }
  }

  const cleanLanguage = sanitizeLanguageTag(language || '')
  const label = cleanLanguage && cleanLanguage !== 'unknown' ? cleanLanguage : ''

  return (
    <div className="m-0 flex items-center justify-between gap-2 rounded-t-md border border-b-0 border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-mono uppercase tracking-wide">{label || 'code'}</span>
      <button
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[0.75rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={handleCopy}
        type="button"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

async function typedBlobUrl(dataUrl: string, mime: string): Promise<string> {
  const blob = await fetch(dataUrl).then(response => response.blob())

  return URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: mime }))
}

async function mediaSrc(path: string): Promise<string> {
  if (/^(?:https?|data):/i.test(path)) {
    return path
  }

  if (!window.hermesDesktop?.readFileDataUrl) {
    return mediaExternalUrl(path)
  }

  const dataUrl = await window.hermesDesktop.readFileDataUrl(filePathFromMediaPath(path))

  return ['audio', 'video'].includes(mediaKind(path)) ? typedBlobUrl(dataUrl, mediaMime(path)) : dataUrl
}

function OpenMediaButton({ kind, path }: { kind: 'audio' | 'video'; path: string }) {
  return (
    <button
      className="mt-2 bg-transparent text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
      onClick={() => void window.hermesDesktop?.openExternal(mediaExternalUrl(path))}
      type="button"
    >
      Open {kind} file
    </button>
  )
}

function MediaAttachment({ path }: { path: string }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const kind = mediaKind(path)
  const name = mediaName(path)

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''

    setFailed(false)
    setSrc('')
    void mediaSrc(path)
      .then(value => {
        if (value.startsWith('blob:')) {
          objectUrl = value
        }

        if (!cancelled) {
          setSrc(value)
        } else if (objectUrl) {
          URL.revokeObjectURL(objectUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [path])

  if (kind === 'image' && src) {
    return (
      <span className="block">
        <MarkdownImage alt={name} src={src} />
      </span>
    )
  }

  if (kind === 'audio' && src) {
    return (
      <span className="my-3 block max-w-md rounded-xl border border-border/70 bg-card/70 p-3">
        <span className="mb-2 block truncate text-xs font-medium text-muted-foreground">{name}</span>
        <audio className="block w-full" controls onError={() => setFailed(true)} preload="metadata" src={src} />
        {failed && <OpenMediaButton kind="audio" path={path} />}
      </span>
    )
  }

  if (kind === 'video' && src) {
    return (
      <span className="my-3 block max-w-2xl rounded-xl border border-border/70 bg-card/70 p-3">
        <span className="mb-2 block truncate text-xs font-medium text-muted-foreground">{name}</span>
        <video
          className="block max-h-112 w-full rounded-lg bg-black"
          controls
          onError={() => setFailed(true)}
          src={src}
        />
        {failed && <OpenMediaButton kind="video" path={path} />}
      </span>
    )
  }

  return (
    <a
      className="font-medium text-foreground underline underline-offset-4 decoration-foreground/30 wrap-anywhere hover:decoration-foreground/70"
      href="#"
      onClick={event => {
        event.preventDefault()
        void window.hermesDesktop?.openExternal(mediaExternalUrl(path))
      }}
    >
      {failed ? `Open ${name}` : `Loading ${name}...`}
    </a>
  )
}

function MarkdownLink({ className, href, ...props }: ComponentProps<'a'>) {
  const mediaPath = mediaPathFromMarkdownHref(href)
  const previewTarget = previewTargetFromMarkdownHref(href)

  if (mediaPath) {
    return <MediaAttachment path={mediaPath} />
  }

  if (previewTarget) {
    return <PreviewAttachment target={previewTarget} />
  }

  return (
    <a
      className={cn(
        'font-medium text-foreground underline underline-offset-4 decoration-foreground/30 wrap-anywhere hover:decoration-foreground/70',
        className
      )}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      {...props}
    />
  )
}

function MarkdownImage({ className, src, alt, ...props }: ComponentProps<'img'>) {
  return (
    <ZoomableImage
      alt={alt}
      className={className}
      containerClassName="my-3"
      slot="aui_markdown-image"
      src={src}
      {...props}
    />
  )
}

const MarkdownTextImpl = () => {
  const components = useMemo(
    () =>
      ({
        h1: ({ className, ...props }: ComponentProps<'h1'>) => (
          <h1 className={cn('text-xl font-semibold tracking-tight', className)} {...props} />
        ),
        h2: ({ className, ...props }: ComponentProps<'h2'>) => (
          <h2 className={cn('text-lg font-semibold tracking-tight', className)} {...props} />
        ),
        h3: ({ className, ...props }: ComponentProps<'h3'>) => (
          <h3 className={cn('text-base font-semibold', className)} {...props} />
        ),
        h4: ({ className, ...props }: ComponentProps<'h4'>) => (
          <h4 className={cn('text-sm font-semibold', className)} {...props} />
        ),
        p: ({ className, ...props }: ComponentProps<'p'>) => (
          <p className={cn('wrap-anywhere leading-relaxed', className)} {...props} />
        ),
        a: MarkdownLink,
        hr: ({ className, ...props }: ComponentProps<'hr'>) => (
          <hr className={cn('border-border/70', className)} {...props} />
        ),
        blockquote: ({ className, ...props }: ComponentProps<'blockquote'>) => (
          <blockquote
            className={cn('border-l-2 border-border pl-3 text-muted-foreground italic', className)}
            {...props}
          />
        ),
        ul: ({ className, ...props }: ComponentProps<'ul'>) => (
          <ul className={cn('list-disc marker:text-muted-foreground/70', className)} {...props} />
        ),
        ol: ({ className, ...props }: ComponentProps<'ol'>) => (
          <ol className={cn('list-decimal marker:text-muted-foreground/70', className)} {...props} />
        ),
        li: ({ className, ...props }: ComponentProps<'li'>) => (
          <li className={cn('leading-relaxed', className)} {...props} />
        ),
        table: ({ className, ...props }: ComponentProps<'table'>) => (
          <div className="w-full overflow-x-auto rounded-md border border-border">
            <table
              className={cn(
                'w-full border-collapse text-sm [&_tr]:border-b [&_tr]:border-border last:[&_tr]:border-0',
                className
              )}
              {...props}
            />
          </div>
        ),
        thead: ({ className, ...props }: ComponentProps<'thead'>) => (
          <thead className={cn('bg-muted/50 text-foreground', className)} {...props} />
        ),
        th: ({ className, ...props }: ComponentProps<'th'>) => (
          <th
            className={cn(
              'h-9 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground',
              className
            )}
            {...props}
          />
        ),
        td: ({ className, ...props }: ComponentProps<'td'>) => (
          <td className={cn('px-3 py-2 align-top text-sm leading-snug', className)} {...props} />
        ),
        img: MarkdownImage,
        SyntaxHighlighter,
        CodeHeader
      }) as StreamdownTextComponents,
    []
  )

  return (
    <StreamdownTextPrimitive
      caret="block"
      components={components}
      containerClassName="aui-md text-foreground"
      lineNumbers={false}
      mode="streaming"
      parseIncompleteMarkdown
      plugins={{ code }}
      preprocess={preprocessMarkdown}
      shikiTheme={['github-light-default', 'github-dark-default']}
    />
  )
}

export const MarkdownText = memo(MarkdownTextImpl)
