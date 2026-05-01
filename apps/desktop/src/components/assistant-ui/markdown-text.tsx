'use client'

import { type StreamdownTextComponents, StreamdownTextPrimitive } from '@assistant-ui/react-streamdown'
import { code } from '@streamdown/code'
import { Check, Copy, Download } from 'lucide-react'
import { type ComponentProps, memo, useMemo, useState } from 'react'

import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

/**
 * Strip provider/model "thinking" blocks before markdown render.
 *
 * Some Hermes providers stream raw `<think>…</think>` and similar into
 * assistant text. Proper reasoning UI uses dedicated `reasoning.*` parts.
 */
const REASONING_BLOCK_RE = /<(think|thinking|reasoning|scratchpad|analysis)>[\s\S]*?<\/\1>\s*/gi

function stripReasoning(text: string): string {
  return text.replace(REASONING_BLOCK_RE, '')
}

function CodeHeader({ language, code }: { language?: string; code?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!code) {
      return
    }

    try {
      if (window.hermesDesktop?.writeClipboard) {
        await window.hermesDesktop.writeClipboard(code)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
      }

      triggerHaptic('selection')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Best-effort copy; silent failure is OK for a chat surface.
    }
  }

  const label = language && language !== 'unknown' ? language : 'code'

  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-t-md border border-b-0 border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-mono uppercase tracking-wide">{label}</span>
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

function imageFilename(src?: string): string {
  if (!src) {
    return 'image'
  }

  try {
    const { pathname } = new URL(src, window.location.href)

    return pathname.split('/').filter(Boolean).pop() || 'image'
  } catch {
    return src.split(/[\\/]/).filter(Boolean).pop() || 'image'
  }
}

function isMissingIpcHandler(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  return message.includes("No handler registered for 'hermes:saveImageFromUrl'")
}

async function startBrowserDownload(src: string) {
  const response = await fetch(src)

  if (!response.ok) {
    throw new Error(`Could not fetch image: ${response.status}`)
  }

  const blobUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = imageFilename(src)
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
}

const imageActionButtonClass =
  'absolute right-2 top-2 grid size-8 place-items-center rounded-full border border-border/70 bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:opacity-50'

function MarkdownImage({ className, src, alt, ...props }: ComponentProps<'img'>) {
  const [saving, setSaving] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const canOpen = Boolean(src)

  async function handleDownload() {
    if (!src || saving) {
      return
    }

    setSaving(true)

    try {
      if (window.hermesDesktop?.saveImageFromUrl) {
        const saved = await window.hermesDesktop.saveImageFromUrl(src)

        if (saved) {
          notify({
            kind: 'success',
            title: 'Image saved',
            message: imageFilename(src)
          })
        }

        return
      }

      await startBrowserDownload(src)
    } catch (error) {
      if (isMissingIpcHandler(error)) {
        try {
          await startBrowserDownload(src)
          notify({
            kind: 'info',
            title: 'Download started',
            message: 'Restart Hermes Desktop to use Save Image.'
          })
        } catch (fallbackError) {
          notifyError(fallbackError, 'Restart Hermes Desktop to save images')
        }

        return
      }

      notifyError(error, 'Image download failed')
    } finally {
      setSaving(false)
    }
  }

  function openLightbox() {
    if (canOpen) {
      setLightboxOpen(true)
    }
  }

  const lightbox = src ? (
    <Dialog onOpenChange={setLightboxOpen} open={lightboxOpen}>
      <DialogContent
        className="grid max-h-[calc(100vh-2rem)] w-auto max-w-[calc(100vw-2rem)] place-items-center overflow-visible border-0 bg-transparent p-0 shadow-none"
        showCloseButton={false}
      >
        <div className="group/lightbox relative max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-auto">
          <img
            alt={alt ?? ''}
            className="block max-h-[calc(100vh-2rem)] max-w-full cursor-zoom-out select-auto rounded-lg object-contain shadow-2xl"
            onClick={() => setLightboxOpen(false)}
            src={src}
          />
          <button
            aria-label={saving ? 'Saving image' : 'Download image'}
            className={cn(imageActionButtonClass, 'group-hover/lightbox:opacity-100')}
            disabled={saving}
            onClick={event => {
              event.stopPropagation()
              void handleDownload()
            }}
            title={saving ? 'Saving image' : 'Download image'}
            type="button"
          >
            <Download className={cn('size-4', saving && 'animate-pulse')} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  ) : null

  return (
    <>
      <span className="group/image relative my-3 inline-block max-w-full align-top" data-slot="aui_markdown-image">
        <button
          className="block max-w-full cursor-zoom-in bg-transparent p-0 text-left"
          disabled={!canOpen}
          onClick={openLightbox}
          title={canOpen ? 'Open image' : undefined}
          type="button"
        >
          <img alt={alt ?? ''} className={className} src={src} {...props} />
        </button>
        {src && (
          <button
            aria-label={saving ? 'Saving image' : 'Download image'}
            className={cn(imageActionButtonClass, 'group-hover/image:opacity-100')}
            disabled={saving}
            onClick={event => {
              event.stopPropagation()
              void handleDownload()
            }}
            title={saving ? 'Saving image' : 'Download image'}
            type="button"
          >
            <Download className={cn('size-4', saving && 'animate-pulse')} />
          </button>
        )}
      </span>
      {lightbox}
    </>
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
        a: ({ className, ...props }: ComponentProps<'a'>) => (
          <a
            className={cn(
              'font-medium text-foreground underline underline-offset-4 decoration-foreground/30 wrap-anywhere hover:decoration-foreground/70',
              className
            )}
            rel="noopener noreferrer"
            target="_blank"
            {...props}
          />
        ),
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
      preprocess={stripReasoning}
      shikiTheme={['github-light-default', 'github-dark-default']}
    />
  )
}

export const MarkdownText = memo(MarkdownTextImpl)
