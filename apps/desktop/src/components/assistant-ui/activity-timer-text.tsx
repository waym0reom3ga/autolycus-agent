import { cn } from '@/lib/utils'

import { formatElapsed } from './activity-timer'

interface ActivityTimerTextProps {
  seconds: number
  className?: string
}

export function ActivityTimerText({ seconds, className }: ActivityTimerTextProps) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-[0.56rem] leading-none tracking-[0.02em] text-muted-foreground/45 tabular-nums',
        className
      )}
    >
      {formatElapsed(seconds)}
    </span>
  )
}
