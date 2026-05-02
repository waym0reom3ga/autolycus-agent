import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import { ComposerPrimitive, type Unstable_MentionDirective } from '@assistant-ui/react'

import { COMPLETION_DRAWER_ROW_CLASS, CompletionDrawerEmpty, ComposerCompletionDrawer } from './completion-drawer'

export function DirectivePopover({
  adapter,
  directive,
  loading = false
}: {
  adapter: Unstable_TriggerAdapter
  directive: Unstable_MentionDirective
  loading?: boolean
}) {
  return (
    <ComposerCompletionDrawer adapter={adapter} ariaLabel="Reference suggestions" char="@">
      <ComposerPrimitive.Unstable_TriggerPopover.Directive {...directive} />
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {items => (
          <div className="grid gap-0.5 pt-0.5">
            {items.length === 0 ? (
              <CompletionDrawerEmpty title={loading ? 'Looking up...' : 'No matches.'}>
                Try <span className="font-mono text-foreground/80">@</span> for shortcuts, or paths like{' '}
                <span className="font-mono text-foreground/80">@~/Desktop</span> /{' '}
                <span className="font-mono text-foreground/80">@./src</span>.
              </CompletionDrawerEmpty>
            ) : (
              items.map((item, index) => <DirectiveRow index={index} item={item} key={item.id} />)
            )}
          </div>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </ComposerCompletionDrawer>
  )
}

function DirectiveRow({ index, item }: { index: number; item: Unstable_TriggerItem }) {
  const metadata = item.metadata as { display?: string; meta?: string } | undefined
  const display = metadata?.display || item.label
  const description = metadata?.meta || item.description

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItem className={COMPLETION_DRAWER_ROW_CLASS} index={index} item={item}>
      <span className="shrink-0 truncate font-mono font-medium leading-5 text-foreground">{display}</span>
      {description && <span className="min-w-0 truncate leading-5 text-muted-foreground/80">{description}</span>}
    </ComposerPrimitive.Unstable_TriggerPopoverItem>
  )
}
