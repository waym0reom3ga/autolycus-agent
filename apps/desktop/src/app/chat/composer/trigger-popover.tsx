import type { Unstable_TriggerItem } from '@assistant-ui/core'

import { cn } from '@/lib/utils'

import { COMPLETION_DRAWER_CLASS, COMPLETION_DRAWER_ROW_CLASS, CompletionDrawerEmpty } from './completion-drawer'

interface ComposerTriggerPopoverProps {
  activeIndex: number
  items: readonly Unstable_TriggerItem[]
  kind: '@' | '/'
  loading: boolean
  onHover: (index: number) => void
  onPick: (item: Unstable_TriggerItem) => void
}

export function ComposerTriggerPopover({
  activeIndex,
  items,
  kind,
  loading,
  onHover,
  onPick
}: ComposerTriggerPopoverProps) {
  return (
    <div
      className={COMPLETION_DRAWER_CLASS}
      data-slot="composer-completion-drawer"
      data-state="open"
      onMouseDown={event => event.preventDefault()}
      role="listbox"
    >
      {items.length === 0 ? (
        <CompletionDrawerEmpty title={loading ? 'Looking up…' : 'No matches.'}>
          {kind === '@' ? (
            <>
              Try <span className="font-mono text-foreground/80">@file:</span> or{' '}
              <span className="font-mono text-foreground/80">@folder:</span>.
            </>
          ) : (
            <>
              Try <span className="font-mono text-foreground/80">/help</span>.
            </>
          )}
        </CompletionDrawerEmpty>
      ) : (
        items.map((item, index) => {
          const meta = item.metadata as { display?: string; meta?: string } | undefined
          const display = meta?.display ?? (kind === '/' ? `/${item.label}` : item.label)
          const description = meta?.meta || item.description

          return (
            <button
              className={cn(
                COMPLETION_DRAWER_ROW_CLASS,
                index === activeIndex && 'bg-[color-mix(in_srgb,var(--dt-accent)_70%,transparent)]'
              )}
              data-highlighted={index === activeIndex ? '' : undefined}
              key={item.id}
              onClick={() => onPick(item)}
              onMouseEnter={() => onHover(index)}
              type="button"
            >
              <span className="shrink-0 truncate font-mono font-medium leading-5 text-foreground">{display}</span>
              {description && (
                <span className="min-w-0 truncate leading-5 text-muted-foreground/80">{description}</span>
              )}
            </button>
          )
        })
      )}
    </div>
  )
}
