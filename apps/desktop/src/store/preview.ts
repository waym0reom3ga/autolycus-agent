import { atom, computed } from 'nanostores'

import { $activeSessionId, $selectedStoredSessionId } from './session'

export interface PreviewTarget {
  binary?: boolean
  byteSize?: number
  kind: 'file' | 'url'
  label: string
  large?: boolean
  language?: string
  mimeType?: string
  path?: string
  previewKind?: 'binary' | 'html' | 'image' | 'text'
  renderMode?: 'preview' | 'source'
  source: string
  url: string
}

export interface PreviewServerRestart {
  message?: string
  status: 'complete' | 'error' | 'running'
  taskId: string
  url: string
}

export type PreviewRecordSource = 'explicit-link' | 'file-browser' | 'manual' | 'tool-result'

export interface SessionPreviewRecord {
  autoOpen?: boolean
  createdAt: number
  dismissedAt?: number
  id: string
  normalized: PreviewTarget
  sessionId: string
  source: PreviewRecordSource
  target: string
}

type SessionPreviewRegistry = Record<string, SessionPreviewRecord[]>

const REGISTRY_STORAGE_KEY = 'hermes.desktop.sessionPreviews.v1'
const MAX_RECORDS_PER_SESSION = 1
const MAX_SESSIONS = 120

export const $previewTarget = atom<PreviewTarget | null>(null)
export const $filePreviewTarget = atom<PreviewTarget | null>(null)
export const $previewReloadRequest = atom(0)
export const $previewServerRestart = atom<PreviewServerRestart | null>(null)
export const $previewServerRestartStatus = computed($previewServerRestart, restart => restart?.status ?? 'idle')
export const $sessionPreviewRegistry = atom<SessionPreviewRegistry>(loadSessionPreviewRegistry())

$sessionPreviewRegistry.subscribe(persistSessionPreviewRegistry)

function isSamePreviewTarget(a: PreviewTarget | null, b: PreviewTarget | null): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.kind === b.kind && a.label === b.label && a.renderMode === b.renderMode && a.source === b.source && a.url === b.url
}

export function setPreviewTarget(target: PreviewTarget | null) {
  if (isSamePreviewTarget($previewTarget.get(), target)) {
    return
  }

  $previewTarget.set(target)
}

export function setFilePreviewTarget(target: PreviewTarget | null) {
  if (isSamePreviewTarget($filePreviewTarget.get(), target)) {
    return
  }

  $filePreviewTarget.set(target)
}

function isPreviewTarget(value: unknown): value is PreviewTarget {
  if (!value || typeof value !== 'object') {return false}
  const r = value as Record<string, unknown>

  return (
    (r.kind === 'file' || r.kind === 'url') &&
    typeof r.label === 'string' &&
    typeof r.source === 'string' &&
    typeof r.url === 'string'
  )
}

function isPreviewRecord(value: unknown): value is SessionPreviewRecord {
  if (!value || typeof value !== 'object') {return false}
  const r = value as Record<string, unknown>

  return (
    typeof r.createdAt === 'number' &&
    typeof r.id === 'string' &&
    isPreviewTarget(r.normalized) &&
    typeof r.sessionId === 'string' &&
    ['explicit-link', 'file-browser', 'manual', 'tool-result'].includes(String(r.source)) &&
    typeof r.target === 'string' &&
    (r.dismissedAt === undefined || typeof r.dismissedAt === 'number')
  )
}

function loadSessionPreviewRegistry(): SessionPreviewRegistry {
  if (typeof window === 'undefined') {return {}}

  try {
    const raw = window.localStorage.getItem(REGISTRY_STORAGE_KEY)

    if (!raw) {return {}}
    const parsed = JSON.parse(raw) as unknown

    if (!parsed || typeof parsed !== 'object') {return {}}
    const out: SessionPreviewRegistry = {}

    for (const [sessionId, records] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(records)) {continue}
      const valid = records.filter(isPreviewRecord).slice(0, MAX_RECORDS_PER_SESSION)

      if (valid.length > 0) {out[sessionId] = valid}
    }

    return pruneRegistry(out)
  } catch {
    return {}
  }
}

function persistSessionPreviewRegistry(registry: SessionPreviewRegistry) {
  if (typeof window === 'undefined') {return}

  try {
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(pruneRegistry(registry)))
  } catch {
    // Session previews are a desktop convenience; storage failures are nonfatal.
  }
}

function pruneRegistry(registry: SessionPreviewRegistry): SessionPreviewRegistry {
  const entries = Object.entries(registry)
    .map(([sessionId, records]) => [
      sessionId,
      [...records].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECORDS_PER_SESSION)
    ] as const)
    .filter(([, records]) => records.length > 0)
    .sort(([, a], [, b]) => (b[0]?.createdAt ?? 0) - (a[0]?.createdAt ?? 0))
    .slice(0, MAX_SESSIONS)

  return Object.fromEntries(entries)
}

function currentPreviewSessionId(): string {
  return $selectedStoredSessionId.get() || $activeSessionId.get() || ''
}

function recordId(sessionId: string, target: PreviewTarget): string {
  return `${sessionId}:${target.url}`
}

