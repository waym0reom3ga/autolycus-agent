'use client'

import { useAuiState } from '@assistant-ui/react'
import {
  type StreamdownTextComponents,
  StreamdownTextPrimitive,
  type SyntaxHighlighterProps
} from '@assistant-ui/react-streamdown'
import { code } from '@streamdown/code'
import { type ComponentProps, memo, useEffect, useMemo, useState } from 'react'

import { PreviewAttachment } from '@/components/assistant-ui/preview-attachment'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { ZoomableImage } from '@/components/assistant-ui/zoomable-image'
import { CopyButton } from '@/components/ui/copy-button'
import { isLikelyProseCodeBlock, sanitizeLanguageTag } from '@/lib/markdown-code'
import { preprocessMarkdown } from '@/lib/markdown-preprocess'
import {
  filePathFromMediaPath,
  mediaExternalUrl,
  mediaKind,
  mediaMime,
  mediaName,
  mediaPathFromMarkdownHref
} from '@/lib/media'
import { previewTargetFromMarkdownHref } from '@/lib/preview-targets'
import { cn } from '@/lib/utils'

const MARKDOWN_CONTAINER_CLASS = cn(
  'aui-md prose w-full max-w-none overflow-hidden text-base leading-(--dt-line-height) text-foreground',
  'prose-p:leading-(--dt-line-height) prose-li:leading-(--dt-line-height)',
  'prose-headings:text-foreground prose-strong:text-foreground',
  'prose-a:break-words prose-p:[overflow-wrap:anywhere]',
  'prose-li:marker:text-midground/55',
  'prose-code:rounded prose-code:border-0 prose-code:bg-muted/80 prose-code:px-0.5 prose-code:py-px prose-code:font-mono prose-code:text-[0.86em] prose-code:text-muted-foreground prose-code:before:content-none prose-code:after:content-none'
)

function CodeHeader({ language, code }: { language?: string; code?: string }) {
  const normalizedCode = (code ?? '').replace(/^\n+/, '').trimEnd()

  if (!normalizedCode.trim() || isLikelyProseCodeBlock(language, normalizedCode)) {
    return null
  }

  const cleanLanguage = sanitizeLanguageTag(language || '')
  const label = cleanLanguage && cleanLanguage !== 'unknown' ? cleanLanguage : ''

  return (
    <div className="m-0 flex items-stretch justify-between gap-2 rounded-t-md border border-b-0 border-border bg-muted/60 pr-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-2.5 py-1.5 pl-0 font-mono uppercase tracking-[0.16em]">
        <span aria-hidden="true" className="self-stretch w-[2px] -my-1.5 bg-midground/60" />
        <span className="text-midground/85">{label || 'code'}</span>
      </span>
      <CopyButton appearance="inline" iconClassName="size-3" label="Copy code" text={normalizedCode}>
        Copy
      </CopyButton>
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
    return <PreviewAttachment source="explicit-link" target={previewTarget} />
  }

  return (
    <a
      className={cn(
        'font-medium text-foreground underline underline-offset-4 decoration-midground/55 wrap-anywhere hover:decoration-midground',
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
      className={cn(
        'block h-auto w-auto max-h-(--image-preview-height) max-w-[min(100%,var(--image-preview-max-width))] rounded-[1.125rem] border border-[color-mix(in_srgb,var(--dt-border)_70%,transparent)] object-contain shadow-[0_0.0625rem_0.125rem_color-mix(in_srgb,#000_4%,transparent),0_0.625rem_1.5rem_color-mix(in_srgb,#000_5%,transparent)]',
        className
      )}
      containerClassName="my-3 max-w-[min(100%,var(--image-preview-max-width))]"
      slot="aui_markdown-image"
      src={src}
      {...props}
    />
  )
}

const MarkdownTextImpl = () => {
  const isStreaming = useAuiState(s => s.message.status?.type === 'running')

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
          <p className={cn('wrap-anywhere leading-(--dt-line-height)', className)} {...props} />
        ),
        a: MarkdownLink,
        hr: ({ className, ...props }: ComponentProps<'hr'>) => (
          <hr className={cn('border-border/70', className)} {...props} />
        ),
        blockquote: ({ className, ...props }: ComponentProps<'blockquote'>) => (
          <blockquote
            className={cn('border-l-2 border-midground/40 pl-3 text-muted-foreground italic', className)}
            {...props}
          />
        ),
        ul: ({ className, ...props }: ComponentProps<'ul'>) => <ul className={cn(className)} {...props} />,
        ol: ({ className, ...props }: ComponentProps<'ol'>) => <ol className={cn(className)} {...props} />,
        li: ({ className, ...props }: ComponentProps<'li'>) => (
          <li className={cn('leading-(--dt-line-height)', className)} {...props} />
        ),
        table: ({ className, ...props }: ComponentProps<'table'>) => (
          <div className="max-w-full overflow-x-auto rounded-md border border-border">
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
              'h-9 px-3 text-left align-middle text-xs font-semibold uppercase tracking-[0.16em] text-midground/75',
              className
            )}
            {...props}
          />
        ),
        td: ({ className, ...props }: ComponentProps<'td'>) => (
          <td className={cn('px-3 py-2 align-top text-sm leading-snug', className)} {...props} />
        ),
        img: MarkdownImage,
        SyntaxHighlighter: (props: SyntaxHighlighterProps) => <SyntaxHighlighter {...props} defer={isStreaming} />,
        CodeHeader
      }) as StreamdownTextComponents,
    [isStreaming]
  )

  return (
    <StreamdownTextPrimitive
      caret="block"
      components={components}
      containerClassName={MARKDOWN_CONTAINER_CLASS}
      lineNumbers={false}
      mode="streaming"
      parseIncompleteMarkdown={!isStreaming}
      plugins={isStreaming ? undefined : { code }}
      preprocess={preprocessMarkdown}
      shikiTheme={['github-light-default', 'github-dark-default']}
    />
  )
}

export const MarkdownText = memo(MarkdownTextImpl)
