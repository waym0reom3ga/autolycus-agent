import { atom } from 'nanostores'

export type NotificationKind = 'error' | 'warning' | 'info' | 'success'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title?: string
  message: string
  createdAt: number
}

interface NotificationInput {
  id?: string
  kind?: NotificationKind
  title?: string
  message: string
  durationMs?: number
}

let notificationCounter = 0
const timers = new Map<string, number>()

export const $notifications = atom<AppNotification[]>([])

function defaultDuration(kind: NotificationKind) {
  if (kind === 'error' || kind === 'warning') {
    return 0
  }

  return 5_000
}

function readableErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback

  const ipcMessage = raw.match(/Error invoking remote method '[^']+': Error: (.+)$/)
  const message = ipcMessage?.[1] || raw.replace(/^Error:\s*/, '')
  const detailMatch = message.match(/"detail"\s*:\s*"([^"]+)"/)

  return detailMatch?.[1] || message
}

export function notify(input: NotificationInput): string {
  const kind = input.kind ?? 'info'
  const id = input.id ?? `${Date.now()}-${notificationCounter++}`

  const notification: AppNotification = {
    id,
    kind,
    title: input.title,
    message: input.message,
    createdAt: Date.now()
  }

  window.clearTimeout(timers.get(id))
  timers.delete(id)
  $notifications.set([notification, ...$notifications.get().filter(item => item.id !== id)].slice(0, 4))

  const duration = input.durationMs ?? defaultDuration(kind)

  if (duration > 0) {
    timers.set(
      id,
      window.setTimeout(() => dismissNotification(id), duration)
    )
  }

  return id
}

export function notifyError(error: unknown, fallback: string): string {
  return notify({
    kind: 'error',
    title: fallback,
    message: readableErrorMessage(error, fallback)
  })
}

export function dismissNotification(id: string) {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  $notifications.set($notifications.get().filter(item => item.id !== id))
}

export function clearNotifications() {
  for (const timer of timers.values()) {
    window.clearTimeout(timer)
  }

  timers.clear()
  $notifications.set([])
}
