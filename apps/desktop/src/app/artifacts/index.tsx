import { Copy, ExternalLink, FileImage, FileText, FolderOpen, Layers3, Link2, RefreshCw, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageLoader } from '@/components/page-loader'
import { ZoomableImage } from '@/components/assistant-ui/zoomable-image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
} from '@/components/ui/pagination'
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

  if (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    value.startsWith('file://')
  ) {
    return 'file'
  }

  return 'link'
}

function artifactHref(value: string): string {
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('file://') ||
    value.startsWith('data:')
  ) {
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

function collectStringValues(
  value: unknown,
  keyPath: string,
  collector: (value: string, keyPath: string) => void
): void {
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

function pageRangeLabel(total: number, page: number, pageSize: number): string {
  if (total === 0) {
    return '0'
  }

  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return `${start}-${end} of ${total}`
}

function paginationItems(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  const pages: Array<number | 'ellipsis'> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pageCount - 1, page + 1)

  if (start > 2) {
    pages.push('ellipsis')
  }

  for (let nextPage = start; nextPage <= end; nextPage += 1) {
    pages.push(nextPage)
  }

  if (end < pageCount - 1) {
    pages.push('ellipsis')
  }

  pages.push(pageCount)

  return pages
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
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set())
  const [imagePage, setImagePage] = useState(1)
  const [filePage, setFilePage] = useState(1)

  const refreshArtifacts = useCallback(async () => {
    setRefreshing(true)

    try {
      const sessions = (await listSessions(30, 1)).sessions
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

  useEffect(() => {
    setImagePage(1)
    setFilePage(1)
  }, [artifacts, kindFilter, query])

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

  const visibleImageArtifacts = useMemo(
    () => visibleArtifacts.filter(artifact => artifact.kind === 'image'),
    [visibleArtifacts]
  )

  const visibleFileArtifacts = useMemo(
    () => visibleArtifacts.filter(artifact => artifact.kind !== 'image'),
    [visibleArtifacts]
  )

  const imagePageCount = Math.max(1, Math.ceil(visibleImageArtifacts.length / 24))
  const filePageCount = Math.max(1, Math.ceil(visibleFileArtifacts.length / 100))
  const currentImagePage = Math.min(imagePage, imagePageCount)
  const currentFilePage = Math.min(filePage, filePageCount)

  const pagedImageArtifacts = useMemo(
    () => visibleImageArtifacts.slice((currentImagePage - 1) * 24, currentImagePage * 24),
    [currentImagePage, visibleImageArtifacts]
  )

  const pagedFileArtifacts = useMemo(
    () => visibleFileArtifacts.slice((currentFilePage - 1) * 100, currentFilePage * 100),
    [currentFilePage, visibleFileArtifacts]
  )

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

  const markImageFailed = useCallback((id: string) => {
    setFailedImageIds(current => {
      if (current.has(id)) {
        return current
      }

      return new Set(current).add(id)
    })
  }, [])

  return (
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
          <div className="h-full overflow-y-auto">
            <div className="flex flex-col gap-4 px-2 pb-2">
              {visibleImageArtifacts.length > 0 && (
                <section aria-labelledby="artifacts-images-heading" className="flex flex-col">
                  <div className="sticky top-0 z-10 -mx-2 flex h-7 items-center justify-between gap-3 overflow-x-auto bg-background px-3">
                    <h3 className="shrink-0 text-xs font-semibold" id="artifacts-images-heading">
                      Images
                    </h3>
                    <ArtifactsPagination
                      className="justify-end px-0"
                      itemLabel="images"
                      onPageChange={setImagePage}
                      page={currentImagePage}
                      pageSize={24}
                      total={visibleImageArtifacts.length}
                    />
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] items-start gap-2 pt-1.5">
                    {pagedImageArtifacts.map(artifact => (
                      <ArtifactImageCard
                        artifact={artifact}
                        failedImage={failedImageIds.has(artifact.id)}
                        key={artifact.id}
                        onImageError={markImageFailed}
                        onOpenChat={sessionId => navigate(sessionRoute(sessionId))}
                      />
                    ))}
                  </div>
                </section>
              )}

              {visibleFileArtifacts.length > 0 && (
                <section aria-labelledby="artifacts-files-heading" className="flex flex-col">
                  <div className="sticky top-0 z-10 -mx-2 flex h-7 items-center justify-between gap-3 overflow-x-auto bg-background px-3">
                    <h3 className="shrink-0 text-xs font-semibold" id="artifacts-files-heading">
                      {kindFilter === 'link' ? 'Links' : kindFilter === 'file' ? 'Files' : 'Files and links'}
                    </h3>
                    <ArtifactsPagination
                      className="justify-end px-0"
                      itemLabel="files"
                      onPageChange={setFilePage}
                      page={currentFilePage}
                      pageSize={100}
                      total={visibleFileArtifacts.length}
                    />
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border/50 bg-background/70 shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,black_3%,transparent)]">
                    <table className="w-full min-w-176 table-fixed text-left text-xs">
                      <thead className="border-b border-border/50 bg-muted/35 text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground">
                        <tr>
                          <th className="w-[31%] px-2.5 py-1.5 font-medium">Name</th>
                          <th className="w-[35%] px-2.5 py-1.5 font-medium">Location</th>
                          <th className="w-[22%] px-2.5 py-1.5 font-medium">Session</th>
                          <th className="w-[12%] px-2.5 py-1.5 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/45">
                        {pagedFileArtifacts.map(artifact => (
                          <ArtifactListRow
                            artifact={artifact}
                            key={artifact.id}
                            onCopy={copyArtifact}
                            onOpen={openArtifact}
                            onOpenChat={sessionId => navigate(sessionRoute(sessionId))}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

interface ArtifactsPaginationProps {
  className?: string
  itemLabel: string
  onPageChange: (page: number) => void
  page: number
  pageSize: number
  total: number
}

function ArtifactsPagination({ className, itemLabel, onPageChange, page, pageSize, total }: ArtifactsPaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className={cn('flex h-6 items-center justify-between gap-2 px-1', className)}>
      <div className="shrink-0 text-[0.62rem] text-muted-foreground">
        {pageRangeLabel(total, page, pageSize)} {itemLabel}
      </div>
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto min-w-0 justify-end">
          <PaginationContent className="gap-0.5">
            <PaginationItem>
              <PaginationPrevious disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} />
            </PaginationItem>
            {paginationItems(page, pageCount).map((item, index) => (
              <PaginationItem key={`${item}-${index}`}>
                {item === 'ellipsis' ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationButton
                    aria-label={`Go to ${itemLabel} page ${item}`}
                    isActive={page === item}
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </PaginationButton>
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                disabled={page >= pageCount}
                onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
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

interface ArtifactImageCardProps {
  artifact: ArtifactRecord
  failedImage: boolean
  onImageError: (id: string) => void
  onOpenChat: (sessionId: string) => void
}

function ArtifactImageCard({ artifact, failedImage, onImageError, onOpenChat }: ArtifactImageCardProps) {
  return (
    <article
      className={cn(
        'group/artifact overflow-hidden rounded-lg border border-border/50 bg-background/70 shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,black_3%,transparent)]',
        'bg-muted/20'
      )}
    >
      <div
        className={cn(
          'relative flex h-44 w-full items-center justify-center overflow-hidden border-b border-border/50 bg-[color-mix(in_srgb,var(--dt-muted)_58%,var(--dt-background))] p-1.5',
          failedImage && 'cursor-default'
        )}
      >
        {!failedImage && (
          <ZoomableImage
            alt={artifact.label}
            className="max-h-40 max-w-full rounded-md object-contain shadow-sm"
            containerClassName="max-h-full"
            decoding="async"
            loading="lazy"
            onError={() => onImageError(artifact.id)}
            slot="artifact-media"
            src={artifact.href}
          />
        )}
      </div>

      <div className="space-y-1.5 p-2">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1 text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground">
            <FileImage className="size-3" />
            {artifact.kind}
          </div>
          <div className="truncate text-xs font-medium">{artifact.label}</div>
          <div className="mt-0.5 truncate text-[0.62rem] text-muted-foreground">{artifact.value}</div>
        </div>

        <div className="truncate text-[0.62rem] text-muted-foreground">
          {artifact.sessionTitle} · {formatArtifactTime(artifact.timestamp)}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => onOpenChat(artifact.sessionId)} size="xs" type="button" variant="outline">
            <FolderOpen className="size-3" />
            Chat
          </Button>
        </div>
      </div>
    </article>
  )
}

interface ArtifactListRowProps {
  artifact: ArtifactRecord
  onCopy: (value: string) => void | Promise<void>
  onOpen: (href: string) => void | Promise<void>
  onOpenChat: (sessionId: string) => void
}

function ArtifactListRow({ artifact, onCopy, onOpen, onOpenChat }: ArtifactListRowProps) {
  const Icon = artifact.kind === 'file' ? FileText : Link2

  return (
    <tr className="group/artifact transition-colors hover:bg-muted/30">
      <td className="px-2.5 py-1.5 align-middle">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium" title={artifact.label}>
              {artifact.label}
            </div>
            <div className="text-[0.6rem] uppercase tracking-[0.08em] text-muted-foreground">{artifact.kind}</div>
          </div>
        </div>
      </td>
      <td className="px-2.5 py-1.5 align-middle">
        <div className="truncate font-mono text-[0.68rem] text-muted-foreground/85" title={artifact.value}>
          {artifact.value}
        </div>
      </td>
      <td className="px-2.5 py-1.5 align-middle">
        <div className="min-w-0">
          <div className="truncate text-[0.68rem] text-muted-foreground" title={artifact.sessionTitle}>
            {artifact.sessionTitle}
          </div>
          <div className="text-[0.6rem] text-muted-foreground/75">{formatArtifactTime(artifact.timestamp)}</div>
        </div>
      </td>
      <td className="px-2.5 py-1.5 align-middle">
        <div className="flex justify-end gap-0.5 opacity-70 transition-opacity group-hover/artifact:opacity-100">
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
      </td>
    </tr>
  )
}
