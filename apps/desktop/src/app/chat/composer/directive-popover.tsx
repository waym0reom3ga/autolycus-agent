import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import {
  ComposerPrimitive,
  type Unstable_IconComponent,
  type Unstable_MentionCategory,
  type Unstable_MentionDirective
} from '@assistant-ui/react'
import { FileText } from 'lucide-react'

import { DIRECTIVE_POPOVER_CLASS } from './constants'
import type { ContextSuggestion } from './types'

export function DirectivePopover({
  adapter,
  directive,
  fallbackIcon: Fallback,
  iconMap
}: {
  adapter: Unstable_TriggerAdapter
  directive: Unstable_MentionDirective
  fallbackIcon: Unstable_IconComponent
  iconMap: Record<string, Unstable_IconComponent>
}) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopover adapter={adapter} char="@" className={DIRECTIVE_POPOVER_CLASS}>
      <ComposerPrimitive.Unstable_TriggerPopover.Directive {...directive} />
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {items => (
          <div className="grid gap-0.5">
            <div className="px-2 pb-1 pt-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground/80">
              Reference a file
            </div>
            {items.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                <p>No file suggestions yet.</p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  Keep typing to filter, or click <span className="font-medium text-foreground/80">+</span> to attach
                  files, folders, or a URL.
                </p>
              </div>
            ) : (
              items.map((item, index) => {
                const Icon = directiveIcon(item, iconMap, Fallback)

                return (
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/70 data-highlighted:bg-accent"
                    index={index}
                    item={item}
                    key={`${item.type}:${item.id}`}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground/80" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate font-medium text-foreground">{item.label}</span>
                      {item.description && (
                        <span className="truncate text-[0.72rem] text-muted-foreground/85">{item.description}</span>
                      )}
                    </span>
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                )
              })
            )}
          </div>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </ComposerPrimitive.Unstable_TriggerPopover>
  )
}

export function buildMentionCategories(suggestions: ContextSuggestion[] | undefined): Unstable_MentionCategory[] {
  const items: Unstable_TriggerItem[] = []

  for (const s of suggestions ?? []) {
    const match = s.text.match(/^@(file|folder|url|image):(.+)$/)

    if (!match) {
      continue
    }

    const [, type, id] = match

    items.push({
      id,
      type,
      label: s.display || id,
      description: s.meta,
      metadata: { icon: type }
    })
  }

  return [{ id: 'context', label: 'References', items }]
}

function directiveIcon(
  item: Unstable_TriggerItem,
  iconMap: Record<string, Unstable_IconComponent>,
  fallback: Unstable_IconComponent
): Unstable_IconComponent {
  const meta = item.metadata as Record<string, unknown> | undefined
  const key = typeof meta?.icon === 'string' ? meta.icon : item.type

  return iconMap[key] ?? iconMap[item.type] ?? fallback ?? FileText
}
