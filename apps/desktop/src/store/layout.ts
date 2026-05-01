import { atom } from 'nanostores'

import {
  arraysEqual,
  insertUniqueId,
  persistBoolean,
  persistStringArray,
  storedBoolean,
  storedStringArray
} from '@/lib/storage'

export const SIDEBAR_DEFAULT_WIDTH = 224
export const SIDEBAR_MAX_WIDTH = 320
const SIDEBAR_OPEN_STORAGE_KEY = 'hermes.desktop.sidebarOpen'
const SIDEBAR_PINNED_STORAGE_KEY = 'hermes.desktop.pinnedSessions'
const INSPECTOR_OPEN_STORAGE_KEY = 'hermes.desktop.inspectorOpen'

export const $sidebarWidth = atom(SIDEBAR_DEFAULT_WIDTH)
export const $sidebarOpen = atom(storedBoolean(SIDEBAR_OPEN_STORAGE_KEY, true))
export const $inspectorOpen = atom(storedBoolean(INSPECTOR_OPEN_STORAGE_KEY, true))
export const $pinnedSessionIds = atom(storedStringArray(SIDEBAR_PINNED_STORAGE_KEY))
export const $sidebarPinsOpen = atom(true)
export const $sidebarRecentsOpen = atom(true)
export const $isSidebarResizing = atom(false)

$sidebarOpen.subscribe(open => persistBoolean(SIDEBAR_OPEN_STORAGE_KEY, open))
$inspectorOpen.subscribe(open => persistBoolean(INSPECTOR_OPEN_STORAGE_KEY, open))
$pinnedSessionIds.subscribe(ids => persistStringArray(SIDEBAR_PINNED_STORAGE_KEY, [...ids]))

export function setSidebarWidth(width: number) {
  const bounded = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_DEFAULT_WIDTH, width))
  $sidebarWidth.set(bounded)
}

export function setSidebarOpen(open: boolean) {
  $sidebarOpen.set(open)
}

export function toggleSidebarOpen() {
  $sidebarOpen.set(!$sidebarOpen.get())
}

export function toggleInspectorOpen() {
  $inspectorOpen.set(!$inspectorOpen.get())
}

export function setSidebarPinsOpen(open: boolean) {
  $sidebarPinsOpen.set(open)
}

export function setSidebarRecentsOpen(open: boolean) {
  $sidebarRecentsOpen.set(open)
}

export function setSidebarResizing(resizing: boolean) {
  $isSidebarResizing.set(resizing)
}

export function pinSession(sessionId: string, index?: number) {
  const prev = $pinnedSessionIds.get()
  const next = insertUniqueId(prev, sessionId, index ?? prev.filter(id => id !== sessionId).length)

  if (!arraysEqual(prev, next)) {
    $pinnedSessionIds.set(next)
  }
}

export function unpinSession(sessionId: string) {
  const prev = $pinnedSessionIds.get()
  const next = prev.filter(id => id !== sessionId)

  if (!arraysEqual(prev, next)) {
    $pinnedSessionIds.set(next)
  }
}
