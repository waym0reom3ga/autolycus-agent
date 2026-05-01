import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import {
  ComposerPrimitive,
  type Unstable_IconComponent,
  type Unstable_MentionCategory,
  type Unstable_MentionDirective
} from '@assistant-ui/react'
import { ChevronDown } from 'lucide-react'

import { DIRECTIVE_POPOVER_CLASS, REF_ITEMS } from './constants'
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
      <ComposerPrimitive.Unstable_TriggerPopoverCategories>
        {categories => (
          <div className="grid gap-1">
            {categories.map(c => (
              <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
                categoryId={c.id}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-accent data-highlighted:bg-accent"
                key={c.id}
              >
                <span>{c.label}</span>
                <ChevronDown className="-rotate-90 size-3.5 text-muted-foreground" />
              </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
            ))}
          </div>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverCategories>
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {items => (
          <div className="grid gap-1">
            <ComposerPrimitive.Unstable_TriggerPopoverBack className="mb-1 text-xs text-muted-foreground hover:text-foreground">
              Back
            </ComposerPrimitive.Unstable_TriggerPopoverBack>
            {items.map((item, index) => {
              const Icon = directiveIcon(item, iconMap, Fallback)

              return (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent data-highlighted:bg-accent"
                  index={index}
                  item={item}
                  key={`${item.type}:${item.id}`}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{item.label}</span>
                    {item.description && (
                      <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                    )}
                  </span>
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              )
            })}
          </div>
        )}
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </ComposerPrimitive.Unstable_TriggerPopover>
  )
}
export function buildMentionCategories(suggestions: ContextSuggestion[] | undefined): Unstable_MentionCategory[] {
  const items = (suggestions ?? [])
    .map(s => {
      const match = s.text.match(/^@(file|folder|url|image):(.+)$/)

      if (!match) {
        return null
      }

      const [, type, id] = match

      return {
        id,
        type,
        label: s.display || id,
        description: s.meta,
        metadata: { icon: type }
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return [
    { id: 'refs', label: 'Hermes refs', items: REF_ITEMS },
    ...(items.length ? [{ id: 'context', label: 'Suggested files', items }] : [])
  ]
}
function directiveIcon(
  item: Unstable_TriggerItem,
  iconMap: Record<string, Unstable_IconComponent>,
  fallback: Unstable_IconComponent
): Unstable_IconComponent {
  const meta = item.metadata as Record<string, unknown> | undefined
  const key = typeof meta?.icon === 'string' ? meta.icon : item.type

  return iconMap[key] ?? iconMap[item.type] ?? fallback
}
