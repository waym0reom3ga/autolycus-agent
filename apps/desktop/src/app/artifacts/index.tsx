import {
  Copy,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  FolderOpen,
  Layers3,
  Link2,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getSessionMessages, listSessions } from '@/hermes'
import { sessionTitle } from '@/lib/chat-runtime'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import type { SessionInfo, SessionMessage } from '@/types/hermes'

import { sessionRoute } from '../routes'
import { TITLEBAR_ICON_SIZE, titlebarButtonClass, titlebarHeaderBaseClass } from '../shell/titlebar'

type ArtifactKind = 'image' | 'file' | 'link'

interface ArtifactRecord {
  id: string
  kind: ArtifactKind
  value: string
  href: string
  label: string
  sessionId: string
  sessionTitle: string
  timestamp: number
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g
const URL_RE = /https?:\/\/[^\s<>"')]+/g
const PATH_RE = /(^|[\s("'`])((?:\/|~\/|\.\.?\/)[^\s"'`<>]+(?:\.[a-z0-9]{1,8})?)/gi
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?.*)?$/i
const FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|pdf|txt|json|md|csv|zip|tar|gz|mp3|wav|mp4|mov)(?:\?.*)?$/i
const KEY_HINT_RE = /(path|file|url|image|artifact|output|download|result|target)/i

const imageActionButtonClass =
  'absolute right-2 top-2 grid size-8 place-items-center rounded-full border border-border/70 bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:opacity-50'

const ARTIFACT_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short'
})

function normalizeValue(value: string): string {
  return value.trim().replace(/[),.;]+$/, '')
}

function parseMaybeJson(value: string): unknown {
  if (!value.trim()) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function looksLikePathOrUrl(value: string): boolean {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('file://') ||
    value.startsWith('data:image/') ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/')
  )
}

function looksLikeArtifact(value: string): boolean {
  if (value.startsWith('data:image/')) {
    return true
  }

  if (looksLikePathOrUrl(value) && (IMAGE_EXT_RE.test(value) || FILE_EXT_RE.test(value))) {
    return true
  }

  return value.startsWith('/') && value.includes('.')
}

function artifactKind(value: string): ArtifactKind {
  if (value.startsWith('data:image/') || IMAGE_EXT_RE.test(value)) {
    return 'image'
  }

  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/') || value.startsWith('file://')) {
    return 'file'
  }

  return 'link'
}

function artifactHref(value: string): string {
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('file://') || value.startsWith('data:')) {
    return value
  }

  if (value.startsWith('/')) {
    return `file://${encodeURI(value)}`
  }

  return value
}

function artifactLabel(value: string): string {
  try {
    const url = new URL(value)
    const item = url.pathname.split('/').filter(Boolean).pop()

    return item || value
  } catch {
    const parts = value.split(/[\\/]/).filter(Boolean)

    return parts.pop() || value
  }
}

function messageText(message: SessionMessage): string {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content
  }

  if (typeof message.text === 'string' && message.text.trim()) {
    return message.text
  }

  if (typeof message.context === 'string' && message.context.trim()) {
    return message.context
  }

  return ''
}

function collectStringValues(value: unknown, keyPath: string, collector: (value: string, keyPath: string) => void): void {
  if (typeof value === 'string') {
    collector(value, keyPath)

    return
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStringValues(entry, `${keyPath}.${index}`, collector))

    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectStringValues(child, keyPath ? `${keyPath}.${key}` : key, collector)
  }
}

function collectArtifactsFromText(text: string, pushValue: (value: string) => void): void {
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    pushValue(match[2] || '')
  }

  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const start = match.index ?? 0

    if (start > 0 && text[start - 1] === '!') {
      continue
    }

    const value = match[2] || ''

    if (looksLikeArtifact(value)) {
      pushValue(value)
    }
  }

  for (const match of text.matchAll(URL_RE)) {
    const value = match[0] || ''

    if (looksLikeArtifact(value)) {
      pushValue(value)
    }
  }

  for (const match of text.matchAll(PATH_RE)) {
    pushValue(match[2] || '')
  }
}

function collectArtifactsFromMessage(message: SessionMessage, pushValue: (value: string) => void): void {
  const text = messageText(message)

  if (text) {
    collectArtifactsFromText(text, pushValue)
  }

  if (message.role !== 'tool' && !Array.isArray(message.tool_calls)) {
    return
  }

  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      collectStringValues(call, 'tool_call', (value, keyPath) => {
        const normalized = normalizeValue(value)

        if (!normalized) {
          return
        }

        if (KEY_HINT_RE.test(keyPath) && (looksLikePathOrUrl(normalized) || FILE_EXT_RE.test(normalized))) {
          pushValue(normalized)
        }
      })
    }
  }

  const parsed = parseMaybeJson(text)

  if (parsed !== null) {
    collectStringValues(parsed, 'tool_result', (value, keyPath) => {
      const normalized = normalizeValue(value)

      if (!normalized) {
        return
      }

      if ((KEY_HINT_RE.test(keyPath) || looksLikePathOrUrl(normalized)) && looksLikeArtifact(normalized)) {
        pushValue(normalized)
      }
    })
  }
}

