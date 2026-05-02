import type { Unstable_DirectiveFormatter, Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import { ComposerPrimitive } from '@assistant-ui/react'

import { COMPLETION_DRAWER_ROW_CLASS, CompletionDrawerEmpty, ComposerCompletionDrawer } from './completion-drawer'

const slashFormatter: Unstable_DirectiveFormatter = {
  serialize(item: Unstable_TriggerItem): string {
    const metadata = item.metadata as { command?: unknown; display?: unknown } | undefined
    const command = typeof metadata?.command === 'string' ? metadata.command : null

    if (command) {
      return command
    }

    return `/${item.label}`
  },
  parse() {
    return []
  }
}

export function SlashPopover({ adapter, loading }: { adapter: Unstable_TriggerAdapter; loading: boolean }) {
  return (
    <ComposerCompletionDrawer adapter={adapter} ariaLabel="Slash command suggestions" char="/">
      <ComposerPrimitive.Unstable_TriggerPopover.Directive formatter={slashFormatter} />
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {items => (
          <div className="grid gap-0.5 pt-0.5">
            {items.length === 0 ? (
              <CompletionDrawerEmpty title={loading ? 'Looking up...' : 'No matching commands.'}>
                Try <span className="font-mono text-foreground/80">/help</span> for the desktop command list.
              </CompletionDrawerEmpty>
            ) : (
              items.map((item, index) => {
                const meta = item.metadata as { command?: string; display?: string; meta?: string } | undefined
                const display = meta?.display ?? meta?.command ?? `/${item.label}`
                const description = meta?.meta || item.description

                return (
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    className={COMPLETION_DRAWER_ROW_CLASS}
                    index={index}
                    item={item}
                    key={item.id}
                  >
                    <span className="shrink-0 font-mono font-medium leading-5 text-foreground">{display}</span>
                    {description && (
                      <span className="min-w-0 truncate leading-5 text-muted-foreground/80">{description}</span>
                    )}
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                )
              })
            )}
          </div>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </ComposerCompletionDrawer>
  )
}