export function registerSessionPreview(
  sessionId: string | null | undefined,
  target: PreviewTarget,
  source: PreviewRecordSource,
  rawTarget = target.source
): SessionPreviewRecord | null {
  const id = sessionId?.trim()

  if (!id) {return null}

  const current = $sessionPreviewRegistry.get()
  const now = Date.now()
  const records = current[id] ?? []
  const existing = records.find(record => record.normalized.url === target.url)
  const normalized = previewTargetForSource(target, source)

  const nextRecord: SessionPreviewRecord = {
    autoOpen: true,
    createdAt: now,
    id: existing?.id || recordId(id, target),
    normalized,
    sessionId: id,
    source,
    target: rawTarget || target.source
  }

  $sessionPreviewRegistry.set(
    pruneRegistry({
      ...current,
      [id]: [nextRecord]
    })
  )

  return nextRecord
}

function previewTargetForSource(target: PreviewTarget, source: PreviewRecordSource): PreviewTarget {
  if (target.kind !== 'file' || target.previewKind !== 'html') {
    return target
  }

  return {
    ...target,
    renderMode: source === 'file-browser' || source === 'manual' ? 'source' : 'preview'
  }
}

function shouldOpenAsFilePreview(target: PreviewTarget, source: PreviewRecordSource): boolean {
  return target.kind === 'file' && (source === 'file-browser' || source === 'manual')
}

export function registerCurrentSessionPreview(
  target: PreviewTarget,
  source: PreviewRecordSource,
  rawTarget = target.source
): SessionPreviewRecord | null {
  return registerSessionPreview(currentPreviewSessionId(), target, source, rawTarget)
}

export function setSessionPreviewTarget(
  sessionId: string | null | undefined,
  target: PreviewTarget,
  source: PreviewRecordSource,
  rawTarget = target.source
): SessionPreviewRecord | null {
  if (shouldOpenAsFilePreview(target, source)) {
    setFilePreviewTarget(previewTargetForSource(target, source))

    return null
  }

  const record = registerSessionPreview(sessionId, target, source, rawTarget)

  setFilePreviewTarget(null)
  setPreviewTarget(record?.normalized ?? previewTargetForSource(target, source))

  return record
}

export function setCurrentSessionPreviewTarget(
  target: PreviewTarget,
  source: PreviewRecordSource,
  rawTarget = target.source
): SessionPreviewRecord | null {
  if (shouldOpenAsFilePreview(target, source)) {
    setFilePreviewTarget(previewTargetForSource(target, source))

    return null
  }

  const record = registerCurrentSessionPreview(target, source, rawTarget)

  setFilePreviewTarget(null)
  setPreviewTarget(record?.normalized ?? previewTargetForSource(target, source))

  return record
}

export function getSessionPreviewRecord(sessionId: string | null | undefined): SessionPreviewRecord | null {
  const id = sessionId?.trim()

  if (!id) {return null}

  return $sessionPreviewRegistry.get()[id]?.find(record => !record.dismissedAt && record.autoOpen !== false) ?? null
}

export function dismissSessionPreview(sessionId: string | null | undefined, url?: string) {
  const id = sessionId?.trim()

  if (!id) {return}
  const current = $sessionPreviewRegistry.get()
  const records = current[id]

  if (!records?.length) {return}
  const now = Date.now()
  const targetUrl = url || records.find(record => !record.dismissedAt)?.normalized.url

  if (!targetUrl) {return}

  // The preview rail is a single active file, not a back stack. Dismissing the
  // current preview should leave the rail closed instead of revealing an older
  // record for the same session.
  const dismissedRecords = records.map(record => ({
    ...record,
    autoOpen: false,
    dismissedAt: now
  }))

  $sessionPreviewRegistry.set({
    ...current,
    [id]: dismissedRecords
  })
}

/** User clicked the close X — clear the target and persist dismissal for the current session. */
export function dismissPreviewTarget() {
  const current = $previewTarget.get()

  if (current?.url) {
    dismissSessionPreview(currentPreviewSessionId(), current.url)
  }

  $previewTarget.set(null)
}

export function dismissFilePreviewTarget() {
  setFilePreviewTarget(null)
}

export function clearSessionPreviewRegistry() {
  $sessionPreviewRegistry.set({})
  setPreviewTarget(null)
  setFilePreviewTarget(null)
}

export function requestPreviewReload() {
  $previewReloadRequest.set($previewReloadRequest.get() + 1)
}

export function beginPreviewServerRestart(taskId: string, url: string) {
  $previewServerRestart.set({ status: 'running', taskId, url })
}

export function completePreviewServerRestart(taskId: string, text: string) {
  const current = $previewServerRestart.get()

  if (current?.taskId !== taskId) {
    return
  }

  $previewServerRestart.set({
    ...current,
    message: text,
    status: text.trim().toLowerCase().startsWith('error:') ? 'error' : 'complete'
  })
}

export function progressPreviewServerRestart(taskId: string, text: string) {
  const current = $previewServerRestart.get()

  if (current?.taskId !== taskId || current.status !== 'running') {
    return
  }

  $previewServerRestart.set({
    ...current,
    message: text
  })
}

export function failPreviewServerRestart(taskId: string, message: string) {
  const current = $previewServerRestart.get()

  if (current?.taskId !== taskId || current.status !== 'running') {
    return
  }

  $previewServerRestart.set({
    ...current,
    message,
    status: 'error'
  })
}