function collectArtifactsForSession(session: SessionInfo, messages: SessionMessage[]): ArtifactRecord[] {
  const found = new Map<string, ArtifactRecord>()
  const title = sessionTitle(session)

  for (const message of messages) {
    if (message.role !== 'assistant' && message.role !== 'tool') {
      continue
    }

    collectArtifactsFromMessage(message, candidate => {
      const value = normalizeValue(candidate)

      if (!value || !looksLikeArtifact(value)) {
        return
      }

      const key = `${session.id}:${value}`

      if (found.has(key)) {
        return
      }

      found.set(key, {
        id: key,
        kind: artifactKind(value),
        value,
        href: artifactHref(value),
        label: artifactLabel(value),
        sessionId: session.id,
        sessionTitle: title,
        timestamp: message.timestamp || session.last_active || session.started_at || Date.now()
      })
    })
  }

  return Array.from(found.values())
}

function formatArtifactTime(timestamp: number): string {
  return ARTIFACT_TIME_FMT.format(new Date(timestamp))
}

interface ArtifactsViewProps extends React.ComponentProps<'section'> {
  setTitlebarActions?: (actions: ReactNode | null) => void
}

export function ArtifactsView({ setTitlebarActions, ...props }: ArtifactsViewProps) {
  const navigate = useNavigate()
  const [artifacts, setArtifacts] = useState<ArtifactRecord[] | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | ArtifactKind>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [savingArtifactId, setSavingArtifactId] = useState<string | null>(null)
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set())
  const [lightboxArtifact, setLightboxArtifact] = useState<ArtifactRecord | null>(null)

  const refreshArtifacts = useCallback(async () => {
    setRefreshing(true)

    try {
      const sessions = (await listSessions(30)).sessions
      const results = await Promise.allSettled(sessions.map(session => getSessionMessages(session.id)))
      const nextArtifacts: ArtifactRecord[] = []

      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') {
          return
        }

        const session = sessions[index]
        nextArtifacts.push(...collectArtifactsForSession(session, result.value.messages))
      })

      setArtifacts(nextArtifacts.sort((a, b) => b.timestamp - a.timestamp))
    } catch (err) {
      notifyError(err, 'Artifacts failed to load')
      setArtifacts([])
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshArtifacts()
  }, [refreshArtifacts])

  useEffect(() => {
    if (!setTitlebarActions) {
      return
    }

    setTitlebarActions(
      <button
        aria-label={refreshing ? 'Refreshing artifacts' : 'Refresh artifacts'}
        className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent')}
        disabled={refreshing}
        onClick={() => void refreshArtifacts()}
        type="button"
      >
        <RefreshCw className={cn(refreshing && 'animate-spin')} size={TITLEBAR_ICON_SIZE} />
      </button>
    )

    return () => setTitlebarActions(null)
  }, [refreshArtifacts, refreshing, setTitlebarActions])

  const visibleArtifacts = useMemo(() => {
    if (!artifacts) {
      return []
    }

    const q = query.trim().toLowerCase()

    return artifacts.filter(artifact => {
      if (kindFilter !== 'all' && artifact.kind !== kindFilter) {
        return false
      }

      if (!q) {
        return true
      }

      return (
        artifact.label.toLowerCase().includes(q) ||
        artifact.value.toLowerCase().includes(q) ||
        artifact.sessionTitle.toLowerCase().includes(q)
      )
    })
  }, [artifacts, kindFilter, query])

  const counts = useMemo(() => {
    const all = artifacts || []

    return {
      all: all.length,
      image: all.filter(artifact => artifact.kind === 'image').length,
      file: all.filter(artifact => artifact.kind === 'file').length,
      link: all.filter(artifact => artifact.kind === 'link').length
    }
  }, [artifacts])

  const copyArtifact = useCallback(async (value: string) => {
    try {
      if (window.hermesDesktop?.writeClipboard) {
        await window.hermesDesktop.writeClipboard(value)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      }

      notify({
        kind: 'success',
        title: 'Copied',
        message: value
      })
    } catch (err) {
      notifyError(err, 'Copy failed')
    }
  }, [])

  const openArtifact = useCallback(async (href: string) => {
    try {
      if (window.hermesDesktop?.openExternal) {
        await window.hermesDesktop.openExternal(href)
      } else {
        window.open(href, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      notifyError(err, 'Open failed')
    }
  }, [])

  const saveImageArtifact = useCallback(async (artifact: ArtifactRecord) => {
    if (artifact.kind !== 'image') {
      return
    }

    setSavingArtifactId(artifact.id)

    try {
      if (!window.hermesDesktop?.saveImageFromUrl) {
        throw new Error('Image saving is unavailable in this build.')
      }

      const saved = await window.hermesDesktop.saveImageFromUrl(artifact.href)

      if (saved) {
        notify({
          kind: 'success',
          title: 'Image saved',
          message: artifact.label
        })
      }
    } catch (err) {
      notifyError(err, 'Save failed')
    } finally {
      setSavingArtifactId(null)
    }
  }, [])

  const markImageFailed = useCallback((id: string) => {
    setFailedImageIds(current => {
      if (current.has(id)) {
        return current
      }

      return new Set(current).add(id)
    })
  }, [])

  const imageLightbox = lightboxArtifact ? (
    <Dialog onOpenChange={open => !open && setLightboxArtifact(null)} open>
      <DialogContent
        className="grid max-h-[calc(100vh-2rem)] w-auto max-w-[calc(100vw-2rem)] place-items-center overflow-visible border-0 bg-transparent p-0 shadow-none"
        showCloseButton={false}
      >
        <div className="group/lightbox relative max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-auto">
          <img
            alt={lightboxArtifact.label}
            className="block max-h-[calc(100vh-2rem)] max-w-full cursor-zoom-out select-auto rounded-lg object-contain shadow-2xl"
            onClick={() => setLightboxArtifact(null)}
            src={lightboxArtifact.href}
          />
          <button
            aria-label={savingArtifactId === lightboxArtifact.id ? 'Saving image' : 'Download image'}
            className={cn(imageActionButtonClass, 'group-hover/lightbox:opacity-100')}
            disabled={savingArtifactId === lightboxArtifact.id}
            onClick={event => {
              event.stopPropagation()
              void saveImageArtifact(lightboxArtifact)
            }}
            title={savingArtifactId === lightboxArtifact.id ? 'Saving image' : 'Download image'}
            type="button"
          >
            <Download className={cn('size-4', savingArtifactId === lightboxArtifact.id && 'animate-pulse')} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  ) : null

  return (
    <>
      <section
        {...props}
        className="flex h-[calc(100vh-0.375rem)] min-w-0 flex-col overflow-hidden rounded-[0.9375rem] bg-background"
      >
        <header className={titlebarHeaderBaseClass}>
          <h2 className="text-base font-semibold leading-none tracking-tight">Artifacts</h2>
          <span className="text-xs text-muted-foreground">{counts.all} found</span>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[1.0625rem] border border-border/50 bg-background/85">
          <div className="border-b border-border/50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <FilterButton
                active={kindFilter === 'all'}
                icon={Layers3}
                label={`All (${counts.all})`}
                onClick={() => setKindFilter('all')}
              />
              <FilterButton
                active={kindFilter === 'image'}
                icon={FileImage}
                label={`Images (${counts.image})`}
                onClick={() => setKindFilter('image')}
              />
              <FilterButton
                active={kindFilter === 'file'}
                icon={FileText}
                label={`Files (${counts.file})`}
                onClick={() => setKindFilter('file')}
              />
              <FilterButton
                active={kindFilter === 'link'}
                icon={Link2}
                label={`Links (${counts.link})`}
                onClick={() => setKindFilter('link')}
              />
              <div className="ml-auto w-full max-w-sm min-w-64">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 rounded-lg pl-8 pr-8 text-sm"
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search artifacts..."
                    value={query}
                  />
                  {query && (
                    <Button
                      aria-label="Clear search"
                      className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setQuery('')}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {!artifacts ? (
            <PageLoader label="Indexing recent session artifacts" />
          ) : visibleArtifacts.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <div className="text-sm font-medium">No artifacts found</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Generated images and file outputs will appear here as sessions produce them.
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-3">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] items-start gap-3">
                {visibleArtifacts.map(artifact => (
                  <ArtifactCard
                    artifact={artifact}
                    failedImage={failedImageIds.has(artifact.id)}
                    key={artifact.id}
                    onCopy={copyArtifact}
                    onImageError={markImageFailed}
                    onOpen={openArtifact}
                    onOpenChat={sessionId => navigate(sessionRoute(sessionId))}
                    onSaveImage={saveImageArtifact}
                    onZoom={setLightboxArtifact}
                    saving={savingArtifactId === artifact.id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
      {imageLightbox}
    </>
  )
}

function FilterButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: typeof Layers3
  label: string
  onClick: () => void
}) {
  return (
    <Button
      className={cn(
        'h-8 gap-1.5 rounded-md px-2.5 text-xs',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  )
}

interface ArtifactCardProps {
  artifact: ArtifactRecord
  failedImage: boolean
  onCopy: (value: string) => void | Promise<void>
  onImageError: (id: string) => void
  onOpen: (href: string) => void | Promise<void>
  onOpenChat: (sessionId: string) => void
  onSaveImage: (artifact: ArtifactRecord) => void | Promise<void>
  onZoom: (artifact: ArtifactRecord) => void
  saving: boolean
}

function ArtifactCard({
  artifact,
  failedImage,
  onCopy,
  onImageError,
  onOpen,
  onOpenChat,
  onSaveImage,
  onZoom,
  saving
}: ArtifactCardProps) {
  const image = artifact.kind === 'image'

  if (!image) {
    const Icon = artifact.kind === 'file' ? FileText : Link2

    return (
      <article className="group/artifact grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-2 rounded-xl border border-border/50 bg-background/70 p-3 shadow-[0_0.1875rem_0.75rem_color-mix(in_srgb,black_3%,transparent)]">
        <div className="mt-0.5 grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
            {artifact.kind}
          </div>
          <div className="truncate text-sm font-medium">{artifact.label}</div>
          <div className="mt-0.5 truncate font-mono text-[0.68rem] text-muted-foreground/80">{artifact.value}</div>
          <div className="mt-2 truncate text-[0.68rem] text-muted-foreground">
            {artifact.sessionTitle} · {formatArtifactTime(artifact.timestamp)}
          </div>
        </div>

        <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover/artifact:opacity-100">
          <Button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void onOpen(artifact.href)}
            size="icon-xs"
            title="Open"
            type="button"
            variant="ghost"
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <Button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void onCopy(artifact.value)}
            size="icon-xs"
            title="Copy"
            type="button"
            variant="ghost"
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChat(artifact.sessionId)}
            size="icon-xs"
            title="Open chat"
            type="button"
            variant="ghost"
          >
            <FolderOpen className="size-3.5" />
          </Button>
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'group/artifact overflow-hidden rounded-xl border border-border/50 bg-background/70 shadow-[0_0.1875rem_0.75rem_color-mix(in_srgb,black_3%,transparent)]',
        image && 'bg-muted/20'
      )}
    >
      {image && (
        <button
          aria-label={failedImage ? undefined : `Open ${artifact.label}`}
          className={cn(
            'relative flex h-56 w-full items-center justify-center overflow-hidden border-b border-border/50 bg-[color-mix(in_srgb,var(--dt-muted)_58%,var(--dt-background))] p-2',
            failedImage ? 'cursor-default' : 'cursor-zoom-in'
          )}
          disabled={failedImage}
          onClick={() => onZoom(artifact)}
          title={failedImage ? undefined : 'Open image'}
          type="button"
        >
          {!failedImage && (
            <>
              <img
                alt=""
                className="max-h-full max-w-full rounded-md object-contain shadow-sm"
                data-slot="artifact-media"
                decoding="async"
                loading="lazy"
                onError={() => onImageError(artifact.id)}
                src={artifact.href}
              />
              <span
                aria-label={saving ? 'Saving image' : 'Download image'}
                className={cn(imageActionButtonClass, 'group-hover/artifact:opacity-100')}
                onClick={event => {
                  event.stopPropagation()
                  void onSaveImage(artifact)
                }}
                title={saving ? 'Saving image' : 'Download image'}
              >
                <Download className={cn('size-4', saving && 'animate-pulse')} />
              </span>
            </>
          )}
        </button>
      )}

      <div className="space-y-2 p-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
            {image ? (
              <FileImage className="size-3.5" />
            ) : artifact.kind === 'file' ? (
              <FileText className="size-3.5" />
            ) : (
              <Link2 className="size-3.5" />
            )}
            {artifact.kind}
          </div>
          <div className="truncate text-sm font-medium">{artifact.label}</div>
          <div className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">{artifact.value}</div>
        </div>

        <div className="truncate text-[0.68rem] text-muted-foreground">
          {artifact.sessionTitle} · {formatArtifactTime(artifact.timestamp)}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => onOpenChat(artifact.sessionId)} size="sm" type="button" variant="outline">
            <FolderOpen className="size-3.5" />
            Chat
          </Button>
        </div>
      </div>
    </article>
  )
}
