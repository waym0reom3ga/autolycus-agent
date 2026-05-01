import { useStore } from '@nanostores/react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import {
  $notifications,
  type AppNotification,
  clearNotifications,
  dismissNotification,
  type NotificationKind
} from '@/store/notifications'

const tone: Record<
  NotificationKind,
  {
    icon: LucideIcon
    variant: 'default' | 'destructive' | 'warning' | 'success'
  }
> = {
  error: {
    icon: AlertCircle,
    variant: 'destructive'
  },
  warning: {
    icon: AlertTriangle,
    variant: 'warning'
  },
  info: {
    icon: Info,
    variant: 'default'
  },
  success: {
    icon: CheckCircle2,
    variant: 'success'
  }
}

export function NotificationStack() {
  const notifications = useStore($notifications)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (notifications.length <= 1) {
      setExpanded(false)
    }
  }, [notifications.length])

  if (notifications.length === 0) {
    return null
  }

  const [latest, ...olderNotifications] = notifications
  const overflowCount = olderNotifications.length

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed left-1/2 top-[calc(var(--titlebar-height)+0.75rem)] z-1050 flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
      role="region"
    >
      <NotificationItem notification={latest} />
      {overflowCount > 0 && (
        <div className="pointer-events-auto flex min-h-8 items-center justify-between rounded-lg border border-border bg-card/80 px-3 text-xs text-muted-foreground shadow-xs">
          <button
            className="bg-transparent font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(value => !value)}
            type="button"
          >
            {expanded ? 'Hide' : 'Show'} {overflowCount} more {overflowCount === 1 ? 'notification' : 'notifications'}
          </button>
          <button
            className="bg-transparent text-muted-foreground hover:text-foreground"
            onClick={clearNotifications}
            type="button"
          >
            Clear all
          </button>
        </div>
      )}
      {expanded &&
        olderNotifications.map(notification => <NotificationItem key={notification.id} notification={notification} />)}
    </div>
  )
}

function NotificationItem({ notification }: { notification: AppNotification }) {
  const styles = tone[notification.kind]
  const Icon = styles.icon

  return (
    <Alert
      aria-live={notification.kind === 'error' ? 'assertive' : 'polite'}
      className="pointer-events-auto grid-cols-[auto_minmax(0,1fr)_auto] pr-2.5 shadow-lg"
      role={notification.kind === 'error' ? 'alert' : 'status'}
      variant={styles.variant}
    >
      <Icon />
      <div className="col-start-2 min-w-0">
        {notification.title && <AlertTitle className="col-start-auto">{notification.title}</AlertTitle>}
        <AlertDescription className="col-start-auto">
          <p className="m-0">{notification.message}</p>
        </AlertDescription>
      </div>
      <button
        aria-label="Dismiss notification"
        className="col-start-3 -mr-1 grid size-6 place-items-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => dismissNotification(notification.id)}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </Alert>
  )
}

export function InlineNotice({
  kind = 'info',
  title,
  children,
  className
}: {
  kind?: NotificationKind
  title?: string
  children: ReactNode
  className?: string
}) {
  const styles = tone[kind]
  const Icon = styles.icon

  return (
    <Alert className={cn('min-w-0', className)} role={kind === 'error' ? 'alert' : 'status'} variant={styles.variant}>
      <Icon />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className={cn(!title && 'row-start-1')}>{children}</AlertDescription>
    </Alert>
  )
}
