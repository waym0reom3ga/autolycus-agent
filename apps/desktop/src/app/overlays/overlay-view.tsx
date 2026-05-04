import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { X } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface OverlayViewProps {
  children: ReactNode
  onClose: () => void
  closeLabel?: string
  contentClassName?: string
  headerContent?: ReactNode
  rootClassName?: string
}

export function OverlayView({
  children,
  onClose,
  closeLabel = 'Close',
  contentClassName,
  headerContent,
  rootClassName
}: OverlayViewProps) {
  const closeOverlay = () => {
    triggerHaptic('close')
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/22 p-3 backdrop-blur-[2px] sm:p-8"
      onClick={event => {
        if (event.target === event.currentTarget) {
          closeOverlay()
        }
      }}
      role="presentation"
    >
      <div
        className={cn(
          'relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--dt-border)_60%,transparent)] bg-background/96 shadow-[0_1.5rem_4rem_-2rem_color-mix(in_srgb,#000_40%,transparent)]',
          rootClassName
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(var(--titlebar-height)+0.1875rem)] [-webkit-app-region:drag]">
          {headerContent && (
            <div className="pointer-events-auto absolute left-1/2 top-[calc(1rem+var(--titlebar-height)/2)] -translate-x-1/2 -translate-y-1/2 [-webkit-app-region:no-drag]">
              {headerContent}
            </div>
          )}

          <Button
            aria-label={closeLabel}
            className="pointer-events-auto absolute right-3.75 top-[calc(0.1875rem+var(--titlebar-height)/2)] h-7 w-7 -translate-y-1/2 rounded-lg text-muted-foreground hover:bg-accent/70 hover:text-foreground [-webkit-app-region:no-drag]"
            onClick={closeOverlay}
            size="icon"
            variant="ghost"
          >
            <X size={16} />
          </Button>
        </div>

        <div className={cn('min-h-0 flex flex-1 flex-col pt-(--titlebar-height)', contentClassName)}>{children}</div>
      </div>
    </div>
  )
}
