import { useStore } from '@nanostores/react'

import { Loader } from '@/components/ui/loader'
import { cn } from '@/lib/utils'
import { $desktopBoot } from '@/store/boot'
import { $desktopOnboarding } from '@/store/onboarding'

export function DesktopBootOverlay() {
  const boot = useStore($desktopBoot)
  const onboarding = useStore($desktopOnboarding)

  // Onboarding overlay covers the whole "first run" UX: it mounts from frame 1
  // and renders boot progress inline. Yield to it whenever it has not yet
  // confirmed the user is configured.
  if (onboarding.configured !== true) {
    return null
  }

  if (!boot.visible) {
    return null
  }

  const progress = Math.max(2, Math.min(100, Math.round(boot.progress)))
  const hasError = Boolean(boot.error)

  return (
    <div
      aria-busy={boot.running}
      aria-live={hasError ? 'assertive' : 'polite'}
      className="fixed inset-0 z-1400 grid place-items-center bg-background/88 backdrop-blur-sm"
      role="status"
    >
      <div className="w-[min(32rem,calc(100%-2rem))] rounded-xl border border-border/80 bg-card/95 p-5 shadow-xl shadow-black/8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Loader
              aria-hidden="true"
              className={cn('size-7 text-primary/80', hasError && 'text-destructive')}
              role="presentation"
              strokeScale={0.8}
              type="rose-curve"
            />
            <h2 className="truncate text-sm font-semibold text-foreground">Preparing Hermes Desktop</h2>
          </div>
        </div>

        <p className="mt-3 min-h-5 text-sm text-foreground">{boot.message}</p>
        {hasError ? <p className="mt-1 text-xs text-destructive">{boot.error}</p> : null}

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full bg-primary transition-[width] duration-300 ease-out',
              hasError && 'bg-destructive'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-[0.68rem] text-muted-foreground">
          <span className="max-w-[78%] truncate font-mono">{boot.phase}</span>
          <span>{progress}%</span>
        </div>
      </div>
    </div>
  )
}
